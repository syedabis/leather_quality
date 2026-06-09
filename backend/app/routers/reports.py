"""
Reports router — generate and email daily production reports.

POST /api/reports/send   — generate Excel + PDF for a date, send email
GET  /api/reports/preview — show what today's data looks like (no email sent)
"""

from __future__ import annotations

import os
import sys
from datetime import date as _date
from decimal import Decimal
from io import BytesIO
from pathlib import Path

import openpyxl
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from openpyxl.styles import Alignment, Font, PatternFill
from pydantic import BaseModel

# ── Sibling package paths (used only by send/preview endpoints) ───────────────
_ROOT   = Path(__file__).resolve().parents[3]   # spray-plant/
_CLIENT = _ROOT / "client-shared"

from app.db.connection import get_connection
from app.db.queries import UNITS, PLANT_NAMES, get_daily_detail, get_plant_wise


def _ensure_report_deps():
    """Lazy-import heavy packages so the module loads even if they're absent."""
    for _p in (_ROOT, _CLIENT):
        if str(_p) not in sys.path:
            sys.path.insert(0, str(_p))
    os.environ.setdefault("LC_DB_SERVER",   os.getenv("DB_SERVER",   r"localhost\SQLEXPRESS"))
    os.environ.setdefault("LC_DB_NAME",     os.getenv("DB_NAME",     "LeatherCount"))
    os.environ.setdefault("LC_DB_USER",     os.getenv("DB_USER",     ""))
    os.environ.setdefault("LC_DB_PASSWORD", os.getenv("DB_PASSWORD", ""))
    os.environ.setdefault("LC_PLANT_NAME",  "Spray Plant Factory")
    from daily_report_generator import build_excel, build_pdf, REPORT_DIR  # noqa: F401
    from email_microservice.sender import send_report_email, build_plant_row, plant_status  # noqa: F401
    return build_excel, build_pdf, REPORT_DIR, send_report_email, build_plant_row, plant_status

router = APIRouter(prefix="/api/reports", tags=["reports"])


# ── Request schema ─────────────────────────────────────────────────────────────

class ReportRequest(BaseModel):
    date: str = str(_date.today())         # "YYYY-MM-DD"
    email_to: str
    recipient_name: str = ""
    subject: str | None = None


# ── DB fetch (mirrors daily_report_generator.fetch_all) ───────────────────────

def _qry(sql: str, params: tuple = ()) -> list[dict]:
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description]
    rows = []
    for row in cur.fetchall():
        d = {k: (float(v) if isinstance(v, Decimal) else v)
             for k, v in zip(cols, row)}
        rows.append(d)
    conn.close()
    return rows


