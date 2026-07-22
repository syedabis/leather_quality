"""
WebSocket endpoint — /ws/plants

Pushes WsFrameMessage for each unit with DB data every 3 seconds.
Format matches exactly what the dashboard's usePlantsData hook expects.
"""

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.db import queries
from app.live_state import get_live_state

router = APIRouter()

PUSH_INTERVAL = 3


def _fetch_plants_batch() -> list:
    """Blocking pyodbc I/O — called via asyncio.to_thread so it never runs
    inline on the event loop. See ws_plants for why that matters."""
    states          = queries.get_plant_states()
    active_sessions = queries.get_active_sessions()
    for state in states:
        state["active_session"] = active_sessions.get(state.get("plant_id"))

        # DB-sourced data says this plant is offline/stale -- inference-client
        # only pushes to live_state while ITS OWN DB connection is down, so a
        # fresh entry here means a real outage, not a genuinely offline plant.
        # Real DB data always wins when it's actually online; this only fills
        # the gap an outage leaves instead of showing "no data".
        if not state.get("online"):
            live = get_live_state(state["plant_id"])
            if live is not None:
                state["online"]      = True
                state["belt_active"] = live["belt_active"]
                state["total_count"] = live["total_count"]
                if live["has_session"]:
                    state["active_session"] = {
                        "session_id":      None,
                        "lot_no":          live["lot_no"],
                        "plant":           state["plant_id"],
                        "start_time":      live["start_time"],
                        "expected_pieces": live["expected_pieces"],
                        "current_pieces":  live["current_pieces"],
                        "type":            live["type"],
                        "session_type":    live["session_type"],
                        "order_no":        live["order_no"],
                        "article_name":    live["article_name"],
                        "colour_name":     live["colour_name"],
                        "party_name":      live["party_name"],
                        "pk_code":         None,
                    }
    return states


@router.websocket("/ws/plants")
async def ws_plants(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            try:
                # async def handlers aren't auto-threaded by FastAPI the way
                # sync routes are — a blocking DB call here stalls the single
                # event loop for every other request/websocket on the server,
                # not just this one, for as long as the DB call takes.
                states = await asyncio.to_thread(_fetch_plants_batch)
                # Send all plants in ONE message so the frontend processes
                # them atomically — sending N separate messages causes React
                # to batch the setState calls and drop all but the last one.
                await websocket.send_text(json.dumps({
                    "type":   "plants_batch",
                    "plants": states,
                }))
            except Exception as exc:
                await websocket.send_text(json.dumps({"error": str(exc)}))

            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=PUSH_INTERVAL)
            except asyncio.TimeoutError:
                pass
            except WebSocketDisconnect:
                break
    except WebSocketDisconnect:
        pass
