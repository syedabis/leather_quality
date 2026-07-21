"""
notifications.py — in-memory + flat-file store for system alerts.

Alerts (DB offline, a plant's camera/inference gone, recoveries) are recorded
here, NOT in SQL Server. That is deliberate: the whole point of a "database
offline" alert is that it must be recordable WHEN SQL Server is unreachable, so
it can't live in SQL Server. A plain JSONL file next to the backend is the store
— no new dependency, survives a backend restart (given a mounted volume), and
holds a week of alerts easily.

Throttle: the same (source, type) alert is suppressed if an identical one was
recorded in the last THROTTLE_S seconds. So "DB write failed" firing 600 times a
minute becomes one row every few minutes, and the timeline stays readable.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

# Override with NOTIFICATIONS_FILE (e.g. a mounted volume path) so alerts persist
# across container restarts. Defaults to the backend root for local runs.
NOTIFICATIONS_FILE = Path(
    os.getenv("NOTIFICATIONS_FILE", str(Path(__file__).resolve().parents[1] / "notifications.jsonl"))
)

THROTTLE_S      = 280       # suppress a duplicate (source,type) within this window
RETENTION_DAYS  = 7         # prune alerts older than this
MAX_IN_MEMORY   = 2000      # cap the in-memory list so it can't grow unbounded

_SEVERITY = {"error", "warning", "info"}


class NotificationStore:
    def __init__(self) -> None:
        self._lock  = threading.Lock()
        self._items: list[dict] = []
        self._next_id = 1
        self._last_emit: dict[tuple, float] = {}   # (source, type) -> epoch of last emit
        self._load()

    # ── Persistence ────────────────────────────────────────────────────────
    def _load(self) -> None:
        if not NOTIFICATIONS_FILE.exists():
            return
        try:
            cutoff = datetime.now() - timedelta(days=RETENTION_DAYS)
            for ln in NOTIFICATIONS_FILE.read_text(encoding="utf-8").splitlines():
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    rec = json.loads(ln)
                except Exception:
                    continue
                # Drop anything already older than the retention window.
                try:
                    if datetime.fromisoformat(rec["ts"]) < cutoff:
                        continue
                except Exception:
                    pass
                self._items.append(rec)
                self._next_id = max(self._next_id, int(rec.get("id", 0)) + 1)
            self._items = self._items[-MAX_IN_MEMORY:]
        except Exception as exc:
            print(f"[notifications] load failed: {exc}")

    def _rewrite_file(self) -> None:
        """Rewrite the whole file from the in-memory list (used after prune)."""
        tmp = NOTIFICATIONS_FILE.with_suffix(".tmp")
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                for rec in self._items:
                    f.write(json.dumps(rec) + "\n")
            tmp.replace(NOTIFICATIONS_FILE)
        except Exception as exc:
            print(f"[notifications] rewrite failed: {exc}")

    def _append_file(self, rec: dict) -> None:
        try:
            with open(NOTIFICATIONS_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec) + "\n")
        except Exception as exc:
            print(f"[notifications] append failed: {exc}")

    # ── Public API ─────────────────────────────────────────────────────────
    def add(self, ntype: str, severity: str, source: str, message: str) -> Optional[dict]:
        """Record an alert. Returns the created record, or None if throttled."""
        import time
        severity = severity if severity in _SEVERITY else "info"
        now = time.time()
        key = (source, ntype)
        with self._lock:
            last = self._last_emit.get(key)
            if last is not None and (now - last) < THROTTLE_S:
                return None   # duplicate within the throttle window — suppress
            self._last_emit[key] = now
            rec = {
                "id":       self._next_id,
                "ts":       datetime.now().isoformat(timespec="seconds"),
                "type":     ntype,
                "severity": severity,
                "source":   source,
                "message":  message,
                "read":     False,
            }
            self._next_id += 1
            self._items.append(rec)
            if len(self._items) > MAX_IN_MEMORY:
                self._items = self._items[-MAX_IN_MEMORY:]
            self._append_file(rec)
        return rec

    def list_recent(self, limit: int = 200) -> list[dict]:
        with self._lock:
            return list(reversed(self._items[-limit:]))   # newest first

    def since(self, after_id: int) -> list[dict]:
        """All alerts with id > after_id, oldest first (for the WS push)."""
        with self._lock:
            return [r for r in self._items if r["id"] > after_id]

    def latest_id(self) -> int:
        with self._lock:
            return self._items[-1]["id"] if self._items else 0

    def unread_count(self) -> int:
        with self._lock:
            return sum(1 for r in self._items if not r.get("read"))

    def mark_all_read(self) -> int:
        with self._lock:
            n = 0
            for r in self._items:
                if not r.get("read"):
                    r["read"] = True
                    n += 1
            if n:
                self._rewrite_file()
        return n

    def prune(self) -> int:
        """Drop alerts older than RETENTION_DAYS. Returns how many were removed."""
        cutoff = datetime.now() - timedelta(days=RETENTION_DAYS)
        with self._lock:
            before = len(self._items)
            kept = []
            for r in self._items:
                try:
                    if datetime.fromisoformat(r["ts"]) >= cutoff:
                        kept.append(r)
                except Exception:
                    kept.append(r)
            removed = before - len(kept)
            if removed:
                self._items = kept
                self._rewrite_file()
        return removed


# ── Module-level singleton ──────────────────────────────────────────────────
notifications = NotificationStore()