def fetch_report_data(report_date: str) -> dict:
    """Fetch all data needed for the report from our SQL Server."""
    d = report_date
    _unit_placeholders = ",".join("?" * len(UNITS))

    summary = _qry(f"""
        SELECT
            ISNULL(SUM(session_pieces), 0)           AS total_pieces,
            COUNT(DISTINCT session_num)              AS total_sessions,
            CAST(AVG(avg_util) AS DECIMAL(5,1))      AS avg_utilization,
            CAST(AVG(avg_fps)  AS DECIMAL(5,2))      AS avg_fps,
            ISNULL(SUM(runtime_sum), 0)              AS total_runtime_s,
            ISNULL(SUM(idle_sum),    0)              AS total_idle_s,
            MIN(first_ts)                            AS first_record,
            MAX(last_ts)                             AS last_record
        FROM (
            SELECT session_num,
                MAX(total_count) - MIN(total_count)  AS session_pieces,
                AVG(CAST(utilization_pct AS FLOAT))  AS avg_util,
                AVG(CAST(proc_fps AS FLOAT))         AS avg_fps,
                MAX(CAST(runtime_s AS FLOAT))        AS runtime_sum,
                MAX(CAST(idle_s    AS FLOAT))        AS idle_sum,
                MIN(saved_at)                        AS first_ts,
                MAX(saved_at)                        AS last_ts
            FROM LeatherCountLog
            WHERE CAST(saved_at AS DATE) = ?
              AND source_note IN ({_unit_placeholders})
            GROUP BY session_num
        ) sub
    """, (d, *UNITS))
    kpi = summary[0] if summary else {}

    by_hour = _qry(f"""
        SELECT hour, SUM(session_pieces) AS pieces
        FROM (
            SELECT DATEPART(HOUR, saved_at) AS hour, session_num,
                   MAX(total_count) - MIN(total_count) AS session_pieces
            FROM LeatherCountLog
            WHERE CAST(saved_at AS DATE) = ?
              AND source_note IN ({_unit_placeholders})
            GROUP BY DATEPART(HOUR, saved_at), session_num
        ) sub
        GROUP BY hour ORDER BY hour
    """, (d, *UNITS))
    hour_map = {r["hour"]: r["pieces"] for r in by_hour}
    hours = [{"hour": h, "pieces": hour_map.get(h, 0)} for h in range(24)]

    shifts = {"Morning (06-14)": 0, "Afternoon (14-22)": 0, "Night (22-06)": 0}
    for r in by_hour:
        h = r["hour"]; p = r["pieces"] or 0
        if 6 <= h < 14:    shifts["Morning (06-14)"]   += p
        elif 14 <= h < 22: shifts["Afternoon (14-22)"] += p
        else:              shifts["Night (22-06)"]     += p

    sessions = _qry(f"""
        SELECT TOP 200 id, saved_at, session_num,
               CAST(start_time_s AS DECIMAL(10,1)) AS start_time_s,
               CAST(end_time_s   AS DECIMAL(10,1)) AS end_time_s,
               CAST(duration_s   AS DECIMAL(10,1)) AS duration_s,
               piece_count, avg_color_r, avg_color_g, avg_color_b
        FROM LeatherSessions
        WHERE CAST(saved_at AS DATE) = ?
          AND source_note IN ({_unit_placeholders})
        ORDER BY session_num, saved_at
    """, (d, *UNITS))
    for s in sessions:
        if s.get("saved_at"):
            s["saved_at"] = str(s["saved_at"])

    idle = _qry(f"""
        SELECT id,
               CONVERT(varchar(23), idle_start, 126) AS idle_start,
               CONVERT(varchar(23), idle_end,   126) AS idle_end,
               CAST(duration_s AS DECIMAL(10,1))     AS duration_s,
               total_count_at_stop, source_note
        FROM IdlePeriods
        WHERE CAST(idle_start AS DATE) = ?
          AND source_note IN ({_unit_placeholders})
        ORDER BY idle_start
    """, (d, *UNITS))

    closed_idle   = [r for r in idle if r.get("duration_s") is not None]
    total_idle_s  = sum(r["duration_s"] for r in closed_idle) if closed_idle else 0
    longest_idle  = max((r["duration_s"] for r in closed_idle), default=0)
    avg_idle      = (total_idle_s / len(closed_idle)) if closed_idle else 0

    return {
        "kpi":          kpi,
        "hours":        hours,
        "shifts":       shifts,
        "sessions":     sessions,
        "idle":         idle,
        "total_idle_s": total_idle_s,
        "longest_idle": longest_idle,
        "avg_idle_s":   avg_idle,
        "idle_count":   len(idle),
    }


