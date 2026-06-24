"""
ModeManager — shape-triggered operating mode state machine.

Shapes (detected by maintenance model.pt):
  Star     → WASHING        (pieces counted; auto-ends after 20 min belt idle)
  Plus     → COLOR_MATCHING (pieces counted; auto-ends on 10-piece burst in 35 s)
  Triangle → MAINTENANCE    (pieces counted; ends only via Arrow)
  Arrow    → end any active mode → plant returns to NORMAL session logic

Trigger gate: shape only fires when the plant has NO active production session
or the belt is currently idle.  Active production is never interrupted.

Each mode creates its own row in dbo.AppSessions with the matching session_type.
"""
from __future__ import annotations

import threading
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

from app.db.connection import get_connection

# ── Tuning (defaults — overridden from DB at startup via load_settings) ────────
SHAPE_CONF_THRESHOLD   = 0.75   # min YOLO confidence to count a shape hit
SHAPE_CONSECUTIVE_HITS = 2      # consecutive checks before mode fires
SHAPE_COOLDOWN_S       = 15     # seconds to ignore shapes after a mode change
SHAPE_CHECK_EVERY_N    = 15     # run shape model every N processed frames

WASHING_IDLE_TIMEOUT_S = 1200   # 20 min idle → auto-end WASHING
COLOR_BURST_COUNT      = 10     # pieces in burst window → auto-end COLOR_MATCHING
COLOR_BURST_WINDOW_S   = 35     # rolling burst window in seconds

# Shape name (as reported by YOLO model) → mode string (None = "end mode")
SHAPE_TO_MODE: dict[str, Optional[str]] = {
    "star":     "WASHING",
    "plus":     "COLOR_MATCHING",
    "triangle": "MAINTENANCE",
    "arrow":    None,            # Arrow ends MAINTENANCE only
}

# Dummy state used as a safe sentinel for mode checks outside the lock
class _DummyState:
    mode = "NORMAL"
_DUMMY = _DummyState()


@dataclass
class PlantModeState:
    mode:         str
    session_id:   int               # -1 while the DB INSERT is still in-flight
    start_time:   datetime
    piece_count:  int                        = 0
    last_piece_ts: Optional[datetime]        = None
    last_activity: Optional[datetime]        = None   # refreshed by any belt object
    burst_times:   deque = field(default_factory=deque)


