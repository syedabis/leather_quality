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


# Cache of SystemSettings break_* values — avoids opening a fresh DB
# connection on every call (this is called per-plant, per-request).
_break_settings_cache: dict | None = None
_break_settings_cached_at: datetime | None = None
_BREAK_SETTINGS_TTL_S = 60


def _get_break_settings() -> dict:
    global _break_settings_cache, _break_settings_cached_at
    now = datetime.now()
    if (_break_settings_cache is not None and _break_settings_cached_at is not None
            and (now - _break_settings_cached_at).total_seconds() < _BREAK_SETTINGS_TTL_S):
        return _break_settings_cache

    s = {
        "break_start_weekday": "13:00",
        "break_end_weekday":   "14:00",
        "break_start_friday":  "13:00",
        "break_end_friday":    "14:30",
    }
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
    _break_settings_cache = s
    _break_settings_cached_at = now
    return s


def _get_break_window(date_obj) -> tuple[datetime, datetime] | None:
    """Returns (break_start_dt, break_end_dt) for the given date, Friday-aware.

    Reads break_start/end_weekday/friday from SystemSettings (cached, see
    _get_break_settings). Returns None if no valid break window is
    configured (e.g. end <= start).
    """
    s = _get_break_settings()
    if date_obj.weekday() == 4:           # Friday
        start_s, end_s = s["break_start_friday"], s["break_end_friday"]
    else:
        start_s, end_s = s["break_start_weekday"], s["break_end_weekday"]
    try:
        sh, sm = map(int, start_s.split(":"))
        eh, em = map(int, end_s.split(":"))
    except Exception:
        return None
    b_start = datetime(date_obj.year, date_obj.month, date_obj.day, sh, sm)
    b_end   = datetime(date_obj.year, date_obj.month, date_obj.day, eh, em)
    if b_end <= b_start:
        return None
    return b_start, b_end


def _effective_break_window(date_obj, sessions: list[dict]) -> tuple[datetime, datetime] | None:
    """Per-plant break window for a date.

    If a session is still running when the configured break starts, the
    break is delayed until that session ends. The configured break END time
    stays fixed. Returns None if there's no break left (e.g. the session ran
    past the configured break end).
    """
    window = _get_break_window(date_obj)
    if window is None:
        return None
    b_start, b_end = window
    eff_start = b_start
    for s in sessions:
        if s["start_time"] <= b_start < s["end_time"]:
            eff_start = min(s["end_time"], b_end)
            break
    if eff_start >= b_end:
        return None
    return eff_start, b_end


def _split_gap(gap_start: datetime, gap_end: datetime,
               eff_break: tuple[datetime, datetime] | None) -> list[tuple[str, datetime, datetime]]:
    """Split [gap_start, gap_end) into ('idle'|'break', start, end) segments,
    carving out the portion that overlaps the effective break window."""
    if eff_break is None or gap_end <= gap_start:
        return [("idle", gap_start, gap_end)]
    b_start, b_end = eff_break
    ov_start = max(gap_start, b_start)
    ov_end   = min(gap_end, b_end)
    if ov_end <= ov_start:
        return [("idle", gap_start, gap_end)]
    segments: list[tuple[str, datetime, datetime]] = []
    if ov_start > gap_start:
        segments.append(("idle", gap_start, ov_start))
    segments.append(("break", ov_start, ov_end))
    if gap_end > ov_end:
        segments.append(("idle", ov_end, gap_end))
    return segments


def _emit_gap_rows(gap_start: datetime, gap_end: datetime,
                    eff_break: tuple[datetime, datetime] | None,
                    rows_out: list,
                    break_sub_rows: list | None = None) -> tuple[int, int]:
    """Split a gap into idle/break segments, append timeline rows for each,
    and return (idle_seconds_added, break_seconds_added).

    Idle segments shorter than 60s are dropped (matches prior behaviour);
    break segments are always emitted. break_sub_rows, if provided, are
    attached to the break row as nested mode-session entries.
    """
    add_idle = 0
    add_break = 0
    for kind, seg_a, seg_b in _split_gap(gap_start, gap_end, eff_break):
        seg = int((seg_b - seg_a).total_seconds())
        if kind == "break":
            if seg > 0:
                add_break += seg
                br: dict = {
                    "row_type":       "break",
                    "label":          "BREAK TIME",
                    "start_time":     seg_a.strftime("%H:%M"),
                    "end_time":       seg_b.strftime("%H:%M"),
                    "duration_label": _fmt_duration(seg),
                }
                if break_sub_rows:
                    br["sub_rows"] = break_sub_rows
                rows_out.append(br)
        else:
            if seg > 60:
                add_idle += seg
                rows_out.append({
                    "row_type":       "idle",
                    "label":          "IDLE TIME",
                    "start_time":     seg_a.strftime("%H:%M"),
                    "end_time":       seg_b.strftime("%H:%M"),
                    "duration_label": _fmt_duration(seg),
                })
    return add_idle, add_break


