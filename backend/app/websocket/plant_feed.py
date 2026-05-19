"""
WebSocket endpoint — /ws/plant/{plant_id}

Inference clients POST annotated JPEG frames to /api/frame/{plant_id}.
Dashboard clients connect to /ws/plant/{plant_id} and receive the latest
frame as a base64 thumbnail at roughly the same rate inference pushes them.

No Redis or DB required — frames are held in a process-level dict.
"""

import asyncio
import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

router = APIRouter()

# plant_id -> {"frame": <base64 str>, "ts": <epoch float>}
_store: dict[str, dict] = {}


class FramePayload(BaseModel):
    frame: str  # base64-encoded JPEG


@router.post("/api/frame/{plant_id}", status_code=200)
async def push_frame(plant_id: str, payload: FramePayload):
    """Inference client pushes an annotated JPEG frame for a plant."""
    _store[plant_id] = {"frame": payload.frame, "ts": time.time()}
    return {"ok": True}


@router.websocket("/ws/plant/{plant_id}")
async def ws_plant_feed(websocket: WebSocket, plant_id: str):
    """Dashboard client subscribes to the live frame stream for one plant."""
    await websocket.accept()
    last_ts = 0.0
    try:
        while True:
            entry = _store.get(plant_id)
            if entry and entry["ts"] > last_ts:
                last_ts = entry["ts"]
                await websocket.send_text(json.dumps({
                    "type":      "frame",
                    "plant_id":  plant_id,
                    "thumbnail": entry["frame"],
                }))
            await asyncio.sleep(0.05)
    except WebSocketDisconnect:
        pass
