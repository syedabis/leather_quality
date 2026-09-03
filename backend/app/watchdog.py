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
    asyncio.create_task(_daily_email_scheduler())
    print("[watchdog] plant-offline watchdog + notification pruner + email scheduler started")


async def _daily_email_scheduler() -> None:
    """
    Background scheduler that checks shift end time daily and dispatches
    the daily summary report emails. Polls if a lot is active at shift end.
    """
    from datetime import datetime, date as _date
    from app.db.connection import get_connection
    from app.db.queries import _get_off_day_dates
    from app.routers.reports import send_daily_summary

    last_sent_date = ""
    poll_interval_s = 60  # Check every minute for time matching

    while True:
        try:
            now = datetime.now()
            today_str = str(_date.today())

            if today_str != last_sent_date:
                # 1. Fetch shift end time from settings
                shift_end = "17:00"
                try:
                    with get_connection() as conn:
                        cur = conn.cursor()
                        cur.execute("SELECT setting_value FROM dbo.SystemSettings WHERE setting_key = 'shift_end'")
                        row = cur.fetchone()
                        if row and row[0]:
                            shift_end = row[0]
                except Exception as db_err:
                    print(f"[watchdog-email] Failed to read shift_end settings: {db_err}")

                eh, em = map(int, shift_end.split(":"))
                shift_end_dt = now.replace(hour=eh, minute=em, second=0, microsecond=0)

                # 2. Check if we have hit or passed the shift end time
                if now >= shift_end_dt:
                    # 3. Check if today is a holiday or weekly off-day
                    try:
                        off_dates = _get_off_day_dates(today_str, today_str)
                    except Exception as db_err:
                        print(f"[watchdog-email] Failed to read off_days: {db_err}")
                        off_dates = set()

                    if today_str in off_dates:
                        print(f"[watchdog-email] Today ({today_str}) is a holiday/off-day. Skipping report emails.")
                        last_sent_date = today_str
                        continue

                    # 4. Check if any production session is currently running
                    running_lots = 0
                    try:
                        with get_connection() as conn:
                            cur = conn.cursor()
                            cur.execute(
                                "SELECT COUNT(*) FROM dbo.AppSessions "
                                "WHERE Status = 'INPROCESS' AND (session_type IS NULL OR session_type = 'PRODUCTION')"
                            )
                            row = cur.fetchone()
                            if row:
                                running_lots = row[0] or 0
                    except Exception as db_err:
                        print(f"[watchdog-email] Failed to read active sessions: {db_err}")

                    # 5. Handle active production lots delay
                    # Cutoff is 10 PM (22:00) to ensure we send it before day ends
                    if running_lots > 0 and now.hour < 22:
                        print(f"[watchdog-email] Active production lot is still running. Delaying email report by 15 mins.")
                        await asyncio.sleep(15 * 60)  # Wait 15 minutes before checking again
                        continue

                    # 6. Send the daily reports!
                    print(f"[watchdog-email] Starting daily production summary email dispatch for {today_str}...")
                    try:
                        result = send_daily_summary(date_param=today_str)
                        print(f"[watchdog-email] Daily report sent. Result: {result}")
                        last_sent_date = today_str
                    except Exception as email_err:
                        print(f"[watchdog-email] Failed to send report: {email_err}")
                        # Sleep 5 minutes and retry if it failed (don't set last_sent_date)
                        await asyncio.sleep(5 * 60)
                        continue

        except Exception as exc:
            print(f"[watchdog-email] Global scheduler error: {exc}")

        await asyncio.sleep(poll_interval_s)