def _get_active_session_starts() -> dict[str, datetime]:
    """plant -> earliest StartTime among its currently-INPROCESS sessions."""
    result: dict[str, datetime] = {}
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT Plant, StartTime FROM dbo.AppSessions WHERE Status = 'INPROCESS'")
            for plant, start_time in cur.fetchall():
                if start_time and (plant not in result or start_time < result[plant]):
                    result[plant] = start_time
    except Exception:
        pass
    return result


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
    _now           = datetime.now()
    break_window   = _get_break_window(_now.date())
    active_starts  = _get_active_session_starts()
    is_holiday     = _is_holiday_today()
    is_weekly_off  = _is_weekly_off_today()

    def _plant_in_break(unit: str) -> bool:
        """Per-plant break flag: if THIS plant's session is still running when
        the configured break starts, its break is delayed until that session
        ends (configured break end time stays fixed)."""
        if break_window is None:
            return False
        b_start, b_end = break_window
        if not (b_start <= _now < b_end):
            return False
        st = active_starts.get(unit)
        if st is not None and st <= b_start:
            return False
        return True

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
               AND c2.hour_start >= CAST(GETDATE() AS DATE)
               AND c2.hour_start <  DATEADD(day, 1, CAST(GETDATE() AS DATE))
             ORDER BY c2.last_updated DESC) AS cur_uptime,
            (SELECT TOP 1 downtime_frames  FROM dbo.CurrentHourMetrics c2
             WHERE c2.source_note = c.source_note
               AND c2.hour_start >= CAST(GETDATE() AS DATE)
               AND c2.hour_start <  DATEADD(day, 1, CAST(GETDATE() AS DATE))
             ORDER BY c2.last_updated DESC) AS cur_downtime,
            (SELECT TOP 1 last_belt_active FROM dbo.CurrentHourMetrics c2
             WHERE c2.source_note = c.source_note
               AND c2.hour_start >= CAST(GETDATE() AS DATE)
               AND c2.hour_start <  DATEADD(day, 1, CAST(GETDATE() AS DATE))
             ORDER BY c2.last_updated DESC) AS cur_belt_active
        FROM dbo.CurrentHourMetrics c
        WHERE hour_start >= CAST(GETDATE() AS DATE)
          AND hour_start <  DATEADD(day, 1, CAST(GETDATE() AS DATE))
        GROUP BY source_note
    """

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql)
        rows: dict[str, tuple] = {}
        for r in cur.fetchall():
            rows[r[0]] = r

    # Batch-fetch session metrics for all units in 3 queries instead of 6×3
    today_str    = datetime.now().date().isoformat()
    session_metrics_all = _batch_session_metrics(today_str, today_str, UNITS)

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
                "in_break":      _plant_in_break(unit),
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
        # Belt is active if fresh AND last written frame says belt was active
        belt_active = is_fresh and bool(cur_belt_active)
        sm          = session_metrics_all.get((today_str, unit), {"run_s": 0.0, "idle_s": 0.0})

        result.append({
            "type":          "frame",
            "plant_id":      unit,
            "plant_name":    PLANT_NAMES.get(unit, unit),
            "online":        is_fresh,
            "belt_active":   belt_active,
            "in_break":      _plant_in_break(unit),
            "is_holiday":    is_holiday,
            "is_weekly_off": is_weekly_off,
            "total_count":   piece_count or 0,
            "session_count": idle_sessions or 0,
            "session_num":   idle_sessions or 0,
            "active_tracks": 0,
            "utilization":   avg_util,
            "runtime_s":     round(sm["run_s"], 1),
            "idle_s":        round(sm["idle_s"], 1),
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
               COALESCE(s.ExpectedPieces, (
                   SELECT TOP 1 s2.ExpectedPieces FROM dbo.AppSessions s2
                   WHERE s2.IssueNoCounter = s.IssueNoCounter AND s2.ExpectedPieces IS NOT NULL
                   ORDER BY s2.SessionId DESC
               )) AS ExpectedPieces,
               s.ProcessedPieces,
               wb.OrderNo, wb.ArticleName, wb.ColourName, wb.PartyName, wb.PK,
               ISNULL(s.session_type, 'PRODUCTION')
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
                 order_no, article_name, colour_name, party_name, pk_code,
                 session_type) = row
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
                    "session_type":    session_type or "PRODUCTION",
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
            COALESCE(s.ExpectedPieces, (
                SELECT TOP 1 s2.ExpectedPieces FROM dbo.AppSessions s2
                WHERE s2.IssueNoCounter = s.IssueNoCounter AND s2.ExpectedPieces IS NOT NULL
                ORDER BY s2.SessionId DESC
            )) AS ExpectedPieces,
            s.ProcessedPieces, s.Status,
            wb.OrderNo, wb.ArticleName, wb.ColourName, wb.PartyName, wb.PK,
            ISNULL(s.session_type, 'PRODUCTION')
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
                 order_no, article_name, colour_name, party_name, pk_code,
                 session_type) = row
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
                    "session_type":     session_type or "PRODUCTION",
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
    s = int(abs(seconds))
    h = s // 3600
    m = (s % 3600) // 60
    sec = s % 60
    return f"{h:02d}h {m:02d}m {sec:02d}s"


def _calc_overtime(s_start: datetime, s_end: datetime,
                   shift_start: datetime, shift_end: datetime) -> tuple[int, str | None]:
    """Returns (overtime_seconds, label) for portions of a session outside shift hours.

    Pre-shift  : session started before shift_start
    Post-shift : session ended   after  shift_end
    Both can apply (e.g. night-shift spanning midnight) — label uses ' + ' separator.
    """
    overtime_s = 0
    parts: list[str] = []
    if s_start < shift_start:
        ot_e = min(s_end, shift_start)
        seg  = int((ot_e - s_start).total_seconds())
        if seg > 0:
            overtime_s += seg
            parts.append(f"{s_start.strftime('%H:%M')} → {ot_e.strftime('%H:%M')}")
    if s_end > shift_end:
        ot_s = max(s_start, shift_end)
        seg  = int((s_end - ot_s).total_seconds())
        if seg > 0:
            overtime_s += seg
            parts.append(f"{ot_s.strftime('%H:%M')} → {s_end.strftime('%H:%M')}")
    return overtime_s, (" + ".join(parts) if parts else None)


def _merge_intervals(intervals: list[tuple]) -> list[tuple]:
    """Merge overlapping (start_dt, end_dt) intervals so they aren't double-counted.

    The inference client can write multiple idle-period records that overlap
    (e.g. belt stops → record created, belt restarts briefly, stops again →
    another record created, windows overlap). Without merging, summing them
    produces idle_s > session_s.
    """
    if not intervals:
        return []
    merged = [list(sorted(intervals, key=lambda x: x[0])[0])]
    for start, end in sorted(intervals, key=lambda x: x[0])[1:]:
        if start <= merged[-1][1]:          # overlaps or is adjacent
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(s, e) for s, e in merged]


def get_frame_metrics(from_date: str, to_date: str, plant: str | None = None) -> dict:
    """
    Returns {(date_str, unit): {"pieces": int, "runtime_s": float, "idle_s": float}}.

    Reads dbo.CurrentHourMetrics — the SAME frame-level table the live Floor
    View sums in get_plant_states() (hour buckets are never finalized/deleted,
    so this also covers past dates) — so report totals match the floor view.
    """
    plant_filter = "AND source_note = ?" if plant else ""
    params: list = [from_date, to_date]
    if plant:
        params.append(plant)

    sql = f"""
        SELECT CAST(hour_start AS DATE) AS d, source_note,
               SUM(ISNULL(piece_count, 0))               AS pieces,
               SUM(ISNULL(uptime_frames, 0)) * (1.0 / 5) AS runtime_s,
               SUM(ISNULL(idle_time_s, 0))               AS idle_s
        FROM dbo.CurrentHourMetrics
        WHERE hour_start >= ? AND hour_start < DATEADD(day, 1, ?)
        {plant_filter}
        GROUP BY CAST(hour_start AS DATE), source_note
    """

    result: dict[tuple[str, str], dict] = {}
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, params)
            for d, unit, pieces, runtime_s, idle_s in cur.fetchall():
                result[(str(d), unit)] = {
                    "pieces":    int(pieces or 0),
                    "runtime_s": float(runtime_s or 0),
                    "idle_s":    float(idle_s or 0),
                }
    except Exception as exc:
        print(f"[queries] get_frame_metrics error: {exc}")
    return result


def _get_shift_times() -> tuple[str, str]:
    """Returns (shift_start, shift_end) as 'HH:MM' from SystemSettings, default ('07:00', '17:00')."""
    times = {"shift_start": "07:00", "shift_end": "17:00"}
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT setting_key, setting_value FROM dbo.SystemSettings "
                "WHERE setting_key IN ('shift_start','shift_end')"
            )
            for key, value in cur.fetchall():
                if value:
                    times[key] = value
    except Exception:
        pass
    return times["shift_start"], times["shift_end"]


def _get_off_day_dates(from_date: str, to_date: str) -> set[str]:
    """Return set of ISO date strings in [from_date, to_date] that are weekly-off or holidays.

    Off days get zero run/idle in reports instead of 'whole shift = idle'.
    """
    from datetime import date as _date
    off_dates: set[str] = set()

    # Weekly off days from SystemSettings (CSV of 3-letter abbrevs, e.g. "Sun" or "Sat,Sun")
    csv_val = "Sun"
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT setting_value FROM dbo.SystemSettings WHERE setting_key = 'weekly_off_days'"
            )
            row = cur.fetchone()
            if row and row[0]:
                csv_val = row[0]
    except Exception:
        pass
    off_abbrevs = {d.strip() for d in csv_val.split(",") if d.strip()}

    d0 = _date.fromisoformat(from_date)
    d1 = _date.fromisoformat(to_date)
    _d = d0
    while _d <= d1:
        if _d.strftime("%a") in off_abbrevs:
            off_dates.add(_d.isoformat())
        _d += timedelta(days=1)

    # Public holidays from dbo.Holidays
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT CAST(holiday_date AS DATE) FROM dbo.Holidays "
                "WHERE holiday_date BETWEEN ? AND ?",
                (from_date, to_date),
            )
            for (hd,) in cur.fetchall():
                if hd:
                    off_dates.add(str(hd))
    except Exception:
        pass

    return off_dates


def _batch_session_metrics(
    from_date: str,
    to_date: str,
    plants: list[str],
) -> dict[tuple[str, str], dict]:
    """
    Returns {(date_str, plant): {run_s, idle_s, pieces}} for all requested
    (date, plant) pairs using exactly 3 DB queries total — one for shift times,
    one for all AppSessions, one for all IdlePeriods.

    Replaces per-call _session_metrics() in hot loops so endpoints that query
    multiple plants/dates don't open O(N) connections.
    """
    from datetime import date as _dt_date
    from collections import defaultdict

    if not plants:
        return {}

    # ── Shift times (1 query) ────────────────────────────────────────────────
    shift_start_str, shift_end_str = _get_shift_times()
    sh, sm_min = map(int, shift_start_str.split(":"))
    eh, em     = map(int, shift_end_str.split(":"))

    _SKEW = timedelta(seconds=60)
    _now  = datetime.now()
    today = _now.date()

    d0    = _dt_date.fromisoformat(from_date)
    d1    = _dt_date.fromisoformat(to_date)
    dates: list[_dt_date] = []
    _d    = d0
    while _d <= d1:
        dates.append(_d)
        _d += timedelta(days=1)

    ph = ",".join("?" * len(plants))

    # ── Batch sessions (1 query) ─────────────────────────────────────────────
    sessions_by_key: dict[tuple[str, str], list] = defaultdict(list)
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                f"SELECT CAST(s.StartTime AS DATE), s.Plant, "
                f"       s.StartTime, s.EndTime, s.ProcessedPieces "
                f"FROM dbo.AppSessions s "
                f"WHERE s.StartTime >= ? AND s.StartTime < DATEADD(day, 1, ?) "
                f"  AND s.Plant IN ({ph}) "
                f"  AND s.Status = 'COMPLETED' AND s.EndTime IS NOT NULL "
                f"ORDER BY s.Plant, s.StartTime",
                [from_date, to_date] + list(plants),
            )
            for dv, plant_id, st, et, pcs in cur.fetchall():
                sessions_by_key[(str(dv), plant_id)].append(
                    {"start_time": st, "end_time": et, "pieces": int(pcs or 0)}
                )
    except Exception:
        pass

    # ── Batch idle periods (1 query) ─────────────────────────────────────────
    idle_by_key: dict[tuple[str, str], list] = defaultdict(list)
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                f"SELECT CAST(idle_start AS DATE), source_note, idle_start, idle_end "
                f"FROM dbo.IdlePeriods "
                f"WHERE idle_start >= ? AND idle_start < DATEADD(day, 1, ?) "
                f"  AND source_note IN ({ph}) "
                f"ORDER BY source_note, idle_start",
                [from_date, to_date] + list(plants),
            )
            for dv, src, istart, iend in cur.fetchall():
                if istart and iend:
                    idle_by_key[(str(dv), src)].append((istart, iend))
    except Exception:
        pass

    # ── Off-day detection (weekly off + public holidays) ─────────────────────
    off_dates = _get_off_day_dates(from_date, to_date)

    # ── Compute per-(date, plant) ─────────────────────────────────────────────
    result: dict[tuple[str, str], dict] = {}
    for date_obj in dates:
        d_str = date_obj.isoformat()
        if date_obj > today or d_str in off_dates:
            # Future dates and off days (weekly off / holidays) get zeros — no idle penalty.
            for plant in plants:
                result[(d_str, plant)] = {"run_s": 0, "idle_s": 0, "break_s": 0, "pieces": 0}
            continue

        shift_start_dt = datetime(date_obj.year, date_obj.month, date_obj.day, sh, sm_min)
        shift_end_dt   = datetime(date_obj.year, date_obj.month, date_obj.day, eh, em)
        if date_obj == today:
            shift_end_dt = min(shift_end_dt, _now)

        for plant in plants:
            key          = (d_str, plant)
            sessions     = sessions_by_key.get(key, [])
            idle_periods = _merge_intervals(idle_by_key.get(key, []))
            eff_break    = _effective_break_window(date_obj, sessions)

            run_s   = 0
            idle_s  = 0
            break_s = 0
            pieces  = sum(s["pieces"] for s in sessions)

            if sessions and sessions[0]["start_time"] > shift_start_dt:
                for kind, seg_a, seg_b in _split_gap(shift_start_dt, sessions[0]["start_time"], eff_break):
                    seg = int((seg_b - seg_a).total_seconds())
                    if kind == "break":
                        break_s += seg
                    elif seg > 60:
                        idle_s += seg

            for i, s in enumerate(sessions):
                run_s += max(0, int((s["end_time"] - s["start_time"]).total_seconds()))

                for _ip_s, _ip_e in idle_periods:
                    if _ip_e <= s["start_time"] - _SKEW:
                        continue
                    if _ip_s >= s["end_time"] + _SKEW:
                        continue
                    _cs = max(_ip_s, s["start_time"], shift_start_dt)
                    _ce = min(_ip_e, s["end_time"],   shift_end_dt)
                    if _ce > _cs:
                        _dd = int((_ce - _cs).total_seconds())
                        if _dd > 0:
                            run_s  -= _dd
                            idle_s += _dd

                if i < len(sessions) - 1:
                    # Clip inter-session gap to shift hours — idle outside shift not counted
                    _gap_s = max(s["end_time"], shift_start_dt)
                    _gap_e = min(sessions[i + 1]["start_time"], shift_end_dt)
                    if _gap_e > _gap_s:
                        for kind, seg_a, seg_b in _split_gap(_gap_s, _gap_e, eff_break):
                            seg = int((seg_b - seg_a).total_seconds())
                            if kind == "break":
                                break_s += seg
                            elif seg > 60:
                                idle_s += seg

            if sessions and shift_end_dt > sessions[-1]["end_time"]:
                for kind, seg_a, seg_b in _split_gap(sessions[-1]["end_time"], shift_end_dt, eff_break):
                    seg = int((seg_b - seg_a).total_seconds())
                    if kind == "break":
                        break_s += seg
                    elif seg > 60:
                        idle_s += seg

            if not sessions:
                for kind, seg_a, seg_b in _split_gap(shift_start_dt, shift_end_dt, eff_break):
                    seg = int((seg_b - seg_a).total_seconds())
                    if kind == "break":
                        break_s += seg
                    else:
                        idle_s += seg

            result[key] = {"run_s": max(0, run_s), "idle_s": max(0, idle_s),
                            "break_s": break_s, "pieces": pieces}

    return result


def _session_metrics(date: str, plant: str) -> dict:
    """Single (date, plant) wrapper — use _batch_session_metrics() in loops."""
    return _batch_session_metrics(date, date, [plant]).get((date, plant),
                                                           {"run_s": 0, "idle_s": 0, "break_s": 0, "pieces": 0})


def get_daily_detail(report_date: str, plant: str | None = None) -> dict:
    """
    Session timeline (lots worked) for one date, with summary totals (Total
    Run Time, Total Idle Time, Pieces Processed, Utilisation) computed by
    summing the rows in that same timeline, so the footer matches the table.
    """
    params: list = [report_date, report_date]
    plant_filter = ""
    if plant:
        plant_filter = "AND s.Plant = ?"
        params.append(plant)

    # OUTER APPLY + TOP 1 avoids fan-out duplicates when WBIssuance_Info has
    # multiple rows for the same IssueNoCounter (LEFT JOIN would multiply rows).
    sql = f"""
        SELECT s.SessionId, s.LotNo, s.Plant, s.StartTime, s.EndTime,
               s.ExpectedPieces, s.ProcessedPieces,
               wb.OrderNo, wb.ArticleName, wb.ColourName, wb.PartyName,
               ISNULL(s.session_type, 'PRODUCTION')
        FROM dbo.AppSessions s
        OUTER APPLY (
            SELECT TOP 1 OrderNo, ArticleName, ColourName, PartyName
            FROM dbo.WBIssuance_Info
            WHERE IssueNoCounter = s.IssueNoCounter
            ORDER BY PK DESC
        ) wb
        WHERE s.StartTime >= ? AND s.StartTime < DATEADD(day, 1, ?)
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

    _MODE_TYPES = {"WASHING", "COLOR_MATCHING", "MAINTENANCE"}

    from collections import defaultdict
    by_plant: dict[str, list] = defaultdict(list)
    for row in raw_rows:
        (sid, lot_no, plant_id, start_time, end_time,
         exp_pcs, proc_pcs, order_no, article_name, colour_name, party_name,
         session_type) = row
        by_plant[plant_id].append({
            "start_time":   start_time,
            "end_time":     end_time,
            "lot_no":       str(lot_no) if lot_no else None,
            "session_type": session_type or "PRODUCTION",
            "pieces":       int(proc_pcs) if proc_pcs else 0,
            "order_no":     order_no,
            "article_name": article_name,
            "colour_name":  colour_name,
            "party_name":   party_name,
        })

    shift_start_str, shift_end_str = _get_shift_times()
    sh, sm = map(int, shift_start_str.split(":"))
    eh, em = map(int, shift_end_str.split(":"))
    report_d = datetime.fromisoformat(report_date).date()
    shift_start_dt      = datetime(report_d.year, report_d.month, report_d.day, sh, sm)
    shift_end_dt        = datetime(report_d.year, report_d.month, report_d.day, eh, em)
    _shift_end_original = shift_end_dt   # uncapped — used for overtime boundary

    now = datetime.now()
    if report_d == now.date():
        shift_end_dt = min(shift_end_dt, now)
    elif report_d > now.date():
        shift_end_dt = shift_start_dt

    # For today's report, track which plants are currently in an INPROCESS session
    # so we don't emit a trailing idle row after their last completed session.
    _active_plants: set[str] = set()
    if report_d == now.date():
        try:
            with get_connection() as _ac:
                _acur = _ac.cursor()
                _acur.execute(
                    "SELECT DISTINCT Plant FROM dbo.AppSessions WHERE Status = 'INPROCESS'"
                )
                for (_ap,) in _acur.fetchall():
                    _active_plants.add(str(_ap))
        except Exception:
            pass

    # Fetch within-session idle periods from IdlePeriods (written by inference-client).
    # Grouped by plant so we can join against each session's window below.
    _idle_params: list = [report_date, report_date]
    _idle_pf = "AND source_note = ?" if plant else ""
    if plant:
        _idle_params.append(plant)
    try:
        with get_connection() as _ic:
            _icur = _ic.cursor()
            _icur.execute(
                f"SELECT source_note, idle_start, idle_end FROM dbo.IdlePeriods "
                f"WHERE idle_start >= ? AND idle_start < DATEADD(day, 1, ?) {_idle_pf} "
                f"ORDER BY source_note, idle_start",
                _idle_params,
            )
            _idle_raw = _icur.fetchall()
    except Exception:
        _idle_raw = []

    from collections import defaultdict as _dd
    _idle_by_plant: dict[str, list] = _dd(list)
    for _src, _istart, _iend in _idle_raw:
        if _istart and _iend:
            _idle_by_plant[str(_src)].append((_istart, _iend))

    _SKEW = timedelta(seconds=60)   # tolerance for accounted-session StartTime clock skew

    units = [plant] if plant else UNITS
    result_plants = []
    for plant_id in units:
        sessions         = by_plant.get(plant_id, [])
        eff_break        = _effective_break_window(report_d, sessions)
        _plant_idle_ivs  = _merge_intervals(_idle_by_plant.get(plant_id, []))
        rows_out    = []
        run_s       = 0
        idle_s      = 0
        break_s     = 0
        overtime_s  = 0
        pieces      = 0

        # ── Absorb mode sessions that fall entirely within the break window ──
        # They become nested sub-rows inside the BREAK TIME row instead of
        # appearing as separate top-level session rows. Their pieces are still
        # counted; their duration is part of break time, not run time.
        _absorbed: list[dict] = []
        _main_sessions: list[dict] = []
        if eff_break:
            _bk_s, _bk_e = eff_break
            for _s in sessions:
                if (_s["session_type"] in _MODE_TYPES
                        and _s["start_time"] >= _bk_s
                        and _s["end_time"] <= _bk_e):
                    _absorbed.append(_s)
                else:
                    _main_sessions.append(_s)
        else:
            _main_sessions = sessions

        _break_sub_rows: list[dict] = []
        for _s in sorted(_absorbed, key=lambda x: x["start_time"]):
            _dur = max(0, int((_s["end_time"] - _s["start_time"]).total_seconds()))
            _st = _s["session_type"]
            _break_sub_rows.append({
                "row_type":       "session",
                "lot_no":         _st.replace("_", " "),
                "session_type":   _st,
                "pieces":         _s["pieces"],
                "plant":          plant_id,
                "start_time":     _s["start_time"].strftime("%H:%M"),
                "end_time":       _s["end_time"].strftime("%H:%M"),
                "duration_label": _fmt_duration(_dur),
                "order_no": "N/A", "party_name": "N/A",
                "article_name": "N/A", "colour_name": "N/A",
            })
            pieces += _s["pieces"]

        # ── Emit rows using only _main_sessions so gaps span the full break ──
        _sub = _break_sub_rows or None   # pass None when empty

        if not _main_sessions and sessions:
            # Only absorbed sessions exist — emit the full shift as one gap block
            add_idle, add_break = _emit_gap_rows(
                shift_start_dt, shift_end_dt, eff_break, rows_out, _sub)
            idle_s  += add_idle
            break_s += add_break
        else:
            if _main_sessions and _main_sessions[0]["start_time"] > shift_start_dt:
                add_idle, add_break = _emit_gap_rows(
                    shift_start_dt, _main_sessions[0]["start_time"], eff_break, rows_out, _sub)
                idle_s  += add_idle
                break_s += add_break

            for i, s in enumerate(_main_sessions):
                dur_s = int((s["end_time"] - s["start_time"]).total_seconds())
                if dur_s < 0:
                    dur_s = 0
                run_s  += dur_s
                pieces += s["pieces"]
                _stype = s.get("session_type", "PRODUCTION")
                _label = (
                    _stype.replace("_", " ") if _stype in _MODE_TYPES
                    else (s["lot_no"] or "UNACCOUNTED")
                )
                _ot_s, _ot_label = _calc_overtime(
                    s["start_time"], s["end_time"], shift_start_dt, _shift_end_original)
                overtime_s += _ot_s
                rows_out.append({
                    "row_type":       "session",
                    "lot_no":         _label,
                    "session_type":   _stype,
                    "order_no":       s["order_no"]     or "N/A",
                    "party_name":     s["party_name"]   or "N/A",
                    "article_name":   s["article_name"] or "N/A",
                    "colour_name":    s["colour_name"]  or "N/A",
                    "pieces":         s["pieces"],
                    "plant":          plant_id,
                    "start_time":     s["start_time"].strftime("%H:%M"),
                    "end_time":       s["end_time"].strftime("%H:%M"),
                    "duration_label": _fmt_duration(dur_s),
                    "overtime_s":     _ot_s,
                    "overtime_label": _ot_label,
                })

                # Within-session idle — accumulate into a field on the session row
                # instead of adding separate idle rows to the timeline.
                # _plant_idle_ivs is pre-merged so overlapping intervals can't
                # push _within_idle_s above the actual session duration.
                _within_idle_s = 0
                for _ip_start, _ip_end in _plant_idle_ivs:
                    if _ip_end <= s["start_time"] - _SKEW:
                        continue
                    if _ip_start >= s["end_time"] + _SKEW:
                        continue
                    _cs = max(_ip_start, s["start_time"], shift_start_dt)
                    _ce = min(_ip_end,   s["end_time"],   shift_end_dt)
                    if _ce <= _cs:
                        continue
                    _ip_dur = int((_ce - _cs).total_seconds())
                    if _ip_dur > 0:
                        _within_idle_s += _ip_dur
                _within_idle_s = min(_within_idle_s, dur_s)  # safety cap
                _active_s = dur_s - _within_idle_s
                run_s  -= _within_idle_s
                idle_s += _within_idle_s
                rows_out[-1]["active_label"] = _fmt_duration(_active_s)
                if _within_idle_s > 1:                        # suppress sub-second noise
                    rows_out[-1]["idle_within_label"] = _fmt_duration(_within_idle_s)

                if i < len(_main_sessions) - 1:
                    # Clip inter-session gap to shift hours — idle outside shift not shown/counted
                    _gap_s = max(s["end_time"], shift_start_dt)
                    _gap_e = min(_main_sessions[i + 1]["start_time"], shift_end_dt)
                    if _gap_e > _gap_s:
                        add_idle, add_break = _emit_gap_rows(
                            _gap_s, _gap_e, eff_break, rows_out, _sub)
                        idle_s  += add_idle
                        break_s += add_break

            if _main_sessions and shift_end_dt > _main_sessions[-1]["end_time"]:
                # Skip trailing idle when the plant is currently running a session —
                # the gap from last completed session to now is active, not idle.
                if plant_id not in _active_plants:
                    add_idle, add_break = _emit_gap_rows(
                        _main_sessions[-1]["end_time"], shift_end_dt, eff_break, rows_out, _sub)
                    idle_s  += add_idle
                    break_s += add_break

        observed_s = run_s + idle_s
        util_pct   = round(run_s / observed_s * 100, 1) if observed_s else 0
        result_plants.append({
            "plant":         plant_id,
            "session_start": sessions[0]["start_time"].strftime("%H:%M") if sessions else None,
            "session_end":   sessions[-1]["end_time"].strftime("%H:%M")  if sessions else None,
            "rows":  rows_out,
            "totals": {
                "run_label":       _fmt_duration(run_s),
                "idle_label":      _fmt_duration(idle_s),
                "break_label":     _fmt_duration(break_s),
                "overtime_s":      overtime_s,
                "overtime_label":  _fmt_duration(overtime_s) if overtime_s > 0 else None,
                "run_time_min":    round(run_s   / 60),
                "idle_time_min":   round(idle_s  / 60),
                "break_time_min":  round(break_s / 60),
                "pieces":          pieces,
                "utilization_pct": util_pct,
            },
        })

    return {"date": report_date, "plants": result_plants}


