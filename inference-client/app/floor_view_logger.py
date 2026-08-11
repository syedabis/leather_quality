"""
Floor-view logger — local, per-run audit trail of pieces that were detected
(and already counted into CurrentHourMetrics) but never made it into any
AppSessions row. These are exactly the pieces that make Daily Summary
(metrics-based) and Daily Detail (session-based) disagree — this log lets
that gap be traced back to real per-piece events instead of guessed at from
aggregates.

Only pieces that truly never became part of a session are written here. A
piece that ends up contributing to a triggered unaccounted session (the
first 10-in-a-row that create it) is NOT logged here — it's already
accounted for in that session.
"""
from __future__ import annotations

import threading
from datetime import datetime
from pathlib import Path


class FloorViewLogger:
    def __init__(self):
        self._lock = threading.Lock()
        self._file = None

    def start(self) -> None:
        log_dir = Path(__file__).resolve().parent.parent / "floor_view"
        log_dir.mkdir(exist_ok=True)
        path = log_dir / f"floor_view_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
        with self._lock:
            self._file = open(path, "a", encoding="utf-8", buffering=1)
        print(f"[floor_view] logging unattributed pieces to {path}")

    def stop(self) -> None:
        with self._lock:
            if self._file is not None:
                self._file.close()
                self._file = None

    def log_dropped(self, plant: str, piece_time: datetime, pending_count: int, reason: str) -> None:
        """A piece arrived with no active session and never became part of one
        (still counted in CurrentHourMetrics, just invisible to AppSessions)."""
        line = f"{piece_time.isoformat()}  [{plant}]  DROPPED ({reason}, {pending_count} still pending)\n"
        with self._lock:
            if self._file is not None:
                self._file.write(line)


floor_view_logger = FloorViewLogger()
