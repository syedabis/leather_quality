"""
Read queries for the FastAPI backend.
All queries filter by source_note = unit_id (e.g. "SP-01").
Delta method for piece counts: MAX - MIN per session (matches analytics_server.py).
"""

from __future__ import annotations
from datetime import datetime, timedelta
from .connection import get_connection


UNITS = ["SP-01", "SP-02", "SP-03", "SP-04", "SP-05", "SP-06"]

PLANT_NAMES: dict[str, str] = {
    "SP-01": "Spray Plant 1",
    "SP-02": "Spray Plant 2",
    "SP-03": "Spray Plant 3",
    "SP-04": "Spray Plant 4",
    "SP-05": "Spray Plant 5",
    "SP-06": "Spray Plant 6",
}


def _date_range(from_date: str | None, to_date: str | None) -> tuple[str, str]:
    to   = to_date   or datetime.now().strftime("%Y-%m-%d")
    from_ = from_date or (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    return from_, to


# ── Per-unit latest count ──────────────────────────────────────────────────

def get_latest_counts() -> list[dict]:
    """Latest total_count for each unit — used for the live dashboard cards."""
    sql = """
        SELECT source_note, total_count, belt_active, saved_at
        FROM LeatherCountLog l1
        WHERE saved_at = (
            SELECT MAX(saved_at) FROM LeatherCountLog l2
            WHERE l2.source_note = l1.source_note
        )
    """
    results = []
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql)
        for row in cur.fetchall():
            results.append({
                "unit":        row[0],
                "total_count": row[1],
                "belt_active": bool(row[2]),
                "saved_at":    row[3].isoformat() if row[3] else None,
            })
    return results


# ── Sessions ───────────────────────────────────────────────────────────────

def get_sessions(unit: str | None = None,
                 from_date: str | None = None,
                 to_date: str | None = None) -> list[dict]:
    from_, to = _date_range(from_date, to_date)
    where = "WHERE saved_at >= ? AND saved_at < DATEADD(day,1,CAST(? AS DATE))"
    params: list = [from_, to]
    if unit:
        where += " AND source_note = ?"
        params.append(unit)

    sql = f"""
        SELECT id, source_note, session_num, start_time_s, end_time_s,
               duration_s, piece_count, is_active, saved_at
        FROM LeatherSessions
        {where}
        ORDER BY saved_at DESC
    """
    results = []
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        for row in cur.fetchall():
            results.append({
                "id":           row[0],
                "unit":         row[1],
                "session_num":  row[2],
                "start_time_s": row[3],
                "end_time_s":   row[4],
                "duration_s":   row[5],
                "piece_count":  row[6],
                "is_active":    bool(row[7]),
                "saved_at":     row[8].isoformat() if row[8] else None,
            })
    return results


# ── Idle periods ───────────────────────────────────────────────────────────

def get_idle_periods(unit: str | None = None,
                     from_date: str | None = None,
                     to_date: str | None = None) -> list[dict]:
    from_, to = _date_range(from_date, to_date)
    where = "WHERE idle_start >= ? AND idle_start < DATEADD(day,1,CAST(? AS DATE))"
    params: list = [from_, to]
    if unit:
        where += " AND source_note = ?"
        params.append(unit)

    sql = f"""
        SELECT id, source_note, idle_start, idle_end, duration_s, total_count_at_stop
        FROM IdlePeriods
        {where}
        ORDER BY idle_start DESC
    """
    results = []
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        for row in cur.fetchall():
            results.append({
                "id":                  row[0],
                "unit":                row[1],
                "idle_start":          row[2].isoformat() if row[2] else None,
                "idle_end":            row[3].isoformat() if row[3] else None,
                "duration_s":          row[4],
                "total_count_at_stop": row[5],
            })
    return results


# ── Summary ────────────────────────────────────────────────────────────────