def get_plant_wise(from_date: str, to_date: str, plant: str | None = None) -> list[dict]:
    """
    Per-day, per-plant summary over a date range.
    run/idle sourced from _session_metrics() (AppSessions + IdlePeriods) so
    numbers match Daily Detail and Floor View. Pieces still from get_frame_metrics()
    (camera-based; small accepted gap vs session-based pieces).
    """
    from datetime import date as _date, timedelta

    frame_metrics   = get_frame_metrics(from_date, to_date, plant=plant)   # pieces only
    units           = [plant] if plant else UNITS
    session_metrics = _batch_session_metrics(from_date, to_date, units)
    off_dates       = _get_off_day_dates(from_date, to_date)

    d0 = _date.fromisoformat(from_date)
    d1 = _date.fromisoformat(to_date)

    result = []
    d = d0
    while d <= d1:
        d_str = d.isoformat()
        # Skip off days entirely — no row in plant-wise for weekly-off / holidays
        if d_str in off_dates:
            d += timedelta(days=1)
            continue
        for unit in units:
            sm         = session_metrics.get((d_str, unit), {"run_s": 0, "idle_s": 0})
            run_s      = sm["run_s"]
            idle_s     = sm["idle_s"]
            fm         = frame_metrics.get((d_str, unit), {"pieces": 0})
            # Skip days with no data at all
            if run_s == 0 and idle_s == 0 and fm["pieces"] == 0:
                continue
            observed_s = run_s + idle_s
            util_pct   = round(run_s / observed_s * 100, 1) if observed_s else 0
            result.append({
                "date":             d_str,
                "plant":            unit,
                "run_time_label":   _fmt_duration(int(run_s)),
                "idle_time_label":  _fmt_duration(int(idle_s)),
                "run_time_s":       int(run_s),
                "idle_time_s":      int(idle_s),
                "pieces":           fm["pieces"],
                "utilization_pct":  util_pct,
            })
        d += timedelta(days=1)
    return result
