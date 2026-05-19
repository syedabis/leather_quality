"""
Example: How to integrate frame processing into your inference handler.

This shows the minimal code needed to update CurrentHourMetrics in real-time
as frames arrive from the inference engine.
"""

from app.db.frame_processor import FrameProcessor


def handle_frame(frame_data: dict):
    """
    Called whenever a new frame arrives from the inference engine.

    Frame data structure:
    {
        "source_note": "SP3",          # Plant ID
        "total_count": 1250,           # Cumulative pieces
        "belt_active": True,           # Belt running?
        "utilization_pct": 85.5,       # Utilization %
        "piece_delta": 1,              # Pieces added this frame (optional)
        ...other fields...
    }
    """

    # Extract fields
    source_note = frame_data.get("source_note", "SP3")
    total_count = frame_data.get("total_count", 0)
    belt_active = bool(frame_data.get("belt_active", False))
    utilization_pct = frame_data.get("utilization_pct", 0.0)
    piece_delta = frame_data.get("piece_delta", 0)

    # Update CurrentHourMetrics (1ms, fast)
    success = FrameProcessor.process_frame(
        source_note=source_note,
        total_count=total_count,
        belt_active=belt_active,
        utilization_pct=utilization_pct,
        piece_delta=piece_delta,
    )

    if not success:
        print(f"⚠️  Failed to process frame for {source_note}")

    # Your existing frame handling code continues here
    # ...
    # Store to LeatherCountLog
    # Broadcast to WebSocket
    # etc.


# ────────────────────────────────────────────────────────────────────────────
# Example: How to integrate into your existing WebSocket broadcast handler
# ────────────────────────────────────────────────────────────────────────────

async def broadcast_frame_to_dashboard(frame_data: dict):
    """
    Existing function in your WebSocket handler.
    Add the frame processing call here.
    """

    # NEW: Update analytics cache (1ms)
    handle_frame(frame_data)

    # EXISTING: Broadcast to all connected clients
    # manager.broadcast({
    #     "type": "frame",
    #     "plant_id": frame_data["source_note"],
    #     "total_count": frame_data["total_count"],
    #     "belt_active": frame_data["belt_active"],
    #     "utilization_pct": frame_data["utilization_pct"],
    #     ...
    # })


# ────────────────────────────────────────────────────────────────────────────
# Example: Hourly finalization job
# ────────────────────────────────────────────────────────────────────────────

import asyncio
from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler


def finalize_completed_hours():
    """
    Batch job: Finalize all completed hours into HourlyMetrics.
    Schedule this to run at :05 every hour (e.g., 09:05, 10:05, ...).
    """

    # Get the hour that just completed
    now = datetime.now()
    hour_start = (now - timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)

    # Plant IDs to finalize
    plants = ["SP3", "SP4", "SP5", "SP6", "SP7", "SP8"]

    for plant in plants:
        success = FrameProcessor.finalize_hour(plant, hour_start)
        if success:
            print(f"✅ Finalized {plant} hour {hour_start}")
        else:
            print(f"⚠️  Failed to finalize {plant} hour {hour_start}")


def setup_hourly_scheduler():
    """
    Set up APScheduler to finalize hours at :05 every hour.
    Call this once when your backend starts.
    """

    scheduler = BackgroundScheduler()

    # Run at :05 every hour
    scheduler.add_job(
        finalize_completed_hours,
        "cron",
        minute=5,
        second=0,
        id="finalize_hours"
    )

    scheduler.start()
    print("✅ Hourly finalization scheduler started")

    return scheduler


# ────────────────────────────────────────────────────────────────────────────
# Minimal example: Just the essentials
# ────────────────────────────────────────────────────────────────────────────

# In your main backend startup code:
# from app.db.frame_processor import FrameProcessor
#
# @app.on_event("startup")
# async def setup():
#     # Initialize schema
#     from app.db.schema import initialize_schema
#     initialize_schema()
#
#     # Start hourly finalization job
#     setup_hourly_scheduler()
#
#
# In your frame handler:
# @app.websocket("/ws/frames")
# async def websocket_endpoint(websocket):
#     await websocket.accept()
#
#     while True:
#         frame = await websocket.receive_json()
#
#         # Update analytics
#         FrameProcessor.process_frame(
#             source_note=frame["source_note"],
#             total_count=frame["total_count"],
#             belt_active=frame["belt_active"],
#             utilization_pct=frame["utilization_pct"],
#             piece_delta=frame.get("piece_delta", 0),
#         )
#
#         # Broadcast to dashboard
#         await manager.broadcast(frame)