def get_summary(unit: str | None = None,
                from_date: str | None = None,
                to_date: str | None = None) -> dict:
    """
    Total pieces (delta method), session count, and avg utilization
    for a date range, optionally filtered to one unit.
    """
    from_, to = _date_range(from_date, to_date)
    where = "WHERE saved_at >= ? AND saved_at < DATEADD(day,1,CAST(? AS DATE))"
    params: list = [from_, to]
    if unit:
        where += " AND source_note = ?"
        params.append(unit)

    sql = f"""
        SELECT
            COUNT(DISTINCT session_num)              AS session_count,
            AVG(CAST(utilization_pct AS FLOAT))      AS avg_utilization,
            SUM(total_count)                         AS raw_total
        FROM LeatherCountLog
        {where}
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        row = cur.fetchone()

    return {
        "unit":            unit or "all",
        "from":            from_,
        "to":              to,
        "session_count":   row[0] or 0,
        "avg_utilization": round(row[1], 1) if row[1] else None,
        "total_count":     row[2] or 0,
    }


# ── Full plant state (for WsFrameMessage) ─────────────────────────────────────

# A unit's CurrentHourMetrics row is treated as "live" if FrameProcessor wrote to it
# within this many seconds. If the inference worker exits, the cached aggregates
# (e.g. cumulative uptime_frames > downtime_frames) would otherwise keep reporting
# the plant as Running forever.
_FRESH_WINDOW_S = 30


def _is_weekly_off_today() -> bool:
    """True if today's weekday is in the configured weekly_off_days setting.

    Setting value is a CSV of 3-letter weekday names, e.g. 'Sun' or 'Sat,Sun'.
    Defaults to 'Sun' if the setting is missing.
    """
    from datetime import datetime
    csv = "Sun"
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT setting_value FROM dbo.SystemSettings WHERE setting_key = 'weekly_off_days'"
            )
            row = cur.fetchone()
            if row and row[0]:
                csv = row[0]
    except Exception:
        pass
    today_abbrev = datetime.now().strftime("%a")   # 'Sun', 'Mon', ...
    return today_abbrev in {d.strip() for d in csv.split(",") if d.strip()}


def _is_holiday_today() -> bool:
    """True if today's date is present in dbo.Holidays.

    Silently returns False if the Holidays table doesn't exist yet (older DB).
    """
    from datetime import date as _date
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT 1 FROM dbo.Holidays WHERE holiday_date = CAST(? AS DATE)",
                (str(_date.today()),),
            )
            return cur.fetchone() is not None
    except Exception:
        return False


def _in_break_now() -> bool:
    """True if server-clock time is inside the configured break window.

    Reads break_start/end_weekday/friday from SystemSettings (with safe
    fallbacks). Friday uses its own window.
    """
    from datetime import datetime
    defaults = {
        "break_start_weekday": "13:00",
        "break_end_weekday":   "14:00",
        "break_start_friday":  "13:00",
        "break_end_friday":    "14:30",
    }
    s = dict(defaults)
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT setting_key, setting_value FROM dbo.SystemSettings "
                "WHERE setting_key IN ('break_start_weekday','break_end_weekday',"
                "'break_start_friday','break_end_friday')"
            )
            for k, v in cur.fetchall():
                if v:
                    s[k] = v
    except Exception:
        pass
    now = datetime.now()
    if now.weekday() == 4:           # Friday
        start_s, end_s = s["break_start_friday"], s["break_end_friday"]
    else:
        start_s, end_s = s["break_start_weekday"], s["break_end_weekday"]
    def _to_min(t: str) -> int:
        try:
            hh, mm = t.split(":")
            return int(hh) * 60 + int(mm)
        except Exception:
            return 0
    now_min = now.hour * 60 + now.minute
    return _to_min(start_s) <= now_min < _to_min(end_s)


def get_plant_states() -> list[dict]:
    """
    Returns a WsFrameMessage-shaped dict for every unit.
    Reads from CurrentHourMetrics (written by FrameProcessor every frame)
    so the WebSocket reflects live inference data without needing LeatherCountLog.

    Freshness: a row is considered "online" only if last_updated is within
    _FRESH_WINDOW_S seconds — otherwise the unit reports offline + total_count
    from the last seen row (so KPI tiles keep their final value but the live
    Running indicator stops blinking).
    """
    in_break       = _in_break_now()
    is_holiday     = _is_holiday_today()
    is_weekly_off  = _is_weekly_off_today()
    # Sum ALL of today's hour buckets per unit so runtime/idle accumulate
    # across hour boundaries. staleness is based on the most-recent write.
    sql = """
        SELECT
            source_note,
            SUM(piece_count)         AS piece_count,
            SUM(frame_count)         AS frame_count,
            SUM(uptime_frames)       AS uptime_frames,
            SUM(downtime_frames)     AS downtime_frames,
            SUM(idle_sessions_count) AS idle_sessions_count,
            SUM(idle_time_s)         AS idle_time_s,
            SUM(sum_utilization)     AS sum_utilization,
            MAX(last_updated)        AS last_updated,
            MIN(hour_start)          AS hour_start,
            DATEDIFF(SECOND, MAX(last_updated), SYSDATETIME()) AS staleness_s,
            (SELECT TOP 1 uptime_frames    FROM dbo.CurrentHourMetrics c2
             WHERE c2.source_note = c.source_note
               AND CAST(c2.hour_start AS DATE) = CAST(GETDATE() AS DATE)
             ORDER BY c2.last_updated DESC) AS cur_uptime,
            (SELECT TOP 1 downtime_frames  FROM dbo.CurrentHourMetrics c2
             WHERE c2.source_note = c.source_note
               AND CAST(c2.hour_start AS DATE) = CAST(GETDATE() AS DATE)
             ORDER BY c2.last_updated DESC) AS cur_downtime,
            (SELECT TOP 1 last_belt_active FROM dbo.CurrentHourMetrics c2
             WHERE c2.source_note = c.source_note
               AND CAST(c2.hour_start AS DATE) = CAST(GETDATE() AS DATE)
             ORDER BY c2.last_updated DESC) AS cur_belt_active
        FROM dbo.CurrentHourMetrics c
        WHERE CAST(hour_start AS DATE) = CAST(GETDATE() AS DATE)
        GROUP BY source_note
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql)
        rows: dict[str, tuple] = {}
        for r in cur.fetchall():
            rows[r[0]] = r

    result = []
    for unit in UNITS:
        row = rows.get(unit)
        if row is None:
            result.append({
                "type":          "frame",
                "plant_id":      unit,
                "plant_name":    PLANT_NAMES.get(unit, unit),
                "online":        False,
                "belt_active":   False,
                "in_break":      in_break,
                "is_holiday":    is_holiday,
                "is_weekly_off": is_weekly_off,
                "total_count":   0,
                "session_count": 0,
                "session_num":   0,
                "active_tracks": 0,
                "utilization":   0.0,
                "runtime_s":     0.0,
                "idle_s":        0.0,
                "proc_fps":      0.0,
                "idle_sessions": 0,
                "thumbnail":     None,
                "sessions":      [],
            })
            continue

        (_, piece_count, frame_count, uptime_frames, downtime_frames,
         idle_sessions, idle_time_s, sum_util, _last_updated, _hour_start,
         staleness_s, cur_uptime, cur_downtime, cur_belt_active) = row

        is_fresh    = staleness_s is not None and staleness_s <= _FRESH_WINDOW_S
        frame_count = frame_count or 1
        # Use current-hour uptime ratio for utilization display
        cur_total   = (cur_uptime or 0) + (cur_downtime or 0)
        avg_util    = round((cur_uptime or 0) * 100.0 / cur_total, 1) if cur_total > 0 else 0.0
        runtime_s   = uptime_frames * (1 / 5)   # approx: frames at TARGET_FPS=5
        # Belt is active if fresh AND last written frame says belt was active
        belt_active = is_fresh and bool(cur_belt_active)

        result.append({
            "type":          "frame",
            "plant_id":      unit,
            "plant_name":    PLANT_NAMES.get(unit, unit),
            "online":        is_fresh,
            "belt_active":   belt_active,
            "in_break":      in_break,
            "is_holiday":    is_holiday,
            "is_weekly_off": is_weekly_off,
            "total_count":   piece_count or 0,
            "session_count": idle_sessions or 0,
            "session_num":   idle_sessions or 0,
            "active_tracks": 0,
            "utilization":   avg_util,  # keep last known value; online/belt_active flags convey staleness
            "runtime_s":     round(runtime_s, 1),
            "idle_s":        round(idle_time_s or 0.0, 1),
            "proc_fps":      0.0,
            "idle_sessions": idle_sessions or 0,
            "thumbnail":     None,
            "sessions":      [],
        })
    return result


