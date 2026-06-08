from fastapi import APIRouter, Query
from app.db.queries import get_app_sessions

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("")
def list_sessions(
    plant: str | None = Query(None, description="Filter by plant ID, e.g. SP-01"),
    limit: int        = Query(200,  ge=1, le=1000),
):
    return get_app_sessions(plant=plant, limit=limit)