def _per_unit_summary(report_date: str) -> list[dict]:
    """Latest count + utilization per canonical unit (SP3..SP8) for the email table."""
    placeholders = ",".join("?" * len(UNITS))
    rows = _qry(f"""
        SELECT source_note,
               MAX(total_count)                         AS total_count,
               AVG(CAST(utilization_pct AS FLOAT))      AS avg_util
        FROM LeatherCountLog
        WHERE CAST(saved_at AS DATE) = ?
          AND source_note IN ({placeholders})
        GROUP BY source_note
    """, (report_date, *UNITS))
    return rows


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/daily-summary")
def daily_summary(date_param: str = Query(str(_date.today()), alias="date")):
    """
    Returns the two-section daily report data for the reports page.
    Section 1: per-unit utilisation (available hrs, shift run, idle, utilisation %, status)
    Section 2: per-unit pieces (pieces, daily target, achievement %, status)
    """
    try:
        with get_connection() as conn:
            cur = conn.cursor()

            # Shift hours from settings
            cur.execute(
                "SELECT setting_key, setting_value FROM dbo.SystemSettings "
                "WHERE setting_key IN ('shift_start','shift_end')"
            )
            settings = {r[0]: r[1] for r in cur.fetchall()}
            shift_start = settings.get("shift_start", "07:00")
            shift_end   = settings.get("shift_end",   "17:00")
            sh, sm = map(int, shift_start.split(":"))
            eh, em = map(int, shift_end.split(":"))
            available_hours = round((eh * 60 + em - sh * 60 - sm) / 60, 1)

            # Per-unit day analytics
            cur.execute(
                "EXEC sp_analytics_by_day @unit=?, @from_date=?, @to_date=?",
                (None, date_param, date_param)
            )
            rows = cur.fetchall()

            # Daily targets — check PlantTargetPeriods first (date-aware),
            # fall back to flat PlantTargets for any plant not covered.
            cur.execute("SELECT unit, daily_target FROM dbo.PlantTargets")
            targets = {r[0]: int(r[1]) for r in cur.fetchall()}

            # Fetch the most recent period target per unit (plant-specific beats ALL)
            cur.execute(
                """
                IF OBJECT_ID('dbo.PlantTargetPeriods', 'U') IS NOT NULL
                SELECT unit, daily_target
                FROM (
                    SELECT unit, daily_target,
                           ROW_NUMBER() OVER (PARTITION BY unit ORDER BY from_date DESC, id DESC) AS rn
                    FROM dbo.PlantTargetPeriods
                    WHERE from_date <= ?
                ) t WHERE rn = 1
                """,
                (date_param,),
            )
            period_rows = cur.fetchall() or []
            period_all = None
            period_by_unit: dict[str, int] = {}
            for unit_p, tgt_p in period_rows:
                if unit_p == "ALL":
                    period_all = int(tgt_p)
                else:
                    period_by_unit[unit_p] = int(tgt_p)

        plants = []
        for row in rows:
            unit          = row[1]
            pieces        = int(row[2] or 0)
            uptime_pct    = float(row[3] or 0)
            idle_time_s   = float(row[6] or 0)
            utilization   = float(row[7] or 0)
            shift_run_hrs = round(available_hours * uptime_pct / 100, 1)
            idle_hrs      = round(idle_time_s / 3600, 1)
            daily_target  = period_by_unit.get(unit) or period_all or targets.get(unit, 1500)
            achievement   = round(pieces / daily_target * 100, 1) if daily_target else 0
            plants.append({
                "unit":             unit,
                "available_hours":  available_hours,
                "shift_run_hrs":    shift_run_hrs,
                "idle_time_hrs":    idle_hrs,
                "utilization_pct":  round(utilization, 1),
                "util_status":      "On Target" if utilization >= 90 else "Monitor",
                "pieces":           pieces,
                "daily_target":     daily_target,
                "achievement_pct":  achievement,
                "piece_status":     "On Target" if achievement >= 90 else "Monitor",
            })

        return {
            "date":            date_param,
            "shift_start":     shift_start,
            "shift_end":       shift_end,
            "available_hours": available_hours,
            "plants":          plants,
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/preview")
def preview_report(report_date: str = str(_date.today())):
    """Return what data would go into today's report (no email sent)."""
    try:
        data    = fetch_report_data(report_date)
        units   = _per_unit_summary(report_date)
        kpi     = data["kpi"]
        return {
            "date":           report_date,
            "total_pieces":   kpi.get("total_pieces", 0),
            "total_sessions": kpi.get("total_sessions", 0),
            "avg_utilization":kpi.get("avg_utilization"),
            "total_runtime_s":kpi.get("total_runtime_s"),
            "idle_count":     data["idle_count"],
            "units":          units,
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.post("/send")
def send_report(req: ReportRequest):
    """Generate Excel + PDF for req.date and email them with live per-unit data."""
    try:
        build_excel, build_pdf, REPORT_DIR, send_report_email, build_plant_row, plant_status = _ensure_report_deps()

        # 1 — Fetch data from our DB
        data = fetch_report_data(req.date)

        # 2 — Generate Excel + PDF files
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        stem      = f"LeatherCount_Daily_{req.date}"
        xlsx_path = REPORT_DIR / f"{stem}.xlsx"
        pdf_path  = REPORT_DIR / f"{stem}.pdf"
        build_excel(data, req.date, xlsx_path)
        build_pdf(data, req.date, pdf_path)

        # 3 — Build per-unit HTML table rows
        unit_rows = _per_unit_summary(req.date)
        by_unit   = {r["source_note"]: r for r in unit_rows}

        plant_rows_html = ""
        for unit in UNITS:
            row  = by_unit.get(unit, {})
            pcs  = int(row.get("total_count", 0) or 0)
            util = float(row.get("avg_util", 0) or 0)
            plant_rows_html += build_plant_row(
                plant=f"{unit} — {PLANT_NAMES.get(unit, unit)}",
                utilization=util,
                pieces=pcs,
                status=plant_status(util),
            )

        if not plant_rows_html:
            plant_rows_html = (
                '<tr><td colspan="3" style="padding:12px 16px;color:#aaa;'
                'font-family:Arial,sans-serif;font-size:13px;text-align:center;">'
                'No production data recorded for this date.</td></tr>'
            )

        # 4 — Send email
        send_report_email(
            report_date=req.date,
            email_to=req.email_to,
            attachments=[xlsx_path, pdf_path],
            recipient_name=req.recipient_name,
            plant_rows_html=plant_rows_html,
            subject=req.subject,
        )

        return {
            "status":    "sent",
            "date":      req.date,
            "to":        req.email_to,
            "excel":     str(xlsx_path),
            "pdf":       str(pdf_path),
        }

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── New report endpoints ───────────────────────────────────────────────────────

def _shift_hours() -> tuple[str, str, float]:
    """Return (shift_start, shift_end, available_hours) from SystemSettings."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT setting_key, setting_value FROM dbo.SystemSettings "
            "WHERE setting_key IN ('shift_start','shift_end')"
        )
        sett = {r[0]: r[1] for r in cur.fetchall()}
    ss = sett.get("shift_start", "07:00")
    se = sett.get("shift_end",   "17:00")
    sh, sm = map(int, ss.split(":"))
    eh, em = map(int, se.split(":"))
    return ss, se, round((eh * 60 + em - sh * 60 - sm) / 60, 1)


@router.get("/daily-detail")
def daily_detail_endpoint(
    date_param: str = Query(str(_date.today()), alias="date"),
    plant: str | None = Query(None),
):
    try:
        return get_daily_detail(date_param, plant=plant)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/plant-wise")
def plant_wise_endpoint(
    from_date: str = Query(..., alias="from"),
    to_date:   str = Query(..., alias="to"),
    plant:     str | None = Query(None),
):
    try:
        _, _, avail_h = _shift_hours()
        rows = get_plant_wise(from_date, to_date, plant=plant, available_hours=avail_h)
        return {"from": from_date, "to": to_date, "plant": plant,
                "available_hours": avail_h, "rows": rows}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


# ── Excel download ─────────────────────────────────────────────────────────────

def _xl_hrow(ws, values: list, bg: str = "1E3A5F", fg: str = "FFFFFF") -> None:
    ws.append(values)
    fill = PatternFill("solid", fgColor=bg)
    font = Font(bold=True, color=fg)
    aln  = Alignment(horizontal="center")
    for col in range(1, len(values) + 1):
        c = ws.cell(ws.max_row, col)
        c.fill = fill
        c.font = font
        c.alignment = aln


def _xl_auto_width(ws, min_w: int = 12, max_w: int = 30) -> None:
    for col in ws.columns:
        best = min_w
        for cell in col:
            try:
                best = max(best, len(str(cell.value or "")))
            except Exception:
                pass
        ws.column_dimensions[col[0].column_letter].width = min(best + 2, max_w)


@router.get("/download")
def download_report_excel(
    report_type: str = Query("daily_summary", alias="type"),
    date_param:  str = Query(str(_date.today()), alias="date"),
    from_date:   str | None = Query(None, alias="from"),
    to_date:     str | None = Query(None, alias="to"),
    plant:       str | None = Query(None),
):
    """Return an .xlsx file — type: daily_summary | daily_detail | plant_wise | all"""
    try:
        _, _, avail_h = _shift_hours()
        wb = openpyxl.Workbook()
        wb.remove(wb.active)

        idle_fill = PatternFill("solid", fgColor="FFF3CD")

        # ── Sheet: Plant Wise ──────────────────────────────────────────────
        if report_type in ("plant_wise", "all"):
            f = from_date or date_param
            t = to_date   or date_param
            pw = get_plant_wise(f, t, plant=plant, available_hours=avail_h)
            ws = wb.create_sheet("Plant Wise")
            ws.append(["PLANT WISE REPORT"])
            ws.cell(1, 1).font = Font(bold=True, size=13)
            ws.append(["Start Date", f]);  ws.append(["End Date", t])
            ws.append(["Plant", plant or "All Plants"]); ws.append([])
            _xl_hrow(ws, ["Date", "Plant", "Total Run Time", "Total Idle Time",
                          "Pieces Processed", "Utilisation %"])
            for r in pw:
                ws.append([r["date"], r["plant"], r["run_time_label"],
                           r["idle_time_label"], r["pieces"],
                           f'{r["utilization_pct"]}%'])
            _xl_auto_width(ws)

        # ── Sheet: Daily Report ────────────────────────────────────────────
        if report_type in ("daily_detail", "all"):
            detail = get_daily_detail(date_param, plant=plant)
            ws = wb.create_sheet("Daily Report")
            ws.append(["DAILY REPORT"])
            ws.cell(1, 1).font = Font(bold=True, size=13)
            ws.append(["Date", date_param])
            ws.append(["Plant", plant or "All Plants"]); ws.append([])
            cols = ["Process Date", "Lot No", "Order No", "Party Name",
                    "Article Name", "Colour Name", "PCS", "Plant",
                    "Process Start", "Process End", "Duration"]
            for pd in detail.get("plants", []):
                _xl_hrow(ws, [f"Plant: {pd['plant']}"] + [""] * (len(cols) - 1))
                _xl_hrow(ws, cols)
                for row in pd["rows"]:
                    if row["row_type"] == "session":
                        ws.append([
                            date_param,
                            row["lot_no"],
                            row.get("order_no",    ""),
                            row.get("party_name",  ""),
                            row.get("article_name",""),
                            row.get("colour_name", ""),
                            row.get("pieces",      0),
                            pd["plant"],
                            row["start_time"],
                            row["end_time"],
                            row["duration_label"],
                        ])
                    else:
                        ri = ws.max_row + 1
                        ws.append([None, None, None, "IDLE TIME", None, None,
                                   None, None, row["start_time"],
                                   row["end_time"], row["duration_label"]])
                        for col in range(1, len(cols) + 1):
                            ws.cell(ri, col).fill = idle_fill
                t2 = pd["totals"]
                ws.append([])
                for lbl, val in [("Total Run Time",   t2["run_label"]),
                                  ("Total Idle Time",  t2["idle_label"]),
                                  ("Pieces Processed", t2["pieces"]),
                                  ("Utilisation",      f'{t2["utilization_pct"]}%')]:
                    ws.append([None, None, None, None, None, None, lbl, None, val])
                ws.append([])
            _xl_auto_width(ws)

        # ── Sheet: Daily Summary ───────────────────────────────────────────
        if report_type in ("daily_summary", "all"):
            sd = daily_summary(date_param=date_param)
            ws = wb.create_sheet("Daily Summary")
            ws.append(["DADA ENTERPRISES — SPRAY PLANT DAILY REPORT"])
            ws.cell(1, 1).font = Font(bold=True, size=13)
            ws.append([f"Report Date: {date_param}"]); ws.append([])
            ws.append(["SECTION 1 — PLANT UTILISATION (%)"])
            ws.cell(ws.max_row, 1).font = Font(bold=True)
            _xl_hrow(ws, ["Plant", "Available Hours", "Run Time (hrs)",
                          "Idle Time (hrs)", "Utilisation %", "Status"])
            for p in sd["plants"]:
                ws.append([p["unit"], p["available_hours"], p["shift_run_hrs"],
                           p["idle_time_hrs"], f'{p["utilization_pct"]}%',
                           p["util_status"]])
            avg = (sum(p["utilization_pct"] for p in sd["plants"]) / len(sd["plants"])
                   if sd["plants"] else 0)
            ws.append(["Average Utilisation (All Plants)", None, None, None,
                       f'{avg:.1f}%'])
            ws.cell(ws.max_row, 1).font = Font(bold=True)
            ws.append([])
            ws.append(["SECTION 2 — PIECES PASSED PER PLANT"])
            ws.cell(ws.max_row, 1).font = Font(bold=True)
            _xl_hrow(ws, ["Plant", "Pieces", "Daily Target", "Achievement %",
                          "vs Target", "Status"])
            for p in sd["plants"]:
                diff = p["pieces"] - p["daily_target"]
                ws.append([p["unit"], p["pieces"], p["daily_target"],
                           f'{p["achievement_pct"]}%', diff, p["piece_status"]])
            tp = sum(p["pieces"]       for p in sd["plants"])
            tt = sum(p["daily_target"] for p in sd["plants"])
            ws.append(["Total (All Plants)", tp, tt,
                       f'{round(tp/tt*100,1) if tt else 0}%',
                       tp - tt])
            ws.cell(ws.max_row, 1).font = Font(bold=True)
            ws.append([])
            ws.append(["Auto-generated by Spray Plant Monitoring System — Dada Enterprises, Kasur"])
            _xl_auto_width(ws)

        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)
        fname = f"SprayPlant_{report_type}_{date_param}.xlsx"
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