# ── AppSessions ────────────────────────────────────────────────────────────

def get_active_sessions() -> dict[str, dict | None]:
    """Returns plant → active session dict for every unit (None if no INPROCESS session)."""
    sql = """
        SELECT s.SessionId, s.LotNo, s.Plant, s.StartTime,
               s.ExpectedPieces, s.ProcessedPieces,
               wb.OrderNo, wb.ArticleName, wb.ColourName, wb.PartyName, wb.PK
        FROM dbo.AppSessions s
        LEFT JOIN dbo.WBIssuance_Info wb ON wb.IssueNoCounter = s.IssueNoCounter
        WHERE s.Status = 'INPROCESS'
        ORDER BY s.SessionId DESC
    """
    result: dict[str, dict | None] = {u: None for u in UNITS}
    seen: set[str] = set()

    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql)
            for row in cur.fetchall():
                (sid, lot_no, plant, start_time,
                 exp_pcs, proc_pcs,
                 order_no, article_name, colour_name, party_name, pk_code) = row
                if plant not in result or plant in seen:
                    continue
                seen.add(plant)
                result[plant] = {
                    "session_id":      sid,
                    "lot_no":          str(lot_no) if lot_no is not None else None,
                    "plant":           plant,
                    "start_time":      start_time.isoformat() if start_time else None,
                    "expected_pieces": int(exp_pcs)  if exp_pcs  is not None else None,
                    "current_pieces":  int(proc_pcs) if proc_pcs is not None else 0,
                    "type":            "accounted" if lot_no is not None else "unaccounted",
                    "order_no":        order_no,
                    "article_name":    article_name,
                    "colour_name":     colour_name,
                    "party_name":      party_name,
                    "pk_code":         str(pk_code) if pk_code else None,
                }
    except Exception as exc:
        print(f"[queries] get_active_sessions error: {exc}")

    return result


