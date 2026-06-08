from fastapi import APIRouter, HTTPException, Query
from app.db import queries

router = APIRouter(prefix="/api", tags=["counts"])

VALID_UNITS = {"SP-01", "SP-02", "SP-03", "SP-04", "SP-05", "SP-06"}


def _validate_unit(unit: str | None):
    if unit and unit not in VALID_UNITS:
        raise HTTPException(status_code=400, detail=f"Unknown unit: {unit}. Valid: {sorted(VALID_UNITS)}")


# ── Latest counts ─────────────────────────────────────────────────────────────

@router.get("/counts")
def get_counts():
    """Latest total_count + belt_active for all units."""
    try:
        return queries.get_latest_counts()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/counts/{unit_id}")
def get_count_for_unit(unit_id: str):
    """Latest count for a single unit."""
    _validate_unit(unit_id)
    try:
        rows = queries.get_latest_counts()
        match = next((r for r in rows if r["unit"] == unit_id), None)
        if match is None:
            return {"unit": unit_id, "total_count": 0, "belt_active": False, "saved_at": None}
        return match
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


# ── Unit status ───────────────────────────────────────────────────────────────

@router.get("/units/status")
def get_unit_status():
    """
    Active/idle status for all 6 units.
    A unit is 'active' if its most recent log row has belt_active=True
    and was saved within the last 5 minutes.
    """
    from datetime import datetime, timezone, timedelta

    try:
        rows = queries.get_latest_counts()
        by_unit = {r["unit"]: r for r in rows}
        now = datetime.now(timezone.utc)
        result = []
        for unit in sorted(VALID_UNITS):
            row = by_unit.get(unit)
            if row is None:
                result.append({"unit": unit, "status": "unknown", "total_count": 0})
                continue

            saved_at = row["saved_at"]
            recent = False
            if saved_at:
                try:
                    ts = datetime.fromisoformat(saved_at)
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    recent = (now - ts) < timedelta(minutes=5)
                except ValueError:
                    pass

            status = "active" if (row["belt_active"] and recent) else "idle"
            result.append({"unit": unit, "status": status, "total_count": row["total_count"]})
        return result
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


# ── Sessions ──────────────────────────────────────────────────────────────────

@router.get("/monitoring-sessions")
def get_sessions(
    unit: str | None = Query(None),
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
):
    _validate_unit(unit)
    try:
        return queries.get_sessions(unit=unit, from_date=from_date, to_date=to_date)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


# ── Idle periods ──────────────────────────────────────────────────────────────

@router.get("/idle-periods")
def get_idle_periods(
    unit: str | None = Query(None),
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
):
    _validate_unit(unit)
    try:
        return queries.get_idle_periods(unit=unit, from_date=from_date, to_date=to_date)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


# ── Summary ───────────────────────────────────────────────────────────────────

@router.get("/summary")
def get_summary(
    unit: str | None = Query(None),
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
):
    _validate_unit(unit)
    try:
        return queries.get_summary(unit=unit, from_date=from_date, to_date=to_date)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))
