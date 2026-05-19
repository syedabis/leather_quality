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
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# ── Resolve sibling package paths ─────────────────────────────────────────────
_ROOT         = Path(__file__).resolve().parents[3]   # spray-plant/
_CLIENT       = _ROOT / "client-shared"
_EMAIL_MS     = _ROOT / "email_microservice"

for _p in (_ROOT, _CLIENT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

# daily_report_generator reads LC_DB_SERVER at import time — set ours first
os.environ.setdefault("LC_DB_SERVER", os.getenv("DB_SERVER", r"localhost\SQLEXPRESS"))
os.environ.setdefault("LC_DB_NAME",   os.getenv("DB_NAME",   "LeatherCount"))
os.environ.setdefault("LC_DB_USER",   os.getenv("DB_USER",   ""))
os.environ.setdefault("LC_DB_PASSWORD", os.getenv("DB_PASSWORD", ""))
os.environ.setdefault("LC_PLANT_NAME", "Spray Plant Factory")

from daily_report_generator import build_excel, build_pdf, REPORT_DIR  # noqa: E402
from email_microservice.sender import (                                  # noqa: E402
    send_report_email, build_plant_row, plant_status,
)
from app.db.connection import get_connection                             # noqa: E402
from app.db.queries import UNITS, PLANT_NAMES                           # noqa: E402

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