def get_app_sessions(plant: str | None = None, limit: int = 200) -> list[dict]:
    """All sessions from AppSessions (completed + active), newest first."""
    params: list = []
    where = ""
    if plant:
        where = "WHERE s.Plant = ?"
        params.append(plant)

    sql = f"""
        SELECT TOP {int(limit)}
            s.SessionId, s.LotNo, s.Plant, s.StartTime, s.EndTime,
            s.ExpectedPieces, s.ProcessedPieces, s.Status,
            wb.OrderNo, wb.ArticleName, wb.ColourName, wb.PartyName, wb.PK
        FROM dbo.AppSessions s
        LEFT JOIN dbo.WBIssuance_Info wb ON wb.IssueNoCounter = s.IssueNoCounter
        {where}
        ORDER BY s.StartTime DESC
    """
    results = []
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, params)
            for row in cur.fetchall():
                (sid, lot_no, plant_id, start_time, end_time,
                 exp_pcs, proc_pcs, status,
                 order_no, article_name, colour_name, party_name, pk_code) = row
                results.append({
                    "session_id":       sid,
                    "lot_no":           str(lot_no) if lot_no is not None else None,
                    "plant":            plant_id,
                    "start_time":       start_time.isoformat() if start_time else None,
                    "end_time":         end_time.isoformat()   if end_time   else None,
                    "expected_pieces":  int(exp_pcs)  if exp_pcs  is not None else None,
                    "processed_pieces": int(proc_pcs) if proc_pcs is not None else 0,
                    "status":           status,
                    "type":             "accounted" if lot_no is not None else "unaccounted",
                    "order_no":         order_no,
                    "article_name":     article_name,
                    "colour_name":      colour_name,
                    "party_name":       party_name,
                    "pk_code":          str(pk_code) if pk_code else None,
                })
    except Exception as exc:
        print(f"[queries] get_app_sessions error: {exc}")

    return results


# ── Report helpers ─────────────────────────────────────────────────────────

