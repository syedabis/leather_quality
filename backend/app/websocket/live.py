"""
WebSocket endpoint — /ws/counts

Pushes latest counts for all units to every connected client every 3 seconds.
Clients receive a JSON array identical to GET /api/counts.

No Redis required for Phase 3 — the WS handler polls the DB directly.
Redis pub/sub can be layered on top later so plant-workers push updates
instead of the WS handler pulling on a timer.
"""

import asyncio
import json
from typing import Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.db import queries

router = APIRouter()

PUSH_INTERVAL = 3  # seconds between DB polls


class _ConnectionManager:
    def __init__(self):
        self._active: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._active.add(ws)

    def disconnect(self, ws: WebSocket):
        self._active.discard(ws)

    async def broadcast(self, payload: str):
        dead = set()
        for ws in self._active:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        self._active -= dead


manager = _ConnectionManager()


@router.websocket("/ws/counts")
async def ws_counts(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            try:
                # get_latest_counts() does blocking pyodbc I/O — running it
                # inline here (this is an async def handler, so FastAPI does
                # NOT thread it automatically the way it does for sync routes)
                # would stall the single event loop for every other request
                # and websocket on the server, not just this one, for as long
                # as the DB call takes. asyncio.to_thread keeps the blocking
                # work off the loop.
                data = await asyncio.to_thread(queries.get_latest_counts)
                payload = json.dumps(data)
                await websocket.send_text(payload)
            except Exception as exc:
                await websocket.send_text(json.dumps({"error": str(exc)}))

            # Wait for next push interval, but also check if client disconnected
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=PUSH_INTERVAL)
            except asyncio.TimeoutError:
                pass  # normal — just means no message from client, continue loop
            except WebSocketDisconnect:
                break
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)