class ModeManager:
    def __init__(self):
        self._lock    = threading.Lock()
        # plant → active mode state (None = NORMAL)
        self._states: dict[str, Optional[PlantModeState]] = {}

        # per-plant consecutive hit buffer: list of matching shape names
        self._hits:      dict[str, list[str]] = {}
        # per-plant cooldown expiry timestamps
        self._cooldowns: dict[str, datetime]  = {}
        # per-plant frame counter for shape-check throttling
        self._frame_cnt: dict[str, int]       = {}

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    def start(self) -> None:
        threading.Thread(
            target=self._timer_loop, name="mm-timer", daemon=True
        ).start()
        print("[ModeManager] started")

    def _timer_loop(self) -> None:
        import time
        while True:
            time.sleep(30)
            try:
                self._check_washing_idle()
            except Exception as exc:
                print(f"[ModeManager] Timer error: {exc}")

    # ── Called from plant worker (every frame) ─────────────────────────────────

    def tick_frame(self, plant: str) -> bool:
        """Increment per-plant frame counter. Returns True when a shape check is due."""
        n = self._frame_cnt.get(plant, 0) + 1
        self._frame_cnt[plant] = n
        return n % SHAPE_CHECK_EVERY_N == 0

    def on_belt_activity(self, plant: str, ts: datetime) -> None:
        """Call whenever any object is present in the ROI (keeps washing timer alive)."""
        with self._lock:
            s = self._states.get(plant)
            if s is not None:
                s.last_activity = ts

    def on_shape_result(
        self,
        plant:                  str,
        shape_name:             Optional[str],   # None = nothing detected this check
        confidence:             float,
        ts:                     datetime,
        belt_active:            bool,
        has_production_session: bool,
    ) -> None:
        """
        Called every SHAPE_CHECK_EVERY_N frames with the best YOLO shape detection.
        Manages the consecutive-hit buffer and fires mode transitions.
        """
        # ── Active-mode gate: once a mode is running, only Arrow (→ MAINTENANCE end) passes ──
        with self._lock:
            current_mode = (self._states.get(plant) or _DUMMY).mode
        if current_mode != "NORMAL":
            _is_arrow = shape_name is not None and shape_name.lower() == "arrow"
            if not (_is_arrow and current_mode == "MAINTENANCE"):
                self._hits.pop(plant, None)
                return

        # ── Cooldown guard ────────────────────────────────────────────────────
        cooldown_end = self._cooldowns.get(plant)
        if cooldown_end and ts < cooldown_end:
            return

        hits = self._hits.setdefault(plant, [])

        # ── No detection or below threshold ───────────────────────────────────
        if shape_name is None or confidence < SHAPE_CONF_THRESHOLD:
            hits.clear()
            return

        # ── Arrow only fires when plant is in MAINTENANCE ─────────────────────
        is_arrow = (shape_name.lower() == "arrow")

        if not is_arrow:
            # Non-arrow shapes only fire when plant is idle / has no active session
            can_trigger = (not has_production_session) or (not belt_active)
            if not can_trigger:
                hits.clear()
                return

        # ── Consecutive hit tracking ──────────────────────────────────────────
        if hits and hits[-1] != shape_name:
            hits.clear()       # different shape appeared — reset buffer
        hits.append(shape_name)
        print(f"[ModeManager][{plant}] hit {len(hits)}/{SHAPE_CONSECUTIVE_HITS} — {shape_name} conf={confidence:.2f}")

        if len(hits) >= SHAPE_CONSECUTIVE_HITS:
            hits.clear()
            self._cooldowns[plant] = ts + timedelta(seconds=SHAPE_COOLDOWN_S)
            self._fire_mode(plant, shape_name, ts)

    def on_piece_detected(self, plant: str, ts: datetime) -> bool:
        """
        Call for every piece_delta > 0 when the plant is in a non-NORMAL mode.
        Counts the piece in the mode session and checks the COLOR_MATCHING burst.
        Returns True if the mode ended (COLOR_MATCHING burst triggered).
        """
        snap_to_end: Optional[PlantModeState] = None

        with self._lock:
            state = self._states.get(plant)
            if state is None:
                return False

            state.piece_count  += 1
            state.last_piece_ts = ts
            state.last_activity = ts

            if state.mode == "COLOR_MATCHING":
                state.burst_times.append(ts)
                cutoff = ts - timedelta(seconds=COLOR_BURST_WINDOW_S)
                while state.burst_times and state.burst_times[0] < cutoff:
                    state.burst_times.popleft()
                if len(state.burst_times) >= COLOR_BURST_COUNT:
                    snap_to_end = state
                    del self._states[plant]

        if snap_to_end is not None:
            self._end_session_db(snap_to_end, datetime.now())
            print(f"[ModeManager] {plant} COLOR_MATCHING ended — piece burst reached")
            return True

        # Heartbeat: push updated piece count to DB
        threading.Thread(
            target=self._heartbeat_db, args=(plant,), daemon=True
        ).start()
        return False

    def get_mode(self, plant: str) -> str:
        with self._lock:
            s = self._states.get(plant)
            return s.mode if s is not None else "NORMAL"

    def has_active_mode(self, plant: str) -> bool:
        return self.get_mode(plant) != "NORMAL"

    def get_state(self, plant: str) -> Optional[PlantModeState]:
        with self._lock:
            return self._states.get(plant)

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _fire_mode(self, plant: str, shape_name: str, ts: datetime) -> None:
        target_mode = SHAPE_TO_MODE.get(shape_name.lower())   # None for Arrow

        with self._lock:
            current = self._states.get(plant)

            if target_mode is None:
                # Arrow — only ends MAINTENANCE (guard already checked in on_shape_result)
                if current is None or current.mode != "MAINTENANCE":
                    return
                snap_end = current
                del self._states[plant]
                new_state = None
            else:
                # Don't re-enter the same mode
                if current is not None and current.mode == target_mode:
                    return
                snap_end = current   # may be None (NORMAL → mode)
                new_state = PlantModeState(
                    mode          = target_mode,
                    session_id    = -1,
                    start_time    = ts,
                    last_activity = ts,
                )
                self._states[plant] = new_state

        # End previous session outside lock
        if snap_end is not None:
            self._end_session_db(snap_end, ts)

        if new_state is not None:
            print(f"[ModeManager] {plant} → {target_mode} (shape: {shape_name})")
            threading.Thread(
                target=self._create_session_db,
                args=(plant, target_mode, ts),
                daemon=True,
            ).start()
        else:
            print(f"[ModeManager] {plant} → NORMAL (Arrow detected)")

    def _check_washing_idle(self) -> None:
        now     = datetime.now()
        to_end  = []
        with self._lock:
            for plant, state in list(self._states.items()):
                if state is None or state.mode != "WASHING":
                    continue
                ref = state.last_activity or state.start_time
                if (now - ref).total_seconds() > WASHING_IDLE_TIMEOUT_S:
                    to_end.append((plant, state))
                    del self._states[plant]

        for plant, state in to_end:
            self._end_session_db(state, datetime.now())
            print(f"[ModeManager] {plant} WASHING ended — belt idle > 20 min")

    # ── DB helpers (called from daemon threads) ────────────────────────────────

    def _create_session_db(self, plant: str, mode: str, start_time: datetime) -> None:
        try:
            with get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO dbo.AppSessions
                        (Plant, StartTime, Status, ProcessedPieces, session_type)
                    OUTPUT INSERTED.SessionId
                    VALUES (?, ?, 'INPROCESS', 0, ?)
                    """,
                    (plant, start_time, mode),
                )
                row = cur.fetchone()
                conn.commit()
            if row:
                sid = int(row[0])
                with self._lock:
                    s = self._states.get(plant)
                    if s is not None and s.session_id == -1:
                        s.session_id = sid
                print(f"[ModeManager] Session {sid} created ({mode}, plant={plant})")
        except Exception as exc:
            print(f"[ModeManager] Failed to create {mode} session for {plant}: {exc}")
            with self._lock:
                s = self._states.get(plant)
                if s is not None and s.session_id == -1:
                    self._states.pop(plant, None)

    def _end_session_db(self, state: PlantModeState, end_time: datetime) -> None:
        if state.session_id == -1:
            return
        try:
            with get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    UPDATE dbo.AppSessions
                    SET EndTime = ?, ProcessedPieces = ?, Status = 'COMPLETED'
                    WHERE SessionId = ? AND Status = 'INPROCESS'
                    """,
                    (end_time, state.piece_count, state.session_id),
                )
                conn.commit()
            print(
                f"[ModeManager] Session {state.session_id} completed "
                f"({state.mode}, pieces={state.piece_count})"
            )
        except Exception as exc:
            print(f"[ModeManager] Failed to end session {state.session_id}: {exc}")

    def _heartbeat_db(self, plant: str) -> None:
        with self._lock:
            s = self._states.get(plant)
            if s is None or s.session_id == -1:
                return
            sid, cnt = s.session_id, s.piece_count
        try:
            with get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    "UPDATE dbo.AppSessions SET ProcessedPieces = ? "
                    "WHERE SessionId = ? AND Status = 'INPROCESS'",
                    (cnt, sid),
                )
                conn.commit()
        except Exception:
            pass

    def end_all_active_modes(self) -> None:
        """Graceful shutdown — close any open mode sessions with accurate EndTime."""
        with self._lock:
            states = [(p, s) for p, s in self._states.items() if s is not None]
            self._states.clear()
        for plant, state in states:
            self._end_session_db(state, datetime.now())
        if states:
            print(f"[ModeManager] Gracefully closed {len(states)} mode session(s)")


# ── Module-level singleton ─────────────────────────────────────────────────────
mode_manager = ModeManager()