def _fmt_duration(seconds: int) -> str:
    h = int(abs(seconds) // 3600)
    m = int((abs(seconds) % 3600) // 60)
    return f"{h} Hour {m} Min"


def get_daily_detail(report_date: str, plant: str | None = None) -> dict:
    """Session-level detail for one date with idle gaps filled in between sessions."""
    params: list = [report_date]
    plant_filter = ""
    if plant:
        plant_filter = "AND s.Plant = ?"
        params.append(plant)

    sql = f"""
        SELECT s.SessionId, s.LotNo, s.Plant, s.StartTime, s.EndTime,
               s.ExpectedPieces, s.ProcessedPieces,
               wb.OrderNo, wb.ArticleName, wb.ColourName, wb.PartyName
        FROM dbo.AppSessions s
        LEFT JOIN dbo.WBIssuance_Info wb ON wb.IssueNoCounter = s.IssueNoCounter
        WHERE CAST(s.StartTime AS DATE) = ?
          AND s.Status = 'COMPLETED'
          AND s.EndTime IS NOT NULL
          {plant_filter}
        ORDER BY s.Plant, s.StartTime
    """

    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, params)
            raw_rows = cur.fetchall()
    except Exception as exc:
        return {"error": str(exc), "date": report_date, "plants": []}

    from collections import defaultdict
    by_plant: dict[str, list] = defaultdict(list)
    for row in raw_rows:
        (sid, lot_no, plant_id, start_time, end_time,
         exp_pcs, proc_pcs, order_no, article_name, colour_name, party_name) = row
        by_plant[plant_id].append({
            "start_time": start_time,
            "end_time":   end_time,
            "lot_no":     str(lot_no) if lot_no else None,
            "pieces":     int(proc_pcs) if proc_pcs else 0,
            "order_no":   order_no,
            "article_name": article_name,
            "colour_name":  colour_name,
            "party_name":   party_name,
        })

    result_plants = []
    for plant_id in sorted(by_plant.keys()):
        sessions      = by_plant[plant_id]
        rows_out      = []
        total_run_s   = 0
        total_idle_s  = 0
        total_pieces  = 0

        for i, s in enumerate(sessions):
            dur_s = int((s["end_time"] - s["start_time"]).total_seconds())
            if dur_s < 0:
                dur_s = 0
            total_run_s  += dur_s
            total_pieces += s["pieces"]
            rows_out.append({
                "row_type":       "session",
                "lot_no":         s["lot_no"] or "UNACCOUNTED",
                "order_no":       s["order_no"]     or "",
                "party_name":     s["party_name"]   or "",
                "article_name":   s["article_name"] or "",
                "colour_name":    s["colour_name"]  or "",
                "pieces":         s["pieces"],
                "plant":          plant_id,
                "start_time":     s["start_time"].strftime("%H:%M"),
                "end_time":       s["end_time"].strftime("%H:%M"),
                "duration_label": _fmt_duration(dur_s),
            })
            if i < len(sessions) - 1:
                gap_s = int((sessions[i + 1]["start_time"] - s["end_time"]).total_seconds())
                if gap_s > 60:
                    total_idle_s += gap_s
                    rows_out.append({
                        "row_type":       "idle",
                        "label":          "IDLE TIME",
                        "start_time":     s["end_time"].strftime("%H:%M"),
                        "end_time":       sessions[i + 1]["start_time"].strftime("%H:%M"),
                        "duration_label": _fmt_duration(gap_s),
                    })

        observed_s  = total_run_s + total_idle_s
        util_pct    = round(total_run_s / observed_s * 100, 1) if observed_s else 0
        result_plants.append({
            "plant": plant_id,
            "rows":  rows_out,
            "totals": {
                "run_label":       _fmt_duration(total_run_s),
                "idle_label":      _fmt_duration(total_idle_s),
                "run_time_min":    round(total_run_s  / 60),
                "idle_time_min":   round(total_idle_s / 60),
                "pieces":          total_pieces,
                "utilization_pct": util_pct,
            },
        })

    return {"date": report_date, "plants": result_plants}


def get_plant_wise(from_date: str, to_date: str,
                   plant: str | None = None,
                   available_hours: float = 10.0) -> list[dict]:
    """Per-day, per-plant summary over a date range."""
    params: list = [from_date, to_date]
    plant_filter = ""
    if plant:
        plant_filter = "AND s.Plant = ?"
        params.append(plant)

    sql = f"""
        SELECT
            CAST(s.StartTime AS DATE)                           AS report_date,
            s.Plant,
            ISNULL(SUM(s.ProcessedPieces), 0)                  AS total_pieces,
            ISNULL(SUM(DATEDIFF(SECOND, s.StartTime, s.EndTime)), 0) AS run_time_s
        FROM dbo.AppSessions s
        WHERE s.Status = 'COMPLETED'
          AND s.EndTime IS NOT NULL
          AND CAST(s.StartTime AS DATE) BETWEEN ? AND ?
          {plant_filter}
        GROUP BY CAST(s.StartTime AS DATE), s.Plant
        ORDER BY CAST(s.StartTime AS DATE), s.Plant
    """

    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, params)
            raw_rows = cur.fetchall()
    except Exception as exc:
        print(f"[queries] get_plant_wise error: {exc}")
        return []

    avail_s = available_hours * 3600
    result  = []
    for row in raw_rows:
        report_date, plant_id, total_pieces, run_time_s = row
        run_time_s  = max(0, int(run_time_s  or 0))
        idle_time_s = max(0, int(avail_s) - run_time_s)
        util_pct    = round(run_time_s / avail_s * 100, 1) if avail_s else 0
        result.append({
            "date":             str(report_date),
            "plant":            plant_id,
            "run_time_label":   _fmt_duration(run_time_s),
            "idle_time_label":  _fmt_duration(idle_time_s),
            "run_time_s":       run_time_s,
            "idle_time_s":      idle_time_s,
            "pieces":           int(total_pieces or 0),
            "utilization_pct":  util_pct,
        })
    return result
