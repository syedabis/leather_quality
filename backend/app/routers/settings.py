from datetime import date as _date
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
    shift_start: str = Field("07:00")
    shift_end: str = Field("17:00")
    break_start_weekday: str = Field("13:00")
    break_end_weekday:   str = Field("14:00")
    break_start_friday:  str = Field("13:00")
    break_end_friday:    str = Field("14:30")
    weekly_off_days:     str = Field("Sun", description="CSV of 3-letter weekday names, e.g. 'Sun' or 'Sat,Sun'")


class HolidayCreate(BaseModel):
    date:        str          = Field(..., description="YYYY-MM-DD")
    description: str = Field("", max_length=255)


@router.get("")
def get_settings():
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT setting_key, setting_value FROM dbo.SystemSettings")
            rows = cur.fetchall()
            return {row[0]: row[1] for row in rows}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.put("")
def update_settings(body: SettingsUpdate):
    updates = [
        ("idle_timeout_sec",       str(body.idle_timeout_sec)),
        ("downtime_threshold_sec", str(body.downtime_threshold_sec)),
        ("shift_start",            body.shift_start),
        ("shift_end",              body.shift_end),
        ("break_start_weekday",    body.break_start_weekday),
        ("break_end_weekday",      body.break_end_weekday),
        ("break_start_friday",     body.break_start_friday),
        ("break_end_friday",       body.break_end_friday),
        ("weekly_off_days",        body.weekly_off_days),
    ]
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            for skey, svalue in updates:
                cur.execute(
                    """
                    MERGE dbo.SystemSettings AS target
                    USING (SELECT ? AS setting_key, ? AS setting_value) AS src
                        ON target.setting_key = src.setting_key
                    WHEN MATCHED THEN
                        UPDATE SET setting_value = src.setting_value, updated_at = GETDATE()
                    WHEN NOT MATCHED THEN
                        INSERT (setting_key, setting_value) VALUES (src.setting_key, src.setting_value);
                    """,
                    (skey, svalue),
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


# ── Holidays ──────────────────────────────────────────────────────────────────

def _ensure_holidays_table(cur) -> None:
    """Safety net: create dbo.Holidays if it isn't there yet (e.g. on older DBs)."""
    cur.execute(
        """
        IF OBJECT_ID('dbo.Holidays', 'U') IS NULL
        CREATE TABLE dbo.Holidays (
            holiday_date DATE PRIMARY KEY,
            description  NVARCHAR(255) NOT NULL DEFAULT '',
            created_at   DATETIME2 DEFAULT GETDATE()
        );
        """
    )


@router.get("/holidays")
def list_holidays():
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            _ensure_holidays_table(cur)
            cur.execute(
                "SELECT CONVERT(varchar(10), holiday_date, 23), description "
                "FROM dbo.Holidays ORDER BY holiday_date DESC"
            )
            rows = [{"date": r[0], "description": r[1] or ""} for r in cur.fetchall()]
        return rows
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/holidays")
def add_holiday(body: HolidayCreate):
    # Validate YYYY-MM-DD
    try:
        _date.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            _ensure_holidays_table(cur)
            cur.execute(
                """
                MERGE dbo.Holidays AS target
                USING (SELECT CAST(? AS DATE) AS holiday_date, ? AS description) AS src
                    ON target.holiday_date = src.holiday_date
                WHEN MATCHED THEN
                    UPDATE SET description = src.description
                WHEN NOT MATCHED THEN
                    INSERT (holiday_date, description) VALUES (src.holiday_date, src.description);
                """,
                (body.date, body.description),
            )
            conn.commit()
        return {"status": "ok", "date": body.date, "description": body.description}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.delete("/holidays/{holiday_date}")
def delete_holiday(holiday_date: str):
    try:
        _date.fromisoformat(holiday_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            _ensure_holidays_table(cur)
            cur.execute("DELETE FROM dbo.Holidays WHERE holiday_date = ?", (holiday_date,))
            conn.commit()
        return {"status": "ok", "date": holiday_date}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


# ── Plant Targets ─────────────────────────────────────────────────────────────

def _ensure_targets_table(cur) -> None:
    cur.execute(
        """
        IF OBJECT_ID('dbo.PlantTargetPeriods', 'U') IS NULL
        CREATE TABLE dbo.PlantTargetPeriods (
            id           INT IDENTITY PRIMARY KEY,
            unit         VARCHAR(10)  NOT NULL,
            from_date    DATE         NOT NULL,
            daily_target INT          NOT NULL,
            created_at   DATETIME2    DEFAULT GETDATE()
        );
        """
    )


class TargetCreate(BaseModel):
    unit:         str = Field(..., description="Plant ID e.g. SP-01, or 'ALL'")
    from_date:    str = Field(..., description="YYYY-MM-DD — target applies from this date onwards")
    daily_target: int = Field(..., ge=1, le=999999)


@router.get("/targets")
def list_targets():
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            _ensure_targets_table(cur)
            cur.execute(
                "SELECT id, unit, CONVERT(varchar(10), from_date, 23), daily_target "
                "FROM dbo.PlantTargetPeriods ORDER BY from_date DESC, id DESC"
            )
            rows = [{"id": r[0], "unit": r[1], "from_date": r[2], "daily_target": r[3]}
                    for r in cur.fetchall()]
        return rows
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/targets")
def add_target(body: TargetCreate):
    try:
        _date.fromisoformat(body.from_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="from_date must be YYYY-MM-DD")
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            _ensure_targets_table(cur)
            cur.execute(
                "INSERT INTO dbo.PlantTargetPeriods (unit, from_date, daily_target) "
                "OUTPUT INSERTED.id VALUES (?, ?, ?)",
                (body.unit, body.from_date, body.daily_target),
            )
            new_id = cur.fetchone()[0]
            conn.commit()
        return {"status": "ok", "id": new_id, "unit": body.unit,
                "from_date": body.from_date, "daily_target": body.daily_target}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.delete("/targets/{target_id}")
def delete_target(target_id: int):
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            _ensure_targets_table(cur)
            cur.execute("DELETE FROM dbo.PlantTargetPeriods WHERE id = ?", (target_id,))
            conn.commit()
        return {"status": "ok", "id": target_id}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
