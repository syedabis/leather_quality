"""
gap_monitor.py -- live diagnostic for the CurrentHourMetrics-vs-AppSessions gap.

Every POLL_INTERVAL_S seconds, samples two things per plant:
  - CurrentHourMetrics.piece_count for the current hour (raw camera truth --
    every detected piece, DB up or down, session or no session)
  - the ProcessedPieces of whatever session is currently INPROCESS for that
    plant, if any

...then compares the GROWTH of each between samples. If the camera count is
growing faster than the active session's piece count, real pieces are being
lost or lagging behind in real time -- this catches that automatically,
without anyone needing to watch the camera feed and count by hand.

Run this from the inference-client folder (same one as run_all_plants.py)
while inference is running normally:

    python gap_monitor.py

Ctrl+C to stop. Safe to run alongside the main process -- read-only, opens
its own short-lived DB connections, never touches inference-client's state.
"""
from __future__ import annotations

import time
from datetime import datetime
from pathlib import Path

from app.db.connection import get_connection

POLL_INTERVAL_S = 30
LAG_FLAG_THRESHOLD = 3   # gap bigger than this (pieces) gets flagged in the output
PLANTS = ["SP-01", "SP-02", "SP-03", "SP-04", "SP-05", "SP-06"]

LOG_PATH = Path(__file__).resolve().parent / "logs" / f"gap_monitor_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"


def _log(line: str, f) -> None:
    print(line)
    f.write(line + "\n")
    f.flush()


def fetch_snapshot() -> dict:
    """Returns {plant: {"chm": int, "session_id": int|None, "session_pieces": int}}"""
    chm: dict[str, int] = {}
    active: dict[str, tuple[int, int]] = {}

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT source_note, SUM(ISNULL(piece_count, 0))
            FROM dbo.CurrentHourMetrics
            WHERE hour_start = DATEADD(hour, DATEDIFF(hour, 0, GETDATE()), 0)
            GROUP BY source_note
            """
        )
        for plant, total in cur.fetchall():
            chm[plant] = int(total or 0)

        cur.execute(
            """
            SELECT Plant, SessionId, ProcessedPieces
            FROM dbo.AppSessions
            WHERE Status = 'INPROCESS'
            """
        )
        for plant, sid, pcs in cur.fetchall():
            active[plant] = (int(sid), int(pcs or 0))

    snapshot = {}
    for plant in PLANTS:
        sid, pcs = active.get(plant, (None, None))
        snapshot[plant] = {"chm": chm.get(plant, 0), "session_id": sid, "session_pieces": pcs}
    return snapshot


def main() -> None:
    LOG_PATH.parent.mkdir(exist_ok=True)
    with open(LOG_PATH, "w", encoding="utf-8") as f:
        _log(f"[gap_monitor] started -- polling every {POLL_INTERVAL_S}s, writing to {LOG_PATH}", f)
        _log("[gap_monitor] Ctrl+C to stop\n", f)

        prev = fetch_snapshot()
        prev_time = time.time()

        while True:
            time.sleep(POLL_INTERVAL_S)
            now_snap = fetch_snapshot()
            now_time = time.time()
            elapsed = now_time - prev_time

            _log(f"--- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} (over {elapsed:.0f}s) ---", f)
            for plant in PLANTS:
                p, n = prev[plant], now_snap[plant]
                chm_delta = n["chm"] - p["chm"]

                if n["session_id"] is None:
                    _log(f"  {plant}: no active session right now (camera +{chm_delta})", f)
                    continue

                if p["session_id"] != n["session_id"]:
                    _log(
                        f"  {plant}: session changed ({p['session_id']} -> {n['session_id']}) "
                        f"mid-window, camera +{chm_delta} -- skipping delta comparison this round",
                        f,
                    )
                    continue

                session_delta = n["session_pieces"] - p["session_pieces"]
                gap = chm_delta - session_delta
                flag = "  <-- LAGGING" if gap > LAG_FLAG_THRESHOLD else ""
                _log(
                    f"  {plant}: camera +{chm_delta:4d}   session +{session_delta:4d}   "
                    f"gap {gap:+4d}{flag}",
                    f,
                )

            _log("", f)
            prev = now_snap
            prev_time = now_time


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[gap_monitor] stopped.")
