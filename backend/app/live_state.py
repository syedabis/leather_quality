"""
live_state.py — in-memory fallback for live piece/session data, pushed by
inference-client ONLY while its own DB connection is down.

Camera frames already reach the backend over a channel that bypasses SQL
Server entirely (POST /api/frame/{plant}, see websocket/plant_feed.py).
Piece counts and session/lot info had no equivalent -- they only ever came
from querying SQL Server, so Floor View fell back to "no data" placeholders
during an outage even though inference-client knew the real numbers the
whole time. This is that second channel, mirroring the same in-memory,
no-DB-required pattern as the frame store.

Entries expire after STALE_AFTER_S so a plant that stops pushing (e.g. the
DB came back and it stopped needing to) doesn't leave a stuck fallback
value that overrides real DB data forever.
"""
import time

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

STALE_AFTER_S = 15

_store: dict[str, dict] = {}


class LiveStatePayload(BaseModel):
    total_count:     int
    belt_active:     bool = True
    has_session:     bool = False          # anything active worth reporting below
    session_type:    str = "PRODUCTION"    # mode name (WASHING/COLOR_MATCHING/MAINTENANCE) or "PRODUCTION"
    type:            str | None = None     # "accounted" | "unaccounted" | None (mode sessions have no type)
    lot_no:          str | None = None
    expected_pieces: int | None = None
    current_pieces:  int = 0
    order_no:        str | None = None
    article_name:    str | None = None
    colour_name:     str | None = None
    party_name:      str | None = None
    start_time:      str | None = None     # ISO timestamp


@router.post("/api/live-state/{plant_id}", status_code=200)
async def push_live_state(plant_id: str, payload: LiveStatePayload):
    """Inference client pushes here only while its own DB connection is
    down (see run_all_plants.py's _push_live_state), so Floor View can show
    real numbers instead of an offline placeholder during an outage."""
    _store[plant_id] = {**payload.model_dump(), "ts": time.time()}
    return {"ok": True}


def get_live_state(plant_id: str) -> dict | None:
    entry = _store.get(plant_id)
    if entry is None:
        return None
    if time.time() - entry["ts"] > STALE_AFTER_S:
        return None
    return entry
