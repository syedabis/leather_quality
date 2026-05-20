from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.db.connection import get_connection

router = APIRouter(prefix="/api/settings", tags=["settings"])

CLEARABLE_TABLES = [
    "dbo.CurrentHourMetrics",
    "dbo.HourlyMetrics",
    "dbo.DailyMetrics",
    "dbo.LeatherCountLog",
    "dbo.LeatherSessions",
    "dbo.IdlePeriods",
]


class SettingsUpdate(BaseModel):
    idle_timeout_sec: int = Field(..., ge=5, le=3600)
    downtime_threshold_sec: int = Field(..., ge=30, le=7200)


@router.get("")
def get_settings():
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT key, value FROM dbo.SystemSettings")
            rows = cur.fetchall()
            return {row[0]: row[1] for row in rows}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.put("")
def update_settings(body: SettingsUpdate):
    updates = [
        ("idle_timeout_sec",      str(body.idle_timeout_sec)),
        ("downtime_threshold_sec", str(body.downtime_threshold_sec)),
    ]
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            for key, value in updates:
                cur.execute(
                    """
                    MERGE dbo.SystemSettings AS target
                    USING (SELECT ? AS key, ? AS value) AS src ON target.key = src.key
                    WHEN MATCHED THEN UPDATE SET value = src.value, updated_at = GETDATE()
                    WHEN NOT MATCHED THEN INSERT (key, value) VALUES (src.key, src.value);
                    """,
                    (key, value),
                )
            conn.commit()
        return {"status": "ok", **dict(updates)}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/clear-db")
def clear_database():
    cleared = []
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            for table in CLEARABLE_TABLES:
                try:
                    cur.execute(
                        f"IF OBJECT_ID('{table}', 'U') IS NOT NULL TRUNCATE TABLE {table}"
                    )
                    cleared.append(table)
                except Exception:
                    pass
            conn.commit()
        return {"status": "ok", "cleared": cleared}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
