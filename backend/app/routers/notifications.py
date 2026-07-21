"""
Notifications API + live push.

  POST /api/notifications          inference client raises an alert
  GET  /api/notifications          dashboard lists recent alerts
  GET  /api/notifications/unread-count
  POST /api/notifications/read-all mark everything read
  WS   /ws/notifications           dashboard subscribes for toast + bell
"""
import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.notifications import notifications

router = APIRouter()


class AlertIn(BaseModel):
    type:     str
    severity: str = "info"
    source:   str = "system"
    message:  str


@router.post("/api/notifications", status_code=201)
def raise_alert(alert: AlertIn):
    """Inference client raises an alert. Returns the record, or throttled=True."""
    rec = notifications.add(alert.type, alert.severity, alert.source, alert.message)
    if rec is None:
        return {"throttled": True}
    return rec


@router.get("/api/notifications")
def list_alerts(limit: int = 200):
    return {"data": notifications.list_recent(limit), "unread": notifications.unread_count()}


@router.get("/api/notifications/unread-count")
def unread_count():
    return {"unread": notifications.unread_count()}


@router.post("/api/notifications/read-all")
def read_all():
    return {"marked": notifications.mark_all_read()}


@router.websocket("/ws/notifications")
async def ws_notifications(websocket: WebSocket):
    """Push new alerts as they arrive. The client tracks the last id it saw so a
    reconnect doesn't replay the whole history as toasts."""
    await websocket.accept()
    # Start from the current tip so a fresh connection doesn't toast old alerts.
    last_id = notifications.latest_id()
    try:
        while True:
            fresh = notifications.since(last_id)
            if fresh:
                last_id = fresh[-1]["id"]
                await websocket.send_text(json.dumps({
                    "type":  "notifications",
                    "items": fresh,
                    "unread": notifications.unread_count(),
                }))
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
