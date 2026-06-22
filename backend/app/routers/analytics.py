"""
Analytics endpoints for real-time aggregated data.
Queries dbo.CurrentHourMetrics directly (hour buckets are never deleted,
so they cover today's partial hour and all historical hours/days).
"""

import logging
from fastapi import APIRouter, HTTPException, Query
from datetime import date, datetime, timedelta
from app.db.connection import get_connection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/by-hour")
def analytics_by_hour(
    date_param: str = Query(..., alias="date", description="YYYY-MM-DD"),
    unit: str = Query(..., description="e.g. SP-01"),
):
    """Hourly breakdown for one unit on a given date."""
    try:
        sql = """
            SELECT DATEPART(HOUR, hour_start)                               AS hour,
                   SUM(ISNULL(piece_count,      0))                         AS pieces,
                   CASE WHEN SUM(frame_count) > 0
                        THEN SUM(uptime_frames)   * 100.0 / SUM(frame_count)
                        ELSE 0 END                                          AS uptime_pct,
                   CASE WHEN SUM(frame_count) > 0
                        THEN SUM(downtime_frames) * 100.0 / SUM(frame_count)
                        ELSE 0 END                                          AS downtime_pct,
                   SUM(ISNULL(idle_sessions_count, 0))                      AS idle_sessions,
                   SUM(ISNULL(idle_time_s,         0))                      AS idle_time_s,
                   CASE WHEN SUM(frame_count) > 0
                        THEN SUM(ISNULL(sum_utilization, 0)) / SUM(frame_count)
                        ELSE 0 END                                          AS avg_utilization_pct
            FROM dbo.CurrentHourMetrics
            WHERE source_note = ? AND hour_start >= ? AND hour_start < DATEADD(day, 1, ?)
            GROUP BY DATEPART(HOUR, hour_start)
            ORDER BY DATEPART(HOUR, hour_start)
        """
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, (unit, date_param, date_param))
            rows = cur.fetchall()

        return [
            {
                "hour":               row[0],
                "pieces":             int(row[1] or 0),
                "uptime_pct":         float(row[2] or 0),
                "downtime_pct":       float(row[3] or 0),
                "idle_sessions":      int(row[4] or 0),
                "idle_time_s":        float(row[5] or 0),
                "avg_utilization_pct": float(row[6] or 0),
            }
            for row in rows
        ]
    except Exception as exc:
        logger.error("by-hour failed unit=%s date=%s: %s", unit, date_param, exc, exc_info=True)
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/by-day")
def analytics_by_day(
    from_date: str = Query(None, alias="from", description="YYYY-MM-DD"),
    to_date:   str = Query(None, alias="to",   description="YYYY-MM-DD"),
    unit: str = Query(None, description="Optional unit filter e.g. SP-01"),
):
    """Daily aggregation over a date range, optionally filtered to one unit."""
    try:
        # Default to last 7 days
        _to   = to_date   or datetime.now().strftime("%Y-%m-%d")
        _from = from_date or (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

        sql = """
            SELECT CAST(hour_start AS DATE)                                 AS date,
                   source_note                                              AS unit,
                   SUM(ISNULL(piece_count,      0))                         AS pieces,
                   CASE WHEN SUM(frame_count) > 0
                        THEN SUM(uptime_frames)   * 100.0 / SUM(frame_count)
                        ELSE 0 END                                          AS uptime_pct,
                   CASE WHEN SUM(frame_count) > 0
                        THEN SUM(downtime_frames) * 100.0 / SUM(frame_count)
                        ELSE 0 END                                          AS downtime_pct,
                   SUM(ISNULL(idle_sessions_count, 0))                      AS idle_sessions,
                   SUM(ISNULL(idle_time_s,         0))                      AS idle_time_s,
                   CASE WHEN SUM(frame_count) > 0
                        THEN SUM(ISNULL(sum_utilization, 0)) / SUM(frame_count)
                        ELSE 0 END                                          AS avg_utilization_pct
            FROM dbo.CurrentHourMetrics
            WHERE hour_start >= ? AND hour_start < DATEADD(day, 1, ?)
              AND (? IS NULL OR source_note = ?)
            GROUP BY CAST(hour_start AS DATE), source_note
            ORDER BY CAST(hour_start AS DATE), source_note
        """
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, (_from, _to, unit, unit))
            rows = cur.fetchall()

        return [
            {
                "date":               str(row[0]),
                "unit":               row[1],
                "pieces":             int(row[2] or 0),
                "uptime_pct":         float(row[3] or 0),
                "downtime_pct":       float(row[4] or 0),
                "idle_sessions":      int(row[5] or 0),
                "idle_time_s":        float(row[6] or 0),
                "avg_utilization_pct": float(row[7] or 0),
            }
            for row in rows
        ]
    except Exception as exc:
        logger.error("by-day failed from=%s to=%s unit=%s: %s", from_date, to_date, unit, exc, exc_info=True)
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/by-shift")
def analytics_by_shift(
    from_date: str = Query(None, alias="from", description="YYYY-MM-DD"),
    to_date:   str = Query(None, alias="to",   description="YYYY-MM-DD"),
    unit: str = Query(None, description="Optional unit filter e.g. SP-01"),
):
    """Shift breakdown (Morning 06–14, Afternoon 14–22, Night 22–06)."""
    try:
        _to   = to_date   or datetime.now().strftime("%Y-%m-%d")
        _from = from_date or (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

        sql = """
            SELECT CAST(hour_start AS DATE)                                 AS date,
                   source_note                                              AS unit,
                   CASE
                     WHEN DATEPART(HOUR, hour_start) BETWEEN  6 AND 13 THEN 'Morning'
                     WHEN DATEPART(HOUR, hour_start) BETWEEN 14 AND 21 THEN 'Afternoon'
                     ELSE 'Night'
                   END                                                      AS shift,
                   SUM(ISNULL(piece_count, 0))                              AS pieces,
                   CASE WHEN SUM(frame_count) > 0
                        THEN SUM(uptime_frames) * 100.0 / SUM(frame_count)
                        ELSE 0 END                                          AS uptime_pct
            FROM dbo.CurrentHourMetrics
            WHERE hour_start >= ? AND hour_start < DATEADD(day, 1, ?)
              AND (? IS NULL OR source_note = ?)
            GROUP BY CAST(hour_start AS DATE), source_note,
                     CASE
                       WHEN DATEPART(HOUR, hour_start) BETWEEN  6 AND 13 THEN 'Morning'
                       WHEN DATEPART(HOUR, hour_start) BETWEEN 14 AND 21 THEN 'Afternoon'
                       ELSE 'Night'
                     END
            ORDER BY CAST(hour_start AS DATE), source_note, shift
        """
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, (_from, _to, unit, unit))
            rows = cur.fetchall()

        return [
            {
                "date":       str(row[0]),
                "unit":       row[1],
                "shift":      row[2],
                "pieces":     int(row[3] or 0),
                "uptime_pct": float(row[4] or 0),
            }
            for row in rows
        ]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))
