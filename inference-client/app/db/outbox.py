"""
outbox.py — store-and-forward buffer for DB writes.

When SQL Server is unreachable, DB operations are appended to a local JSONL file
(db_outbox.jsonl in the inference-client root) instead of being lost. A background
thread probes the DB and, once it is reachable again, replays the buffered
operations and clears the file. Flat file only — no new dependency, and it
survives a process crash or power cut because every operation is on disk before
it is acknowledged.

WHY A HEALTH FLAG IS THE HEART OF THIS
--------------------------------------
get_connection() blocks up to 10 s when the DB is down. If every per-frame write
tried that, six plants at 2 FPS would grind to a halt during an outage. So the
moment a write fails we flip a shared flag to OFFLINE, and from then on every
writer skips the connection attempt entirely and just appends to the file (a fast
local op). Only the flusher thread touches the DB while offline — probing it on
its own thread, where a 10 s block is harmless. When a probe finally succeeds we
replay the buffer and flip back to ONLINE.

Metrics records are coalesced on replay (summed per plant+hour), so a long outage
replays as a handful of UPDATEs instead of tens of thousands.
"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from app.db.connection import get_connection

# Lives in the inference-client root, next to logs/ and recordings/.
OUTBOX_FILE      = Path(__file__).resolve().parents[2] / "db_outbox.jsonl"
PROBE_INTERVAL_S = 5     # how often the flusher probes the DB / checks for pending
NOTIFY_REPEAT_S  = 300   # while still offline, re-fire the offline alert this often


class _Outbox:
    def __init__(self) -> None:
        self._state_lock = threading.Lock()   # guards _online
        self._file_lock  = threading.Lock()   # guards the outbox file
        self._online      = True

        # Notification hooks (Feature 3). on_offline fires when the DB drops and
        # is RE-FIRED every NOTIFY_REPEAT_S while it stays down (so the dashboard
        # shows "still offline at 11:12" without spamming). on_online fires once
        # on recovery.
        self.on_offline: Optional[Callable[[], None]] = None
        self.on_online:  Optional[Callable[[], None]] = None
        self._last_offline_notify = 0.0

        # Session temp-IDs. A session created while offline has no real SessionId
        # yet, so it gets a negative temp id here. On replay the INSERT runs, the
        # DB hands back the real id, and _id_map remembers temp -> real so the
        # buffered end (and any still-live in-memory session) can be redirected.
        self._temp_lock = threading.Lock()
        self._temp_seq  = -1000               # decrements; real ids are always > 0
        self._id_map: dict[int, int] = {}     # temp id -> real SessionId
        # Managers register a callback so a still-running offline-created session
        # gets its in-memory session_id swapped from temp to real on reconnect.
        self._reconcilers: list[Callable[[int, int], None]] = []

    # ── Health state ───────────────────────────────────────────────────────
    def is_online(self) -> bool:
        with self._state_lock:
            return self._online

    def _set_offline(self) -> None:
        fired = False
        with self._state_lock:
            if self._online:
                self._online = False
                fired = True
        if fired:
            print("[outbox] DB OFFLINE - buffering writes to disk")
            self._last_offline_notify = time.time()
            if self.on_offline:
                try:
                    self.on_offline()
                except Exception as exc:
                    print(f"[outbox] on_offline hook error: {exc}")

    def _set_online(self) -> None:
        fired = False
        with self._state_lock:
            if not self._online:
                self._online = True
                fired = True
        if fired:
            print("[outbox] DB ONLINE - buffer flushed")
            if self.on_online:
                try:
                    self.on_online()
                except Exception as exc:
                    print(f"[outbox] on_online hook error: {exc}")

    def mark_write_failed(self) -> None:
        """A writer calls this when a direct DB write raised."""
        self._set_offline()

    # ── Session temp-IDs & reconciliation ──────────────────────────────────
    def alloc_temp_id(self) -> int:
        """Hand out a unique negative id for a session created while offline."""
        with self._temp_lock:
            self._temp_seq -= 1
            return self._temp_seq

    def register_session_reconciler(self, fn: Callable[[int, int], None]) -> None:
        """Register a callback(temp_id, real_id) invoked after an offline-created
        session is finally inserted, so a manager can update its live state."""
        self._reconcilers.append(fn)

    # ── Enqueue ────────────────────────────────────────────────────────────
    def enqueue(self, op_type: str, payload: dict) -> None:
        """Append one operation to the buffer file. Fast, no DB contact."""
        rec  = {"type": op_type, "ts": datetime.now().isoformat(), "payload": payload}
        line = json.dumps(rec, default=str)
        with self._file_lock:
            with open(OUTBOX_FILE, "a", encoding="utf-8") as f:
                f.write(line + "\n")

    def enqueue_session_create(self, temp_id: int, plant: str, start_time,
                               session_type: Optional[str], initial_pieces: int = 0) -> None:
        self.enqueue("session_create", {
            "temp_id":        temp_id,
            "plant":          plant,
            "start_time":     start_time.isoformat() if hasattr(start_time, "isoformat") else start_time,
            "session_type":   session_type,
            "initial_pieces": initial_pieces,
        })

    def enqueue_session_end(self, session_id: int, end_time, processed_pieces: int) -> None:
        self.enqueue("session_end", {
            "session_id":      session_id,
            "end_time":        end_time.isoformat() if hasattr(end_time, "isoformat") else end_time,
            "processed_pieces": processed_pieces,
        })

    def enqueue_idle_period(self, source_note: str, idle_start, idle_end,
                             duration_s: float, total_count_at_stop: int) -> None:
        self.enqueue("idle_period", {
            "source_note":          source_note,
            "idle_start":           idle_start.isoformat() if hasattr(idle_start, "isoformat") else idle_start,
            "idle_end":             idle_end.isoformat() if hasattr(idle_end, "isoformat") else idle_end,
            "duration_s":           duration_s,
            "total_count_at_stop":  total_count_at_stop,
        })

    # ── Flusher lifecycle ──────────────────────────────────────────────────
    def start(self) -> None:
        threading.Thread(target=self._loop, name="outbox-flusher", daemon=True).start()
        print(f"[outbox] started (file={OUTBOX_FILE.name})")

    def _loop(self) -> None:
        while True:
            time.sleep(PROBE_INTERVAL_S)
            try:
                # While still offline, re-fire the alert every NOTIFY_REPEAT_S so
                # the dashboard shows a periodic reminder instead of one-and-done.
                if not self.is_online() and self.on_offline and \
                        (time.time() - self._last_offline_notify) >= NOTIFY_REPEAT_S:
                    self._last_offline_notify = time.time()
                    try:
                        self.on_offline()
                    except Exception as exc:
                        print(f"[outbox] on_offline repeat error: {exc}")

                # Nothing to do only when we're online AND the buffer is empty.
                if self.is_online() and not self._has_pending() and not self._has_leftover():
                    continue
                if self._probe_db():
                    if self._flush():
                        self._set_online()
            except Exception as exc:
                print(f"[outbox] flusher error: {exc}")

    # ── Internals ──────────────────────────────────────────────────────────
    def _has_pending(self) -> bool:
        return OUTBOX_FILE.exists() and OUTBOX_FILE.stat().st_size > 0

    def _has_leftover(self) -> bool:
        return any(OUTBOX_FILE.parent.glob(OUTBOX_FILE.name + ".flushing*"))

    def _probe_db(self) -> bool:
        try:
            with get_connection() as conn:
                conn.cursor().execute("SELECT 1")
            return True
        except Exception:
            return False

    def _flush(self) -> bool:
        """Drain the buffer to the DB. Returns True when fully drained.

        Uses rename-then-replay so a crash mid-flush can't lose records: the
        in-flight batch sits in a .flushing file until its replay commits, and
        any leftover .flushing files are recovered first on the next pass.
        """
        # Recover any batch a previous run/crash left mid-flush.
        for leftover in sorted(OUTBOX_FILE.parent.glob(OUTBOX_FILE.name + ".flushing*")):
            try:
                self._replay_file(leftover)
                leftover.unlink()
            except Exception as exc:
                print(f"[outbox] leftover replay failed, will retry: {exc}")
                return False

        # Drain the live buffer. Loop so records appended *during* a replay
        # (writers still see OFFLINE until we finish) get picked up too.
        while True:
            with self._file_lock:
                if not self._has_pending():
                    return True
                stamp = int(time.time() * 1000)
                temp  = OUTBOX_FILE.with_name(f"{OUTBOX_FILE.name}.flushing.{stamp}")
                OUTBOX_FILE.rename(temp)   # atomic; new appends make a fresh outbox
            try:
                n_lines, n_buckets = self._replay_file(temp)
                temp.unlink()
                # Print only AFTER the commit is durable and the batch file is
                # gone. If a print (or anything else) between commit and unlink
                # could throw, a failure would re-replay the batch and double-
                # count. Keeping this line last — and ASCII — closes that hole.
                print(f"[outbox] replayed {n_lines} record(s) -> {n_buckets} hour-bucket(s)")
            except Exception as exc:
                print(f"[outbox] replay failed, will retry: {exc}")
                return False

    def _replay_file(self, path: Path) -> tuple[int, int]:
        """Replay one buffer file to the DB in a single connection.

        Returns (records_read, hour_buckets_written). Deliberately does NOT print
        or do anything after commit() — see the caller for why that matters.
        """
        lines = path.read_text(encoding="utf-8").splitlines()

        # Metrics coalesce (order-independent). Session ops must run in the order
        # they were written (a create before its end), so they execute inline.
        metrics: dict[tuple, dict] = {}
        new_maps: list[tuple[int, int]] = []   # (temp_id, real_id) to reconcile after commit

        with get_connection() as conn:
            cur = conn.cursor()
            for ln in lines:
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    rec = json.loads(ln)
                except Exception:
                    continue   # skip a torn/half-written line rather than abort
                kind = rec.get("type")
                if kind == "metrics":
                    self._accumulate_metric(metrics, rec["payload"])
                elif kind == "session_create":
                    self._replay_session_create(cur, rec["payload"], new_maps)
                elif kind == "session_end":
                    self._replay_session_end(cur, rec["payload"])
                elif kind == "idle_period":
                    self._replay_idle_period(cur, rec["payload"])

            # Apply coalesced metrics after the session ops.
            for (source_note, hour_start), a in metrics.items():
                cur.execute(
                    """
                    IF NOT EXISTS (
                        SELECT 1 FROM dbo.CurrentHourMetrics
                        WHERE source_note = ? AND hour_start = ?
                    )
                    INSERT INTO dbo.CurrentHourMetrics (source_note, hour_start)
                    VALUES (?, ?)
                    """,
                    (source_note, hour_start, source_note, hour_start),
                )
                cur.execute(
                    """
                    UPDATE dbo.CurrentHourMetrics
                    SET frame_count         = frame_count         + ?,
                        piece_count         = piece_count         + ?,
                        uptime_frames       = uptime_frames       + ?,
                        downtime_frames     = downtime_frames     + ?,
                        sum_utilization     = sum_utilization     + ?,
                        idle_time_s         = idle_time_s         + ?,
                        idle_sessions_count = idle_sessions_count + ?,
                        last_belt_active    = ?,
                        last_updated        = GETDATE()
                    WHERE source_note = ? AND hour_start = ?
                    """,
                    (
                        a["frame_count"], a["piece_count"],
                        a["uptime_frames"], a["downtime_frames"],
                        a["sum_utilization"], a["idle_time_s"],
                        a["idle_sessions_count"], a["last_belt_active"],
                        source_note, hour_start,
                    ),
                )
            conn.commit()

        # Only AFTER the commit is durable do we tell the managers a temp id is
        # now a real id — so live state never points at an id the DB rolled back.
        for temp_id, real_id in new_maps:
            for fn in self._reconcilers:
                try:
                    fn(temp_id, real_id)
                except Exception as exc:
                    print(f"[outbox] reconciler error ({temp_id}->{real_id}): {exc}")

        return (len(lines), len(metrics))

    def _replay_session_create(self, cur, p: dict, new_maps: list) -> None:
        start = datetime.fromisoformat(p["start_time"])
        session_type = p.get("session_type")
        if session_type:
            cur.execute(
                """
                INSERT INTO dbo.AppSessions
                    (Plant, StartTime, Status, ProcessedPieces, session_type)
                OUTPUT INSERTED.SessionId
                VALUES (?, ?, 'INPROCESS', ?, ?)
                """,
                (p["plant"], start, int(p.get("initial_pieces", 0)), session_type),
            )
        else:
            # Regular/unaccounted session — omit session_type entirely, exactly
            # like the live (non-buffered) INSERT in session_manager.py, so the
            # column's own DEFAULT applies. Passing an explicit NULL here (as
            # this used to do) violates session_type's NOT NULL constraint and
            # makes every buffered unaccounted session fail to replay, forever.
            cur.execute(
                """
                INSERT INTO dbo.AppSessions
                    (Plant, StartTime, Status, ProcessedPieces)
                OUTPUT INSERTED.SessionId
                VALUES (?, ?, 'INPROCESS', ?)
                """,
                (p["plant"], start, int(p.get("initial_pieces", 0))),
            )
        row = cur.fetchone()
        if not row:
            return
        real_id = int(row[0])
        temp_id = int(p["temp_id"])
        self._id_map[temp_id] = real_id
        new_maps.append((temp_id, real_id))

    def _replay_session_end(self, cur, p: dict) -> None:
        sid = p["session_id"]
        if isinstance(sid, int) and sid < 0:
            # Offline-created session — resolve its temp id to the real one.
            sid = self._id_map.get(sid)
            if sid is None:
                # Its create isn't in the buffer (already flushed, or lost) —
                # nothing safe to update, skip rather than touch a wrong row.
                return
        end = datetime.fromisoformat(p["end_time"])
        cur.execute(
            """
            UPDATE dbo.AppSessions
            SET EndTime = ?, ProcessedPieces = ?, Status = 'COMPLETED'
            WHERE SessionId = ? AND Status = 'INPROCESS'
            """,
            (end, int(p.get("processed_pieces", 0)), sid),
        )

    def _replay_idle_period(self, cur, p: dict) -> None:
        cur.execute(
            "INSERT INTO dbo.IdlePeriods "
            "(idle_start, idle_end, duration_s, source_note, total_count_at_stop) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                datetime.fromisoformat(p["idle_start"]),
                datetime.fromisoformat(p["idle_end"]),
                float(p["duration_s"]),
                p["source_note"],
                int(p.get("total_count_at_stop", 0)),
            ),
        )

    @staticmethod
    def _accumulate_metric(metrics: dict[tuple, dict], p: dict) -> None:
        key = (p["source_note"], p["hour_start"])
        a = metrics.setdefault(key, {
            "frame_count": 0, "piece_count": 0,
            "uptime_frames": 0, "downtime_frames": 0,
            "sum_utilization": 0.0, "idle_time_s": 0.0,
            "idle_sessions_count": 0, "last_belt_active": 0,
        })
        belt = bool(p["belt_active"])
        a["frame_count"]         += 1
        a["piece_count"]         += int(p.get("piece_delta", 0))
        a["uptime_frames"]       += 1 if belt else 0
        a["downtime_frames"]     += 0 if belt else 1
        a["sum_utilization"]     += float(p.get("utilization_pct", 0.0))
        a["idle_time_s"]         += float(p.get("frame_time_delta_s", 0.0)) if not belt else 0.0
        a["idle_sessions_count"] += int(p.get("idle_sessions_delta", 0))
        a["last_belt_active"]     = 1 if belt else 0   # last record wins


# ── Module-level singleton ─────────────────────────────────────────────────
outbox = _Outbox()
