"""
ModeManager — shape-triggered operating mode state machine.

Shapes (detected by maintenance model.pt):
  Star     → WASHING        (pieces counted; auto-ends after 20 min belt idle)
  Plus     → COLOR_MATCHING (pieces counted; auto-ends on 10-piece burst in 35 s)
  Triangle → MAINTENANCE    (pieces counted; ends via Arrow, or immediately if
                              a new production session starts — see force_end_mode)
  Arrow    → end any active mode → plant returns to NORMAL session logic

Trigger gate: shape only fires when the plant has NO active production session
or the belt is currently idle.  Active production is never interrupted.

Each mode creates its own row in dbo.AppSessions with the matching session_type.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

from app.db.connection import get_connection
from app.db.outbox import outbox

# ── Tuning (defaults — overridden from DB at startup via load_settings) ────────
SHAPE_CONF_THRESHOLD   = 0.89   # min YOLO confidence to count a shape hit
SHAPE_CONSECUTIVE_HITS = 5      # consecutive checks before mode fires (5 × 3 s = ~15 s)
SHAPE_COOLDOWN_S       = 15     # seconds to ignore shapes after a mode change

# Shape checks are paced by WALL CLOCK, not by frame count.
#
# This used to be SHAPE_CHECK_EVERY_N = 15 processed frames, tuned for 5 FPS
# (~3 s/check). But run_all_plants runs at TARGET_FPS = 2, and halves to 1 FPS
# once the belt goes idle — which is exactly the state a shape card is shown in,
# since the trigger requires an empty ROI. So a check landed every 7.5 s when the
# belt was busy and every 15 s when it was idle, and 5 consecutive hits took
# 37–75 seconds instead of the intended 15. Timing off the clock keeps the
# interval honest no matter what the frame rate is doing.
SHAPE_CHECK_INTERVAL_S = 3.0    # seconds between shape-model checks, per plant

WASHING_IDLE_TIMEOUT_S = 1200   # 20 min idle → auto-end WASHING
COLOR_BURST_COUNT      = 10     # pieces in burst window → auto-end COLOR_MATCHING
COLOR_BURST_WINDOW_S   = 50     # rolling burst window in seconds

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
        # per-plant time.time() of the last shape check (paces SHAPE_CHECK_INTERVAL_S)
        self._last_check: dict[str, float]    = {}

        # Recording trigger: set at first hit, expires after 30 s
        self._rec_start: dict[str, float] = {}   # plant → time.time() of first hit
        self._rec_shape: dict[str, str]   = {}   # plant → shape name for filename

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    def _reconcile_session_id(self, temp_id: int, real_id: int) -> None:
        """Outbox callback: an offline-created mode session was just inserted for
        real — swap its temp id for the real SessionId if it's still live."""
        with self._lock:
            for state in self._states.values():
                if state is not None and state.session_id == temp_id:
                    state.session_id = real_id
                    print(f"[ModeManager] reconciled temp {temp_id} -> session {real_id}")

    def start(self) -> None:
        outbox.register_session_reconciler(self._reconcile_session_id)
        threading.Thread(
            target=self._timer_loop, name="mm-timer", daemon=True
        ).start()
        print("[ModeManager] started")

    def _timer_loop(self) -> None:
        while True:
            time.sleep(30)
            try:
                self._check_washing_idle()
            except Exception as exc:
                print(f"[ModeManager] Timer error: {exc}")

    # ── Called from plant worker (every frame) ─────────────────────────────────

    def tick_frame(self, plant: str) -> bool:
        """Returns True when a shape check is due for this plant.

        Paced off the wall clock, so the interval holds at SHAPE_CHECK_INTERVAL_S
        regardless of the processed frame rate or the idle-belt frame-rate throttle.
        Call once per processed frame.
        """
        now  = time.time()
        last = self._last_check.get(plant)
        if last is None or (now - last) >= SHAPE_CHECK_INTERVAL_S:
            self._last_check[plant] = now
            return True
        return False

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
        pieces_in_roi:          bool = False,    # True when non-shape objects are in ROI right now
    ) -> None:
        """
        Called every SHAPE_CHECK_INTERVAL_S seconds with the best YOLO shape detection.
        Manages the consecutive-hit buffer and fires mode transitions.
        """
        # ── Active-mode gate ─────────────────────────────────────────────────────
        # NORMAL         → all shapes pass
        # MAINTENANCE    → only Arrow passes (ends maintenance)
        # WASHING        → Plus (→COLOR_MATCHING), Star (→WASHING), Triangle (→MAINTENANCE)
        # COLOR_MATCHING → Star (→WASHING), Triangle (→MAINTENANCE)
        with self._lock:
            current_mode = (self._states.get(plant) or _DUMMY).mode
        if current_mode != "NORMAL":
            _is_arrow    = shape_name is not None and shape_name.lower() == "arrow"
            _is_plus     = shape_name is not None and shape_name.lower() == "plus"
            _is_star     = shape_name is not None and shape_name.lower() == "star"
            _is_triangle = shape_name is not None and shape_name.lower() == "triangle"
            _arrow_ends_maint    = _is_arrow    and current_mode == "MAINTENANCE"
            _plus_ends_wash      = _is_plus     and current_mode == "WASHING"
            _star_from_color     = _is_star     and current_mode == "COLOR_MATCHING"
            _triangle_from_color = _is_triangle and current_mode == "COLOR_MATCHING"
            _star_from_wash      = _is_star     and current_mode == "WASHING"
            _triangle_from_wash  = _is_triangle and current_mode == "WASHING"
            if not (_arrow_ends_maint or _plus_ends_wash
                    or _star_from_color or _triangle_from_color
                    or _star_from_wash  or _triangle_from_wash):
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

        # ── Unknown shape class — ignore (e.g. leather, background) ────────────
        if shape_name.lower() not in SHAPE_TO_MODE:
            hits.clear()
            return

        # ── Shape must be alone in the ROI ────────────────────────────────────
        # Reject the hit if other objects (leather pieces) are also present.
        # roi_ids already has the shape card suppressed, so this only fires
        # when genuine pieces are alongside the shape card.
        if pieces_in_roi:
            hits.clear()
            return

        # ── Consecutive hit tracking ──────────────────────────────────────────
        if hits and hits[-1] != shape_name:
            hits.clear()       # different shape appeared — reset buffer
        hits.append(shape_name)

        # First hit in a new sequence → open a 30-second recording window
        if len(hits) == 1 and not self.is_recording(plant):
            self._rec_start[plant] = time.time()
            self._rec_shape[plant] = shape_name
            print(f"[ModeManager][{plant}] recording window opened ({shape_name})")

        print(f"[ModeManager][{plant}] hit {len(hits)}/{SHAPE_CONSECUTIVE_HITS} — {shape_name} conf={confidence:.2f}")

        if len(hits) >= SHAPE_CONSECUTIVE_HITS:
            hits.clear()
            self._cooldowns[plant] = ts + timedelta(seconds=SHAPE_COOLDOWN_S)
            self._fire_mode(plant, shape_name, ts)

    def on_piece_detected(self, plant: str, ts: datetime) -> bool:
        """
        Call for every piece_delta > 0 when the plant is in a non-NORMAL mode.
        Counts the piece in the mode session and checks the piece-burst end condition
        for WASHING and COLOR_MATCHING (10 pieces in 50 s).
        Returns True if the mode ended via burst trigger.

        Burst semantics: the 10 burst pieces belong to the NEW unaccounted session,
        not to the ending mode session.  ColorMatching/Washing EndTime and
        ProcessedPieces are both anchored to the moment the burst started
        (burst_times[0]), so the burst pieces are cleanly handed off.
        """
        snap_to_end:    Optional[PlantModeState] = None
        snap_burst_start: Optional[datetime]     = None

        with self._lock:
            state = self._states.get(plant)
            if state is None:
                return False

            state.piece_count  += 1
            state.last_piece_ts = ts
            state.last_activity = ts

            if state.mode in ("COLOR_MATCHING", "WASHING"):
                state.burst_times.append(ts)
                cutoff = ts - timedelta(seconds=COLOR_BURST_WINDOW_S)
                while state.burst_times and state.burst_times[0] < cutoff:
                    state.burst_times.popleft()
                if len(state.burst_times) >= COLOR_BURST_COUNT:
                    # Burst pieces belong to the new unaccounted session.
                    # Roll back piece_count so the mode session only gets
                    # pieces that arrived before the burst window.
                    snap_burst_start   = state.burst_times[0]
                    state.piece_count -= COLOR_BURST_COUNT
                    snap_to_end        = state
                    del self._states[plant]

        if snap_to_end is not None:
            burst_start = snap_burst_start or datetime.now()
            self._end_session_db(snap_to_end, burst_start)
            print(f"[ModeManager] {plant} {snap_to_end.mode} ended — piece burst reached")
            from app.db.session_manager import session_manager
            session_manager.start_burst_unaccounted(plant, burst_start, COLOR_BURST_COUNT)
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

    def is_recording(self, plant: str) -> bool:
        """True while within the 30-second recording window from the first shape hit."""
        start = self._rec_start.get(plant)
        return start is not None and (time.time() - start) < 30.0

    def recording_info(self, plant: str) -> Optional[tuple]:
        """Returns (start_timestamp, shape_name) if recording is active, else None."""
        start = self._rec_start.get(plant)
        if start is None or (time.time() - start) >= 30.0:
            return None
        return (start, self._rec_shape.get(plant, "unknown"))

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

        # End any running production session (accounted or unaccounted) before mode starts
        from app.db.session_manager import session_manager
        session_manager.end_active_session_for_plant(plant)

        # End previous mode session outside lock
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

    def _buffer_mode_create(self, plant: str, mode: str, start_time: datetime) -> None:
        """Buffer a mode-session INSERT and give the live state a temp id, so the
        mode survives an outage. The outbox reconciler swaps in the real
        SessionId once the DB is back."""
        temp_id = outbox.alloc_temp_id()
        outbox.enqueue_session_create(temp_id, plant, start_time, mode, 0)
        with self._lock:
            s = self._states.get(plant)
            if s is not None and s.session_id == -1:
                s.session_id = temp_id
        print(f"[ModeManager] {mode} session buffered (temp {temp_id}) for {plant} - DB offline")

    def _create_session_db(self, plant: str, mode: str, start_time: datetime) -> None:
        if not outbox.is_online():
            self._buffer_mode_create(plant, mode, start_time)
            return
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
            print(f"[ModeManager] Create failed, buffering {mode} for {plant}: {exc}")
            outbox.mark_write_failed()
            self._buffer_mode_create(plant, mode, start_time)

    def _end_session_db(self, state: PlantModeState, end_time: datetime) -> None:
        """Non-blocking: always runs on its own thread. _fire_mode and
        on_piece_detected call this inline from the hot per-plant capture/
        inference thread, which must never block on a DB write — a caller
        that genuinely needs it to block (e.g. graceful shutdown) should call
        _do_end_session_db directly instead."""
        threading.Thread(
            target=self._do_end_session_db, args=(state, end_time), daemon=True
        ).start()

    def _do_end_session_db(self, state: PlantModeState, end_time: datetime) -> None:
        if state.session_id == -1:
            return  # never persisted (insert still in flight) — nothing to end

        # Offline → buffer the end. session_id may be a temp id (mode started
        # during the outage) or a real id (mode ends mid-outage).
        if not outbox.is_online():
            outbox.enqueue_session_end(state.session_id, end_time, state.piece_count)
            print(f"[ModeManager] Session end buffered (id {state.session_id}, "
                  f"{state.mode}, pieces={state.piece_count}) - DB offline")
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
            print(f"[ModeManager] End write failed, buffering session {state.session_id}: {exc}")
            outbox.mark_write_failed()
            outbox.enqueue_session_end(state.session_id, end_time, state.piece_count)

    def _heartbeat_db(self, plant: str) -> None:
        # Skip while offline (avoids a 10 s-blocking connect per piece) and for
        # any not-yet-real session id (-1 in flight, or a negative temp id).
        # The count self-heals: it's an absolute SET, so the next heartbeat after
        # reconnect writes the correct total.
        if not outbox.is_online():
            return
        with self._lock:
            s = self._states.get(plant)
            if s is None or s.session_id <= 0:
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

    def force_end_mode(self, plant: str, reason: str = "new session started") -> None:
        """
        End WHATEVER mode is active — WASHING, COLOR_MATCHING, or MAINTENANCE —
        immediately, regardless of that mode's own end condition. Used both
        when a new production session starts (no mode survives that; MAINTENANCE
        previously required an explicit Arrow, which let it silently swallow
        every piece of a new LOT if the Arrow was never shown) and when a break
        window starts (run_all_plants.py's break-edge check).
        """
        with self._lock:
            state = self._states.get(plant)
            if state is None:
                return
            del self._states[plant]
        self._end_session_db(state, datetime.now())
        print(f"[ModeManager] {plant} {state.mode} ended — {reason}")

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
