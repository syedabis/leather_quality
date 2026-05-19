"""
Analytics endpoints for real-time aggregated data.
Uses hybrid caching with CurrentHourMetrics + HourlyMetrics for sub-10ms responses.
"""

from fastapi import APIRouter, HTTPException, Query
from datetime import date, datetime, timedelta
from app.db.connection import get_connection

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/by-hour")
def analytics_by_hour(
    date_param: str = Query(..., alias="date", description="YYYY-MM-DD"),
    unit: str = Query("SP3", description="SP3, SP4, ..., SP8"),
):
    """
    Hourly analytics breakdown for a specific date.

    Returns completed hours from HourlyMetrics + current partial hour from CurrentHourMetrics.
    Response time: <10ms

    Example: /api/analytics/by-hour?date=2026-04-30&unit=SP3
    """
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("EXEC sp_analytics_by_hour @unit=?, @date=?", (unit, date_param))
            rows = cur.fetchall()

        result = []
        for row in rows:
            result.append({
                "hour": row[0],
                "pieces": row[1],
                "uptime_pct": float(row[2]) if row[2] is not None else 0,
                "downtime_pct": float(row[3]) if row[3] is not None else 0,
                "idle_sessions": row[4],
                "idle_time_s": row[5],
                "avg_utilization_pct": float(row[6]) if row[6] is not None else 0,
            })
        return result
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/by-day")
def analytics_by_day(
    from_date: str = Query(None, alias="from", description="YYYY-MM-DD"),
    to_date: str = Query(None, alias="to", description="YYYY-MM-DD"),
    unit: str = Query(None, description="Optional unit filter (SP3-SP8)"),
):
    """
    Daily analytics breakdown for a date range.

    Returns aggregated daily metrics from HourlyMetrics.
    Response time: <20ms

    Example: /api/analytics/by-day?from=2026-04-23&to=2026-04-30&unit=SP3
    """
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "EXEC sp_analytics_by_day @unit=?, @from_date=?, @to_date=?",
                (unit, from_date, to_date)
            )
            rows = cur.fetchall()

        result = []
        for row in rows:
            result.append({
                "date": str(row[0]),
                "unit": row[1],
                "pieces": row[2],
                "uptime_pct": float(row[3]) if row[3] is not None else 0,
                "downtime_pct": float(row[4]) if row[4] is not None else 0,
                "idle_sessions": row[5],
                "idle_time_s": row[6],
                "avg_utilization_pct": float(row[7]) if row[7] is not None else 0,
            })
        return result
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/by-shift")
def analytics_by_shift(
    from_date: str = Query(None, alias="from", description="YYYY-MM-DD"),
    to_date: str = Query(None, alias="to", description="YYYY-MM-DD"),
    unit: str = Query(None, description="Optional unit filter (SP3-SP8)"),
):
    """
    Shift analytics breakdown (Morning 06-14, Afternoon 14-22, Night 22-06).

    Response time: <20ms

    Example: /api/analytics/by-shift?from=2026-04-23&to=2026-04-30&unit=SP3
    """
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "EXEC sp_analytics_by_shift @unit=?, @from_date=?, @to_date=?",
                (unit, from_date, to_date)
            )
            rows = cur.fetchall()

        result = []
        for row in rows:
            result.append({
                "date": str(row[0]),
                "unit": row[1],
                "shift": row[2],
                "pieces": row[3],
                "uptime_pct": float(row[4]) if row[4] is not None else 0,
            })
        return result
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))
