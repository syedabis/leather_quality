"""
Session manager — polls AppSessions for mobile-triggered (accounted) sessions and
auto-detects unaccounted sessions when 5 consecutive pieces arrive with no active session.

Timer rules:
  Accounted  : end 10 min after last piece (or session start if no pieces detected yet)
  Unaccounted: end 15 min after last piece
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from app.db.connection import get_connection
from app.db.mode_manager import mode_manager
from app.db.outbox import outbox
from app.floor_view_logger import floor_view_logger

# ── Tuning constants ───────────────────────────────────────────────────────
POLL_INTERVAL_S             = 5     # how often to poll AppSessions
CONSECUTIVE_FOR_UNACCOUNTED = 10    # pieces needed within BURST_WINDOW_S to auto-open unaccounted session
BURST_WINDOW_S              = 50    # sliding window (s) — pieces older than this are dropped from buffer
ACCOUNTED_GRACE_S           = 180   # TESTING: 3 min silence → end accounted session (normally 600 = 10 min)
UNACCOUNTED_IDLE_S          = 180   # TESTING: 3 min silence → end unaccounted session (normally 900 = 15 min)
TIMER_CHECK_INTERVAL_S      = 30    # how often to check timers
ORPHAN_CLEANUP_RETRY_MIN_S  = 2     # backoff start when orphan-cleanup fails (e.g. DB not ready yet at startup)
ORPHAN_CLEANUP_RETRY_MAX_S  = 30    # backoff cap


# ── In-memory session state ────────────────────────────────────────────────

@dataclass
class PlantSessionState:
    session_id:      int            # -1 while DB insert is in flight
    plant:           str
    session_type:    str            # 'accounted' | 'unaccounted'
    start_time:      datetime
    lot_no:          Optional[str]
    expected_pieces: Optional[int]
    current_count:   int            = 0
    last_piece_time: Optional[datetime] = None
    order_no:        Optional[str]  = None
    article_name:    Optional[str]  = None
    colour_name:     Optional[str]  = None
    party_name:      Optional[str]  = None
    pk_code:         Optional[str]  = None


# ── Manager ────────────────────────────────────────────────────────────────

class SessionManager:
    def __init__(self):
        self._lock           = threading.Lock()
        self._stop           = threading.Event()
        # plant → active session (None if no session)
        self._state: dict[str, Optional[PlantSessionState]] = {}
        # plant → list of recent piece timestamps (used to detect unaccounted sessions)
        self._consec_buffer: dict[str, list[datetime]] = {}

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def _reconcile_session_id(self, temp_id: int, real_id: int) -> None:
        """Outbox callback: an offline-created session was just inserted for real.
        If it's still live in memory, swap its temp id for the real SessionId so
        heartbeats and the eventual end hit the right row."""
        with self._lock:
            for state in self._state.values():
                if state is not None and state.session_id == temp_id:
                    state.session_id = real_id
                    print(f"[SessionManager] reconciled temp {temp_id} -> session {real_id}")

    def start(self) -> None:
        self._stop.clear()
        outbox.register_session_reconciler(self._reconcile_session_id)
        # Run in the background and keep retrying — a transient DB hiccup right
        # at startup (e.g. SQL Server/network not fully up yet after a reboot)
        # must not let a stuck session silently survive uncleaned. This must
        # not block startup either, so cameras/inference begin immediately.
        threading.Thread(
            target=self._close_orphaned_unaccounted_sessions_with_retry,
            args=(datetime.now(),),
            name="sm-orphan-cleanup",
            daemon=True,
        ).start()
        threading.Thread(target=self._poll_loop,  name="sm-poller", daemon=True).start()
        threading.Thread(target=self._timer_loop, name="sm-timer",  daemon=True).start()
        print("[SessionManager] started (poll every 5s, timers every 30s)")

    def _close_orphaned_unaccounted_sessions_with_retry(self, startup_time: datetime) -> None:
        delay = ORPHAN_CLEANUP_RETRY_MIN_S
        while not self._stop.is_set():
            if self._close_orphaned_unaccounted_sessions(startup_time):
                return
            print(f"[SessionManager] Orphan cleanup failed — retrying in {delay}s...")
            if self._stop.wait(delay):
                return
            delay = min(delay * 2, ORPHAN_CLEANUP_RETRY_MAX_S)

    def _close_orphaned_unaccounted_sessions(self, startup_time: datetime) -> bool:
        """
        Unaccounted sessions only exist in this process's memory — if it restarts
        (crash, redeploy, manual restart) any unaccounted session left INPROCESS
        in the DB becomes invisible to the new instance (the poller skips
        LotNo IS NULL rows, assuming they're its own tracked sessions). Without
        this, such rows stay INPROCESS forever. We can't resume piece-counting
        for them reliably, so close them out with whatever counts they last had.

        last_updated is capped at this run's own startup time so a delayed
        retry can't mistake frames THIS run just wrote for the old session's
        real last activity. s.StartTime < startup_time is a hard filter (not
        just used for the EndTime calc) so a retry delayed by a slow-to-come-
        back DB can never reach forward and close a session THIS SAME RUN
        legitimately created after startup -- without it, an unaccounted
        session opened while the first attempt was still failing would get
        killed the moment the retry finally succeeds. Returns True on success
        (including "nothing to clean"), False on a DB/connection failure so
        the caller can retry.
        """
        try:
            with get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    UPDATE s
                    SET s.EndTime = CASE
                            WHEN chm.last_seen IS NOT NULL AND chm.last_seen > s.StartTime
                                THEN chm.last_seen
                            ELSE s.StartTime
                        END,
                        s.Status = 'COMPLETED'
                    OUTPUT DELETED.SessionId, DELETED.Plant, DELETED.ProcessedPieces
                    FROM dbo.AppSessions s
                    OUTER APPLY (
                        SELECT MAX(last_updated) AS last_seen
                        FROM dbo.CurrentHourMetrics c
                        WHERE c.source_note = s.Plant
                          AND c.last_updated <= ?
                    ) chm
                    WHERE s.LotNo IS NULL AND s.Status = 'INPROCESS'
                      AND s.StartTime < ?
                    """,
                    (startup_time, startup_time),
                )
                rows = cur.fetchall()
                conn.commit()
            for sid, plant, proc_pcs in rows:
                print(
                    f"[SessionManager] Closed orphaned unaccounted session {sid} "
                    f"(plant={plant}, pieces={proc_pcs}) left INPROCESS by a previous run"
                )
            return True
        except Exception as exc:
            print(f"[SessionManager] Orphan cleanup attempt failed: {exc}")
            return False

    def stop(self) -> None:
        self._stop.set()
        print("[SessionManager] stopped")

    def end_active_session_for_plant(self, plant: str) -> None:
        """End any running accounted or unaccounted session for a plant.
        Called when a shape card fires 5 hits — the mode takes over. Reached
        from ModeManager.on_shape_result on the hot per-plant capture/
        inference thread, so the actual DB write is dispatched to its own
        thread rather than run inline here."""
        with self._lock:
            state = self._state.get(plant)
            if state is None:
                return
            del self._state[plant]
            self._consec_buffer.pop(plant, None)
        threading.Thread(target=self._do_end_session_db, args=(state,), daemon=True).start()
        print(f"[SessionManager] {plant} {state.session_type} session {state.session_id} ended — shape card interrupted")

    def end_all_active_sessions(self) -> None:
        """
        Ends every currently-tracked session (accounted + unaccounted) right now,
        with an accurate EndTime. Call this on a graceful shutdown so sessions
        don't get left INPROCESS for the next startup's orphan-cleanup to guess
        at — that cleanup only knows the restart time, not the real stop time.
        """
        with self._lock:
            states = [s for s in self._state.values() if s is not None]
            self._state.clear()
            # Pending buffers (< threshold, not yet aged out) would otherwise
            # vanish silently on shutdown -- flush them to the floor_view log
            # the same as an aged-out drop, so nothing goes untracked.
            pending = {p: list(b) for p, b in self._consec_buffer.items() if b}
            self._consec_buffer.clear()
        for state in states:
            self._do_end_session_db(state)
        if states:
            print(f"[SessionManager] Gracefully closed {len(states)} active session(s) on shutdown")
        for plant, buf in pending.items():
            for piece_ts in buf:
                floor_view_logger.log_dropped(
                    plant, piece_ts, len(buf),
                    reason="process stopped before threshold reached",
                )
        if pending:
            total = sum(len(b) for b in pending.values())
            print(f"[SessionManager] Flushed {total} pending unattributed piece(s) to floor_view log on shutdown")

    # ── Public API ─────────────────────────────────────────────────────────

    def get_state(self, plant: str) -> Optional[PlantSessionState]:
        with self._lock:
            return self._state.get(plant)

    def get_all_states(self) -> dict[str, Optional[PlantSessionState]]:
        with self._lock:
            return dict(self._state)

    def on_piece_detected(self, plant: str, ts: datetime, count: int = 1) -> None:
        """Called by the plant worker for each frame with piece_delta > 0.
        count is that frame's piece_delta -- a single frame can carry more
        than one new piece (several pieces entering the ROI between one
        processed frame and the next), and every one of them must be
        credited, not just the frame/call itself."""
        create_unaccounted = False
        session_start_time: Optional[datetime] = None

        with self._lock:
            state = self._state.get(plant)

            if state is not None:
                # Active session: count piece(s) and refresh last-seen timestamp
                state.current_count  += count
                state.last_piece_time = ts
                return

            # No active session — accumulate sliding-window buffer. Each
            # piece in this frame gets its own timestamp entry so the
            # consecutive-count and aging-out logic below still treats them
            # individually, exactly as if they'd arrived on separate frames.
            buf = self._consec_buffer.setdefault(plant, [])
            buf.extend([ts] * count)

            # Drop pieces older than BURST_WINDOW_S (sliding window) — these
            # never reached the consecutive threshold, so they'll never become
            # part of any session. Still counted in CurrentHourMetrics, so log
            # them: this is exactly the gap that makes metrics-based reports
            # (Daily Summary) disagree with session-based reports (Daily Detail).
            while buf and (ts - buf[0]).total_seconds() > BURST_WINDOW_S:
                dropped_ts = buf.pop(0)
                floor_view_logger.log_dropped(
                    plant, dropped_ts, len(buf),
                    reason="aged out of burst window before reaching threshold",
                )

            if len(buf) >= CONSECUTIVE_FOR_UNACCOUNTED:
                session_start_time = buf[0]
                # A multi-piece frame can push the buffer past the threshold
                # in one jump (e.g. 8 -> 11), so credit the real buffered
                # count, not the CONSECUTIVE_FOR_UNACCOUNTED constant, or the
                # extra pieces above the threshold would be lost right here.
                initial_count = len(buf)
                buf.clear()
                create_unaccounted = True
                # Insert placeholder immediately so no duplicate is created
                self._state[plant] = PlantSessionState(
                    session_id      = -1,
                    plant           = plant,
                    session_type    = 'unaccounted',
                    start_time      = session_start_time,
                    lot_no          = None,
                    expected_pieces = None,
                    current_count   = initial_count,
                    last_piece_time = ts,
                )

        if create_unaccounted and session_start_time is not None:
            threading.Thread(
                target=self._create_unaccounted_session,
                args=(plant, session_start_time),
                daemon=True,
            ).start()

    def start_burst_unaccounted(
        self, plant: str, start_time: datetime, piece_count: int
    ) -> None:
        """
        Immediately open an UNACCOUNTED session starting at start_time with piece_count
        pieces already credited.  Called when WASHING/COLOR_MATCHING ends via a piece
        burst — those burst pieces belong to the new session, not the mode session.
        """
        with self._lock:
            self._consec_buffer.pop(plant, None)
            if self._state.get(plant) is not None:
                return   # another session somehow already open — skip
            self._state[plant] = PlantSessionState(
                session_id      = -1,
                plant           = plant,
                session_type    = 'unaccounted',
                start_time      = start_time,
                lot_no          = None,
                expected_pieces = None,
                current_count   = piece_count,
                last_piece_time = start_time,
            )
        threading.Thread(
            target=self._create_burst_unaccounted_db,
            args=(plant, start_time, piece_count),
            daemon=True,
        ).start()

    def _create_burst_unaccounted_db(
        self, plant: str, start_time: datetime, piece_count: int
    ) -> None:
        """INSERT burst-triggered UNACCOUNTED session with initial piece count."""
        if not outbox.is_online():
            self._buffer_session_create(plant, start_time, piece_count)
            return
        try:
            with get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO dbo.AppSessions (Plant, StartTime, Status, ProcessedPieces)
                    OUTPUT INSERTED.SessionId
                    VALUES (?, ?, 'INPROCESS', ?)
                    """,
                    (plant, start_time, piece_count),
                )
                row = cur.fetchone()
                conn.commit()
            if row:
                session_id = int(row[0])
                with self._lock:
                    mem = self._state.get(plant)
                    if mem is not None and mem.session_id == -1:
                        mem.session_id = session_id
                print(
                    f"[SessionManager] Burst-unaccounted session {session_id} created "
                    f"for {plant} (start={start_time}, pieces={piece_count})"
                )
        except Exception as exc:
            print(f"[SessionManager] Burst create failed, buffering for {plant}: {exc}")
            outbox.mark_write_failed()
            self._buffer_session_create(plant, start_time, piece_count)

    # ── Background loops ───────────────────────────────────────────────────

    def _poll_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._poll_all_plants()
            except Exception as exc:
                print(f"[SessionManager] Poll error: {exc}")
            self._stop.wait(POLL_INTERVAL_S)

    def _timer_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._check_all_timers()
            except Exception as exc:
                print(f"[SessionManager] Timer error: {exc}")
            self._stop.wait(TIMER_CHECK_INTERVAL_S)

    # ── Polling logic ──────────────────────────────────────────────────────

    def _poll_all_plants(self) -> None:
        # Skip entirely while the DB is down. The poll only READS accounted
        # sessions (which can't change during an outage — mobile can't write
        # either) and writes heartbeats (which self-heal on reconnect since
        # they SET an absolute count). Skipping avoids a 10 s-blocking connect
        # every cycle and stops the accounted/unaccounted logic from acting on
        # a stale, unreadable DB. New pieces meanwhile become buffered
        # unaccounted sessions, and everything resumes when the DB is back.
        if not outbox.is_online():
            return
        sql = """
            SELECT s.SessionId, s.LotNo, s.IssueNoCounter, s.Plant, s.StartTime,
                   s.ExpectedPieces, s.ProcessedPieces,
                   wb.OrderNo, wb.ArticleName, wb.ColourName, wb.PartyName, wb.PK
            FROM dbo.AppSessions s
            LEFT JOIN dbo.WBIssuance_Info wb ON wb.IssueNoCounter = s.IssueNoCounter
            WHERE s.Status = 'INPROCESS'
            ORDER BY s.StartTime ASC
        """
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql)
            db_rows = cur.fetchall()

        # Only process accounted (LotNo IS NOT NULL) sessions from DB.
        # Unaccounted sessions are created and tracked entirely in-memory by this process.
        # Mobile enforces one session per plant at a time, so the only valid transitions are:
        #   None       → accounted  (mobile opened a new lot, poller picks it up)
        #   accounted  → accounted  (same session, refresh metadata)
        db_by_plant: dict[str, dict] = {}
        for row in db_rows:
            (sid, lot_no, issue_ctr, plant, start_time,
             exp_pcs, proc_pcs, order_no, article_name,
             colour_name, party_name, pk_code) = row
            if lot_no is None:
                continue   # our own unaccounted sessions — skip
            entry = {
                "session_id":       sid,
                "lot_no":           str(lot_no),
                "plant":            plant,
                "start_time":       start_time,
                "expected_pieces":  int(exp_pcs)  if exp_pcs  is not None else None,
                "processed_pieces": int(proc_pcs) if proc_pcs is not None else 0,
                "order_no":         order_no,
                "article_name":     article_name,
                "colour_name":      colour_name,
                "party_name":       party_name,
                "pk_code":          str(pk_code) if pk_code else None,
            }
            if plant not in db_by_plant:
                db_by_plant[plant] = entry

        states_to_end: list[PlantSessionState] = []
        counts_to_update: list[tuple[int, int]] = []   # (session_id, current_count)

        with self._lock:
            for plant, db_row in db_by_plant.items():
                mem = self._state.get(plant)

                if mem is None:
                    # If WASHING/COLOR_MATCHING is running, end it before production starts
                    mode_manager.force_end_mode(plant)
                    # New accounted session from mobile — start tracking
                    self._state[plant] = self._make_accounted_state(plant, db_row)

                elif mem.session_type == 'unaccounted':
                    if mem.session_id != -1 and mem.session_id == db_row["session_id"]:
                        # Same row — mobile used assign-lot to relabel our unaccounted session.
                        # Upgrade in-memory state to accounted without ending or restarting it.
                        mem.session_type    = 'accounted'
                        mem.lot_no          = db_row["lot_no"]
                        mem.expected_pieces = db_row["expected_pieces"]
                        mem.order_no        = db_row["order_no"]
                        mem.article_name    = db_row["article_name"]
                        mem.colour_name     = db_row["colour_name"]
                        mem.party_name      = db_row["party_name"]
                        mem.pk_code         = db_row["pk_code"]
                        print(f"[SessionManager] {plant} unaccounted session {mem.session_id} upgraded to accounted via assign-lot")
                    else:
                        # Different session ID — mobile started a new accounted session
                        # while our unaccounted was running. End ours, track the new one.
                        states_to_end.append(mem)
                        self._consec_buffer.pop(plant, None)
                        self._state[plant] = self._make_accounted_state(plant, db_row)

                elif mem.session_type == 'accounted':
                    if mem.session_id != db_row["session_id"]:
                        # Different session ID — mobile ended previous and opened a new one
                        states_to_end.append(mem)
                        self._state[plant] = self._make_accounted_state(plant, db_row)
                    # Same session — no metadata refresh; mobile owns lot details

            # Detect accounted sessions that mobile ended without starting a new one.
            # Without this, our in-memory state stays alive, pieces pile into it silently,
            # and no unaccounted session can ever trigger for that plant.
            for plant, mem in list(self._state.items()):
                if mem is not None and mem.session_type == 'accounted' and plant not in db_by_plant:
                    states_to_end.append(mem)
                    del self._state[plant]
                    print(f"[SessionManager] {plant} accounted session {mem.session_id} ended by mobile — removing from memory")

            # Collect heartbeat updates for all active sessions with a real session_id
            for plant, mem in self._state.items():
                if mem is not None and mem.session_id != -1:
                    counts_to_update.append((mem.session_id, mem.current_count))

        # End superseded sessions outside the lock
        for state in states_to_end:
            self._do_end_session_db(state)

        # Heartbeat: write current ProcessedPieces back to DB (keeps dashboard fresh)
        if counts_to_update:
            try:
                with get_connection() as conn:
                    cur = conn.cursor()
                    for sid, cnt in counts_to_update:
                        cur.execute(
                            "UPDATE dbo.AppSessions SET ProcessedPieces = ? "
                            "WHERE SessionId = ? AND Status = 'INPROCESS'",
                            (cnt, sid),
                        )
                    conn.commit()
            except Exception as exc:
                print(f"[SessionManager] Heartbeat write failed: {exc}")

    @staticmethod
    def _make_accounted_state(plant: str, db_row: dict) -> PlantSessionState:
        return PlantSessionState(
            session_id      = db_row["session_id"],
            plant           = plant,
            session_type    = 'accounted',
            # Use this process's own clock (not db_row["start_time"], which is
            # stamped by the mobile/SQL Server clock) so that grace-period math
            # in _check_all_timers (now - ref) stays internally consistent even
            # when the two machines' clocks are out of sync.
            start_time      = datetime.now(),
            lot_no          = db_row["lot_no"],
            expected_pieces = db_row["expected_pieces"],
            current_count   = db_row["processed_pieces"],
            last_piece_time = None,
            order_no        = db_row["order_no"],
            article_name    = db_row["article_name"],
            colour_name     = db_row["colour_name"],
            party_name      = db_row["party_name"],
            pk_code         = db_row["pk_code"],
        )

    # ── Timer logic ────────────────────────────────────────────────────────

    def _check_all_timers(self) -> None:
        now = datetime.now()
        to_end: list[tuple[str, PlantSessionState]] = []

        with self._lock:
            for plant, state in list(self._state.items()):
                if state is None or state.session_id == -1:
                    continue

                if state.session_type == 'accounted':
                    # 10-min grace from last piece (fall back to session start if no pieces yet)
                    ref = state.last_piece_time or state.start_time
                    if (now - ref).total_seconds() > ACCOUNTED_GRACE_S:
                        to_end.append((plant, state))

                elif state.session_type == 'unaccounted':
                    if state.last_piece_time is not None:
                        if (now - state.last_piece_time).total_seconds() > UNACCOUNTED_IDLE_S:
                            to_end.append((plant, state))

        for plant, state in to_end:
            self._end_session(plant, state)

    # ── Session lifecycle helpers ──────────────────────────────────────────

    def _buffer_session_create(self, plant: str, start_time: datetime, initial_pieces: int) -> None:
        """Buffer an unaccounted-session INSERT to the outbox and give the live
        state a temp id, so the session survives an outage instead of being
        dropped. The outbox reconciler swaps the temp id for the real SessionId
        once the DB is back."""
        temp_id = outbox.alloc_temp_id()
        outbox.enqueue_session_create(temp_id, plant, start_time, None, initial_pieces)
        with self._lock:
            mem = self._state.get(plant)
            if mem is not None and mem.session_id == -1:
                mem.session_id = temp_id
        print(f"[SessionManager] Unaccounted session buffered (temp {temp_id}) for {plant} - DB offline")

    def _create_unaccounted_session(self, plant: str, start_time: datetime) -> None:
        """INSERT unaccounted session into AppSessions, then update in-memory session_id."""
        if not outbox.is_online():
            self._buffer_session_create(plant, start_time, 0)
            return
        try:
            with get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO dbo.AppSessions (Plant, StartTime, Status, ProcessedPieces)
                    OUTPUT INSERTED.SessionId
                    VALUES (?, ?, 'INPROCESS', 0)
                    """,
                    (plant, start_time),
                )
                row = cur.fetchone()
                conn.commit()
            if row:
                session_id = int(row[0])
                with self._lock:
                    mem = self._state.get(plant)
                    if mem is not None and mem.session_id == -1:
                        mem.session_id = session_id
                print(f"[SessionManager] Unaccounted session {session_id} created for {plant}")
        except Exception as exc:
            # DB died mid-attempt → buffer instead of dropping the session.
            print(f"[SessionManager] Create failed, buffering unaccounted for {plant}: {exc}")
            outbox.mark_write_failed()
            self._buffer_session_create(plant, start_time, 0)

    def _end_session(self, plant: str, state: PlantSessionState) -> None:
        """Remove from memory (with safety check), then write COMPLETED to DB."""
        with self._lock:
            if self._state.get(plant) is not state:
                return  # already replaced by a newer session
            del self._state[plant]
        self._do_end_session_db(state)

    def _do_end_session_db(self, state: PlantSessionState) -> None:
        """Write EndTime + COMPLETED to DB. Caller must already have removed from _state."""
        if state.session_id == -1:
            return  # never persisted (online insert still in flight) — nothing to end
        end_time = datetime.now()

        # Offline → buffer the end so the session doesn't get stuck INPROCESS.
        # state.session_id may be a temp id (offline-created, resolved on replay)
        # or a real id (e.g. an accounted session that idled out mid-outage).
        if not outbox.is_online():
            outbox.enqueue_session_end(state.session_id, end_time, state.current_count)
            print(f"[SessionManager] Session end buffered (id {state.session_id}, "
                  f"{state.session_type}, pieces={state.current_count}) - DB offline")
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
                    (end_time, state.current_count, state.session_id),
                )
                conn.commit()
            print(
                f"[SessionManager] Session {state.session_id} completed "
                f"({state.session_type}, plant={state.plant}, pieces={state.current_count})"
            )
        except Exception as exc:
            print(f"[SessionManager] End write failed, buffering session {state.session_id}: {exc}")
            outbox.mark_write_failed()
            outbox.enqueue_session_end(state.session_id, end_time, state.current_count)


# ── Module-level singleton ─────────────────────────────────────────────────
session_manager = SessionManager()
