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
