"""
WebSocket endpoint — /ws/plants

Pushes WsFrameMessage for each unit with DB data every 3 seconds.
Format matches exactly what the dashboard's usePlantsData hook expects.
"""

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.db import queries

router = APIRouter()

PUSH_INTERVAL = 3


def _fetch_plants_batch() -> list:
    """Blocking pyodbc I/O — called via asyncio.to_thread so it never runs
    inline on the event loop. See ws_plants for why that matters."""
    states          = queries.get_plant_states()
    active_sessions = queries.get_active_sessions()
    for state in states:
        state["active_session"] = active_sessions.get(state.get("plant_id"))
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
