"""
watchdog.py — backend-side detectors that raise notifications.

Two background tasks, started from the FastAPI startup event:

  * plant watchdog — the inference client POSTs a frame per plant every ~0.5-1 s
    to /api/frame/{plant}. If a plant's frames stop for OFFLINE_THRESHOLD_S, its
    camera / NVR / inference is down. This backend-side check is the only way to
    notice an inference *crash* — a dead process can't report itself. A plant is
    only watched once it has streamed at least one frame, so a plant that is
    simply switched off never raises a false alarm.

  * pruner — drops notifications older than the retention window, hourly.
"""
import asyncio

from app.notifications import notifications
from app.websocket.plant_feed import _store as _frame_store
from app.db.queries import UNITS

OFFLINE_THRESHOLD_S = 30     # no frame for this long → plant offline
CHECK_INTERVAL_S    = 10
PRUNE_INTERVAL_S    = 3600


async def _plant_watchdog() -> None:
    import time
    # None = never seen a frame yet (don't alert); True/False = last known state.
    state: dict[str, bool | None] = {u: None for u in UNITS}
    while True:
        try:
            now = time.time()
            for plant in UNITS:
                entry = _frame_store.get(plant)
                if entry is None:
                    continue   # never streamed — nothing to compare against
                online = (now - entry["ts"]) <= OFFLINE_THRESHOLD_S
                prev = state[plant]
                if prev is None:
                    state[plant] = online   # first observation, just record it
                    continue
                if prev and not online:
                    notifications.add(
                        "plant_offline", "warning", plant,
                        f"{plant} is offline — no camera feed for over "
                        f"{OFFLINE_THRESHOLD_S}s (camera, NVR, or inference down).",
                    )
                elif not prev and online:
                    notifications.add(
                        "plant_recovered", "info", plant,
                        f"{plant} is back online — camera feed resumed.",
                    )
                state[plant] = online
        except Exception as exc:
            print(f"[watchdog] error: {exc}")
        await asyncio.sleep(CHECK_INTERVAL_S)


async def _pruner() -> None:
    while True:
        await asyncio.sleep(PRUNE_INTERVAL_S)
        try:
            n = notifications.prune()
            if n:
                print(f"[notifications] pruned {n} alert(s) older than retention window")
        except Exception as exc:
            print(f"[watchdog] prune error: {exc}")


def start_watchdogs() -> None:
    """Schedule the background tasks on the running event loop."""
    asyncio.create_task(_plant_watchdog())
    asyncio.create_task(_pruner())
    print("[watchdog] plant-offline watchdog + notification pruner started")
