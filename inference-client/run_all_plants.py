"""
run_all_plants.py — Spray Plant Multi-Unit Inference (all 6 simultaneously)

Opens 6 OpenCV windows arranged in a 3×2 grid, one per spray plant.
Each plant runs in its own thread: read frame → GPU inference → track → DB write → display queue.
The main thread owns all windows and keyboard input (cv2 is not thread-safe on Windows).

Usage:
    python run_all_plants.py
    python run_all_plants.py --max-seconds 60

Controls:
  ESC — stop all plants and exit
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import json
import os
import queue
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import requests
import torch
from ultralytics import YOLO

from datetime import datetime

from app.db.connection import get_connection
from app.db.frame_processor import FrameProcessor
from app.db.session_manager import session_manager
from app.db.mode_manager import mode_manager, SHAPE_CHECK_EVERY_N

# ── RTSP stream stability — force TCP transport so UDP packet loss can't
#    cause "Duplicate POC" / "Could not find ref" decoder errors.
#    Must be set before any cv2.VideoCapture() call.
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|buffer_size;65536|max_delay;500000|reorder_queue_size;0"
os.environ["OPENCV_LOG_LEVEL"] = "SILENT"   # suppress FFmpeg decoder warnings in terminal

# ── GPU / device ───────────────────────────────────────────────────────────
DEVICE   = "cuda:0" if torch.cuda.is_available() else "cpu"
_gpu_lock = threading.Lock()   # serialize GPU calls — CUDA predict is not thread-safe

# ── Paths ──────────────────────────────────────────────────────────────────
BASE         = Path(__file__).parent
MODEL        = BASE / "yolov8s_seg_best.pt"
SHAPE_MODEL  = BASE / "maintenance model.pt"
VIDEOS_DIR  = BASE / "videos"
CFG_FILE    = BASE / "unit_configs.json"

# ── Inference config ───────────────────────────────────────────────────────
TARGET_FPS       = 2
CONF             = 0.85
IDLE_TIMEOUT_SEC        = 30   # default — overridden at startup from DB SystemSettings
DOWNTIME_THRESHOLD_SEC  = 300  # default — overridden at startup from DB SystemSettings

# ── Display config — calculated dynamically from screen resolution ─────────
GRID_COLS  = 3
GRID_ROWS  = 2
WINDOW_GAP = 4
DISPLAY_W  = 640   # overridden at startup by _calc_window_size()
DISPLAY_H  = 360   # overridden at startup by _calc_window_size()

# launch.ps1 creates this file to request a graceful stop before force-killing
# the process (e.g. on restart or full shutdown), so active sessions get
# closed with an accurate EndTime instead of being orphaned for the next
# startup's cleanup to guess at.
STOP_SIGNAL_FILE = Path(__file__).resolve().parent / ".stop_signal"


def _get_screen_size() -> tuple[int, int]:
    """Return physical screen width/height in pixels, DPI-aware."""
    try:
        user32 = ctypes.windll.user32
        user32.SetProcessDPIAware()
        sw = user32.GetSystemMetrics(0)
        sh = user32.GetSystemMetrics(1)
        # GetSystemMetrics(0)/(1) reports the *primary* monitor, which can be
        # misdetected (e.g. a portrait secondary display flagged primary, or a
        # stale RDP session size) and return a value that isn't a normal
        # landscape desktop resolution. Reject anything implausible rather
        # than letting it stretch the grid windows into a bad aspect ratio.
        if sw < 1024 or sh < 600 or sh >= sw:
            return 1920, 1080
        return sw, sh
    except Exception:
        return 1920, 1080


def _calc_window_size() -> tuple[int, int]:
    """Calculate per-window size so all 6 fit on screen with gaps."""
    sw, sh = _get_screen_size()
    # Reserve ~50px for taskbar and a small top margin
    usable_w = sw - WINDOW_GAP * (GRID_COLS + 1)
    usable_h = sh - 50 - WINDOW_GAP * (GRID_ROWS + 1)
    w = usable_w // GRID_COLS
    h = usable_h // GRID_ROWS
    # Clamp to reasonable bounds
    w = max(320, min(w, 960))
    h = max(180, min(h, 540))
    return w, h

# ── Plant / DB mapping ─────────────────────────────────────────────────────
UNITS = ["SP-01", "SP-02", "SP-03", "SP-04", "SP-05", "SP-06"]
UNIT_MAP = {
    "SP-01": "SP-01", "SP-02": "SP-02", "SP-03": "SP-03",
    "SP-04": "SP-04", "SP-05": "SP-05", "SP-06": "SP-06",
}

# ── Backend frame streaming ────────────────────────────────────────────────
BACKEND_URL   = os.getenv("BACKEND_URL", "http://localhost:8001").rstrip("/")
THUMB_EVERY   = 1     # push every processed frame for real-time monitoring
THUMB_QUALITY = 60
THUMB_W       = 640   # resize before encoding — cuts payload ~4x vs full res
THUMB_H       = 360
_push_pool    = ThreadPoolExecutor(max_workers=4, thread_name_prefix="frame-push")


def _push_frame(plant_id: str, frame_bgr) -> None:
    if not BACKEND_URL:
        return
    small = cv2.resize(frame_bgr, (THUMB_W, THUMB_H), interpolation=cv2.INTER_LINEAR)
    ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, THUMB_QUALITY])
    if not ok:
        return
    b64 = base64.b64encode(buf.tobytes()).decode()

    def _post():
        try:
            requests.post(
                f"{BACKEND_URL}/api/frame/{plant_id}",
                json={"frame": b64},
                timeout=1.5,
            )
        except Exception:
            pass

    _push_pool.submit(_post)


# ── Settings helpers ──────────────────────────────────────────────────────

def _load_settings() -> dict:
    """Read SystemSettings from DB. Falls back to defaults on any error."""
    defaults = {
        "idle_timeout_sec":    30,
        "shift_start":         "07:00",
        "shift_end":           "17:00",
        "break_start_weekday": "13:00",
        "break_end_weekday":   "14:00",
        "break_start_friday":  "13:00",
        "break_end_friday":    "14:30",
        "weekly_off_days":     "Sun",
    }
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT setting_key, setting_value FROM dbo.SystemSettings")
            rows = cur.fetchall()
            if rows:
                result = dict(defaults)
                result.update({r[0]: r[1] for r in rows})
                return result
    except Exception as e:
        print(f"[settings] Could not read from DB, using defaults: {e}")
    return defaults


# ── Shift / break / holiday helpers ────────────────────────────────────────

_shift_start = "07:00"
_shift_end   = "17:00"

# Break window per day type (Friday differs by default). Refreshed from DB.
_break_start_weekday = "13:00"
_break_end_weekday   = "14:00"
_break_start_friday  = "13:00"
_break_end_friday    = "14:30"

# Break-time periodic refresh (every 5 min). Holiday is evaluated ONCE at
# startup — adding today to the holiday list mid-run will not retroactively
# change the day in progress.
_dynamic_refresh_interval_s = 300
_dynamic_last_refresh_ts   = 0.0
_holiday_today_cached      = False
_holiday_checked_at_startup = False

# Weekly off-days: CSV of 3-letter weekday names ('Sun' or 'Sat,Sun').
# Frozen at startup like holidays.
_weekly_off_days_csv       = "Sun"
_weekly_off_today_cached   = False
_weekly_off_checked_at_startup = False


def _parse_hhmm_to_min(s: str) -> int:
    try:
        h, m = s.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return 0


def _within_shift() -> bool:
    """Returns True if current time is within the configured shift window."""
    now = time.strftime("%H:%M")
    return _shift_start <= now <= _shift_end


def _in_break() -> bool:
    """Returns True if current time is within the configured break window.

    Friday uses the Friday break range; every other day uses the weekday range.
    """
    now = time.localtime()
    now_min = now.tm_hour * 60 + now.tm_min
    if now.tm_wday == 4:           # Friday (Monday=0 ... Sunday=6)
        start_s, end_s = _break_start_friday, _break_end_friday
    else:
        start_s, end_s = _break_start_weekday, _break_end_weekday
    return _parse_hhmm_to_min(start_s) <= now_min < _parse_hhmm_to_min(end_s)


def _refresh_dynamic_state() -> None:
    """Periodically re-read break-time settings from DB.

    Refreshed at most once per `_dynamic_refresh_interval_s`. Failures are
    swallowed and previous values are kept so a transient DB hiccup does not
    disrupt the inference loop. Holiday is NOT refreshed here — see
    `_check_holiday_at_startup`.
    """
    global _dynamic_last_refresh_ts
    global _break_start_weekday, _break_end_weekday, _break_start_friday, _break_end_friday
    now_ts = time.time()
    if now_ts - _dynamic_last_refresh_ts < _dynamic_refresh_interval_s:
        return
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT setting_key, setting_value FROM dbo.SystemSettings "
                "WHERE setting_key IN ('break_start_weekday','break_end_weekday',"
                "'break_start_friday','break_end_friday')"
            )
            s = {r[0]: r[1] for r in cur.fetchall()}
            if s.get("break_start_weekday"): _break_start_weekday = s["break_start_weekday"]
            if s.get("break_end_weekday"):   _break_end_weekday   = s["break_end_weekday"]
            if s.get("break_start_friday"):  _break_start_friday  = s["break_start_friday"]
            if s.get("break_end_friday"):    _break_end_friday    = s["break_end_friday"]
            _dynamic_last_refresh_ts = now_ts
    except Exception as e:
        print(f"[dynamic] refresh failed (keeping previous values): {e}")


def _check_holiday_at_startup() -> None:
    """One-shot holiday check, evaluated when the inference launches.

    Whatever value this sets persists for the lifetime of the run. Adding
    today to the Holidays table mid-day will not retroactively flip the flag.
    """
    global _holiday_today_cached, _holiday_checked_at_startup
    if _holiday_checked_at_startup:
        return
    today = time.strftime("%Y-%m-%d")
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT description FROM dbo.Holidays WHERE holiday_date = CAST(? AS DATE)",
                (today,),
            )
            row = cur.fetchone()
            _holiday_today_cached = row is not None
            if _holiday_today_cached:
                desc = row[0] or "(no description)"
                print(f"[holiday]  Today ({today}) is marked a holiday — "
                      f"DB writes will be skipped. Reason: {desc}")
            else:
                print(f"[holiday]  Today ({today}) is not a holiday.")
    except Exception as e:
        _holiday_today_cached = False
        print(f"[holiday]  Check failed (treating as non-holiday): {e}")
    _holiday_checked_at_startup = True


def _is_holiday_today() -> bool:
    return _holiday_today_cached


def _check_weekly_off_at_startup() -> None:
    """One-shot weekly-off check, evaluated when the inference launches.

    Frozen for the lifetime of the run, same as the holiday flag.
    """
    global _weekly_off_today_cached, _weekly_off_checked_at_startup
    if _weekly_off_checked_at_startup:
        return
    today_abbrev = time.strftime("%a")   # 'Sun', 'Mon', ...
    off = {d.strip() for d in _weekly_off_days_csv.split(",") if d.strip()}
    _weekly_off_today_cached = today_abbrev in off
    if _weekly_off_today_cached:
        print(f"[weekly]   Today is {today_abbrev} — configured as a weekly off-day. "
              f"DB writes will be skipped.")
    else:
        print(f"[weekly]   Today is {today_abbrev}. Configured off-days: "
              f"{_weekly_off_days_csv}")
    _weekly_off_checked_at_startup = True


def _is_weekly_off_today() -> bool:
    return _weekly_off_today_cached


def _is_off_today() -> bool:
    """Combined: holiday OR weekly off-day."""
    return _is_holiday_today() or _is_weekly_off_today()


# ── Config helpers (identical to run_live_preview.py) ─────────────────────

def _load_unit_configs() -> dict:
    if not CFG_FILE.exists():
        return {}
    try:
        with open(CFG_FILE) as f:
            return json.load(f)
    except Exception as exc:
        print(f"[warn] Could not load {CFG_FILE.name}: {exc}")
        return {}


def _get_unit_cfg(configs: dict, unit: str, frame_w: int, frame_h: int):
    entry    = configs.get(unit, {})
    roi_norm = entry.get("roi",  {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0})
    ln_norm  = entry.get("line", {"start": [0.5, 0.0], "end": [0.5, 1.0]})
    roi = {
        "x": int(roi_norm["x"] * frame_w), "y": int(roi_norm["y"] * frame_h),
        "w": int(roi_norm["w"] * frame_w), "h": int(roi_norm["h"] * frame_h),
    }
    line = {
        "start": [int(ln_norm["start"][0] * frame_w), int(ln_norm["start"][1] * frame_h)],
        "end":   [int(ln_norm["end"][0]   * frame_w), int(ln_norm["end"][1]   * frame_h)],
    }
    return roi, line


def _get_unit_source(configs: dict, unit: str) -> Optional[str]:
    src = (configs.get(unit) or {}).get("source", "")
    return str(src).strip() or None


def _get_unit_conf(configs: dict, unit: str) -> float:
    """Per-unit YOLO confidence threshold from unit_configs.json, falling back to CONF."""
    val = (configs.get(unit) or {}).get("confidence")
    try:
        return float(val) if val is not None else CONF
    except (TypeError, ValueError):
        return CONF


def _is_stream_url(source: str) -> bool:
    return source.lower().startswith(("rtsp://", "rtsps://", "http://", "https://", "udp://", "tcp://"))


def _resolve_sources(source: str) -> list:
    if _is_stream_url(source):
        return [source]
    p = Path(source)
    if p.is_dir():
        videos = sorted(p.glob("*.mp4"))
        if not videos:
            print(f"  [warn] No .mp4 files in: {p}")
        return videos
    if p.is_file():
        return [p]
    print(f"  [warn] Source not found: {source}")
    return []


def _in_roi(cx: float, cy: float, roi: dict) -> bool:
    return (roi["x"] <= cx <= roi["x"] + roi["w"] and
            roi["y"] <= cy <= roi["y"] + roi["h"])


def _suppress_overlapping_tracks(
    track_results: list[tuple[int, list]],
    iou_threshold: float = 0.30,
    iomin_threshold: float = 0.50,
) -> list[tuple[int, list]]:
    """Remove duplicate track IDs caused by one object getting multiple detections.

    Two checks (older ID always wins):
    1. IoU > iou_threshold   — boxes overlap significantly (side-by-side duplicates)
    2. IoMin > iomin_threshold — one box is mostly contained inside the other
       (small fragment box inside a large leather-piece box; IoU is low but
        intersection / min-area is high)
    """
    if len(track_results) <= 1:
        return track_results
    sorted_tracks = sorted(track_results, key=lambda x: x[0])
    kept: list[tuple[int, list]] = []
    suppressed: set[int] = set()
    for i, (tid_i, box_i) in enumerate(sorted_tracks):
        if tid_i in suppressed:
            continue
        kept.append((tid_i, box_i))
        for tid_j, box_j in sorted_tracks[i + 1:]:
            if tid_j in suppressed:
                continue
            # Standard IoU check
            if SimpleIoUTracker._iou(box_i, box_j) > iou_threshold:
                suppressed.add(tid_j)
                continue
            # Containment check: intersection / min-area
            ix1 = max(box_i[0], box_j[0]); iy1 = max(box_i[1], box_j[1])
            ix2 = min(box_i[2], box_j[2]); iy2 = min(box_i[3], box_j[3])
            inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
            area_i = max(1.0, (box_i[2] - box_i[0]) * (box_i[3] - box_i[1]))
            area_j = max(1.0, (box_j[2] - box_j[0]) * (box_j[3] - box_j[1]))
            if inter / min(area_i, area_j) > iomin_threshold:
                suppressed.add(tid_j)
    return kept


# ── Tracker & counter (per-plant instances) ────────────────────────────────

class SimpleIoUTracker:
    def __init__(self, iou_thresh: float = 0.25, max_age: int = 20):
        self.iou_thresh = iou_thresh
        self.max_age    = max_age
        self._next_id   = 1
        self._tracks: dict[int, dict] = {}

    @staticmethod
    def _iou(a, b) -> float:
        ix1 = max(a[0], b[0]); iy1 = max(a[1], b[1])
        ix2 = min(a[2], b[2]); iy2 = min(a[3], b[3])
        inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
        if inter == 0.0:
            return 0.0
        area_a = (a[2] - a[0]) * (a[3] - a[1])
        area_b = (b[2] - b[0]) * (b[3] - b[1])
        return inter / (area_a + area_b - inter)

    def reset(self):
        self._tracks.clear()

    def update(self, boxes: list) -> list[tuple[int, list]]:
        matched_tids: set[int] = set()
        det_to_tid: dict[int, int] = {}
        for di, box in enumerate(boxes):
            best_iou, best_tid = self.iou_thresh, None
            for tid, trk in self._tracks.items():
                if tid in matched_tids:
                    continue
                iou = self._iou(box, trk["box"])
                if iou > best_iou:
                    best_iou, best_tid = iou, tid
            if best_tid is not None:
                det_to_tid[di] = best_tid
                matched_tids.add(best_tid)
        for di, tid in det_to_tid.items():
            self._tracks[tid]["box"] = boxes[di]
            self._tracks[tid]["age"] = 0
        for di, box in enumerate(boxes):
            if di not in det_to_tid:
                tid = self._next_id
                self._next_id += 1
                self._tracks[tid] = {"box": box, "age": 0}
                det_to_tid[di]    = tid
        for tid in list(self._tracks):
            if tid not in matched_tids:
                self._tracks[tid]["age"] += 1
                if self._tracks[tid]["age"] >= self.max_age:
                    del self._tracks[tid]
        return [(det_to_tid[i], boxes[i]) for i in range(len(boxes))]


class RoiCounter:
    def __init__(self):
        self.counted_ids: set[int] = set()

    def update(self, track_ids) -> set[int]:
        counted_now: set[int] = set()
        for tid in (track_ids or []):
            tid = int(tid)
            if tid not in self.counted_ids:
                self.counted_ids.add(tid)
                counted_now.add(tid)
        return counted_now

    @property
    def total(self) -> int:
        return len(self.counted_ids)


# ── Per-plant worker thread ────────────────────────────────────────────────

def _plant_worker(
    unit: str,
    model: YOLO,
    shape_model: YOLO,
    stop_event: threading.Event,
    frame_queue: queue.Queue,
    unit_configs: dict,
    max_seconds: Optional[float],
) -> None:
    db_unit  = UNIT_MAP.get(unit, unit)
    cfg_src  = _get_unit_source(unit_configs, unit)
    sources  = _resolve_sources(cfg_src) if cfg_src else sorted((VIDEOS_DIR / unit).glob("*.mp4")) if (VIDEOS_DIR / unit).is_dir() else []
    unit_conf = _get_unit_conf(unit_configs, unit)
    print(f"[{unit}] Confidence threshold: {unit_conf}")

    if not sources:
        print(f"[{unit}] No source found — worker exiting.")
        return

    tracker  = SimpleIoUTracker()
    counter  = RoiCounter()

    _last_shape_box: Optional[list] = None  # cached shape-card bbox → suppresses it from piece count
    _shape_box_expiry: int          = 0     # frame_num when cache expires

    total_count         = 0
    last_detection_time = time.time()
    belt_active         = True
    prev_belt_active    = True
    new_idle_session    = 0
    frames_pushed       = 0
    idle_started        = None   # time.time() when idle began (for duration calc)
    idle_period_dt      = None   # datetime when idle began (for IdlePeriods write)

    src_index = 0

    reconnect_delay = 2   # seconds; doubles on each failure, capped at 30s

    while not stop_event.is_set() and src_index < len(sources):
        source    = sources[src_index]
        is_stream = isinstance(source, str) and _is_stream_url(str(source))
        # CAP_FFMPEG picks up the OPENCV_FFMPEG_CAPTURE_OPTIONS env var (TCP transport)
        cap = cv2.VideoCapture(str(source), cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # keep buffer minimal — fresher frames

        if not cap.isOpened():
            print(f"[{unit}] Could not open source: {source}")
            if is_stream:
                # Network still down — keep retrying with the same backoff
                if not stop_event.is_set():
                    print(f"[{unit}] Retrying in {reconnect_delay}s...")
                    time.sleep(reconnect_delay)
                    reconnect_delay = min(reconnect_delay * 2, 30)
                continue
            src_index += 1
            continue

        video_fps   = cap.get(cv2.CAP_PROP_FPS) or 20.0
        frame_w     = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_h     = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        frame_skip  = max(1, round(video_fps / TARGET_FPS))
        max_frames  = int(max_seconds * video_fps) if max_seconds else 10**12
        roi, _line  = _get_unit_cfg(unit_configs, unit, frame_w, frame_h)

        dynamic_frame_skip = frame_skip
        last_frame_time    = time.time()
        frame_num          = 0
        read_failures      = 0
        MAX_READ_FAILURES  = 20   # ~4s of bad frames before declaring a real disconnect

        print(f"[{unit}] Starting: {Path(str(source)).name if not is_stream else str(source)}")

        while not stop_event.is_set():
            ret, frame = cap.read()
            if not ret:
                if is_stream:
                    read_failures += 1
                    if read_failures < MAX_READ_FAILURES:
                        time.sleep(0.1)
                        continue   # transient glitch — keep trying
                break  # genuine disconnect or video ended
            read_failures   = 0
            reconnect_delay = 2   # reset backoff after a good frame

            frame_num += 1
            if frame_num > max_frames:
                break
            if frame_num % dynamic_frame_skip != 0:
                continue

            now              = time.time()
            frame_time_delta = now - last_frame_time
            last_frame_time  = now

            # ── GPU inference (serialized across all threads) ──────────────
            with _gpu_lock:
                results = model.predict(frame, conf=unit_conf, iou=0.45, device=DEVICE, verbose=False, show=False)
            result     = results[0]
            boxes_xyxy = result.boxes.xyxy.cpu().numpy().tolist() if result.boxes is not None and len(result.boxes) > 0 else []

            # ── Tracking ───────────────────────────────────────────────────
            track_results    = _suppress_overlapping_tracks(tracker.update(boxes_xyxy))
            debug_tracks: list[dict] = []
            roi_ids: list[int] = []
            for tid, box in track_results:
                cx, cy = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0
                in_roi = _in_roi(cx, cy, roi)
                debug_tracks.append({"tid": tid, "cx": cx, "cy": cy, "in_roi": in_roi})
                if in_roi:
                    # Skip if this object overlaps a cached shape card bbox
                    if (_last_shape_box is not None and frame_num <= _shape_box_expiry
                            and SimpleIoUTracker._iou(box, _last_shape_box) > 0.3):
                        continue
                    roi_ids.append(tid)
            counted_ids_now = counter.update(roi_ids)

            count       = len(result.boxes) if result.boxes is not None else 0
            piece_delta = len(counted_ids_now)
            total_count += piece_delta

            # ── Belt idle / active state ───────────────────────────────────
            # Status is driven purely by ROI presence: as long as ANY tracked
            # object sits inside the ROI, the belt is Running (new or not).
            # Detections outside the ROI do not flip the status. Idle only
            # triggers after IDLE_TIMEOUT_SEC of no objects in the ROI at all.
            if len(roi_ids) > 0:
                last_detection_time = time.time()
                belt_active         = True
                dynamic_frame_skip  = frame_skip
                mode_manager.on_belt_activity(unit, datetime.now())
            elif time.time() - last_detection_time > IDLE_TIMEOUT_SEC:
                belt_active        = False
                dynamic_frame_skip = frame_skip * 2
                if not idle_started and _within_shift():
                    idle_started   = time.time()
                    idle_period_dt = datetime.now()
            else:
                # In-ROI activity recent but nothing there this frame — hold last status.
                dynamic_frame_skip = frame_skip

            if prev_belt_active and not belt_active:
                new_idle_session = 1
            if not prev_belt_active and belt_active:
                tracker.reset()
                if idle_started is not None and idle_period_dt is not None:
                    _dur_s = time.time() - idle_started
                    if _dur_s > 0:
                        try:
                            with get_connection() as _conn:
                                _conn.cursor().execute(
                                    "INSERT INTO dbo.IdlePeriods "
                                    "(idle_start, idle_end, duration_s, source_note, total_count_at_stop) "
                                    "VALUES (?, ?, ?, ?, ?)",
                                    (idle_period_dt, datetime.now(), round(_dur_s, 1), db_unit, total_count),
                                )
                                _conn.commit()
                        except Exception as _e:
                            print(f"[{unit}] IdlePeriods write failed: {_e}")
                idle_started   = None
                idle_period_dt = None
            prev_belt_active = belt_active

            utilization_pct = 0.0
            if result.boxes is not None and len(result.boxes) > 0 and result.boxes.conf is not None:
                utilization_pct = float(result.boxes.conf.mean().cpu().numpy()) * 100

            # ── DB write ───────────────────────────────────────────────────
            # Status (belt_active) is ALWAYS the real value so the dashboard
            # shows true Running/Idle regardless of shift. Idle time and idle
            # sessions are only accumulated during shift hours.
            in_shift = _within_shift()
            # Holiday OR weekly off-day: write nothing — no pieces, no active/
            # idle time, no idle sessions. The detector keeps running locally;
            # the DB just isn't touched so the day shows zero in the report.
            # Break time (configurable, Friday differs) is excluded from idle
            # accumulation: idle time only ticks up inside shift AND outside
            # the break window.
            # ── Shape detection (every SHAPE_CHECK_EVERY_N frames) ────────────
            if mode_manager.tick_frame(unit):
                with _gpu_lock:
                    _sr = shape_model.predict(
                        frame, conf=0.5, iou=0.45,
                        device=DEVICE, verbose=False, show=False,
                    )[0]
                _sname, _sconf = None, 0.0
                if _sr.boxes is not None and len(_sr.boxes) > 0:
                    _boxes  = _sr.boxes.xyxy.cpu().numpy()
                    _confs  = _sr.boxes.conf.cpu().numpy()
                    _clses  = _sr.boxes.cls.cpu().numpy()
                    _VALID  = {"arrow", "plus", "star", "triangle"}
                    for _bi in range(len(_boxes)):
                        _candidate = shape_model.names[int(_clses[_bi])].lower()
                        if _candidate not in _VALID:
                            continue   # ignore leather, card, anything else
                        _box  = _boxes[_bi]
                        _scx  = (_box[0] + _box[2]) / 2.0
                        _scy  = (_box[1] + _box[3]) / 2.0
                        if _in_roi(_scx, _scy, roi):
                            _sname = shape_model.names[int(_clses[_bi])]
                            _sconf = float(_confs[_bi])
                            if _sconf >= 0.75:
                                _last_shape_box   = _box.tolist()
                                _shape_box_expiry = frame_num + SHAPE_CHECK_EVERY_N * 2
                            break   # first valid shape in ROI wins
                # pieces_in_roi: are there real pieces in the ROI right now,
                # EXCLUDING the shape card itself?
                # Re-check track_results against the freshly-updated shape bbox
                # so the card isn't mistakenly counted as a "piece".
                if _last_shape_box is not None and frame_num <= _shape_box_expiry:
                    _pieces_in_roi = any(
                        _in_roi((_b[0]+_b[2])/2.0, (_b[1]+_b[3])/2.0, roi)
                        and SimpleIoUTracker._iou(_b, _last_shape_box) <= 0.3
                        for _, _b in track_results
                    )
                else:
                    _pieces_in_roi = bool(roi_ids)
                if not _is_off_today():
                    mode_manager.on_shape_result(
                        unit, _sname, _sconf, datetime.now(),
                        belt_active,
                        session_manager.get_state(unit) is not None,
                        _pieces_in_roi,
                    )

            if not _is_off_today():
                count_idle = in_shift and not _in_break()
                FrameProcessor.process_frame(
                    source_note          = db_unit,
                    total_count          = total_count,
                    belt_active          = belt_active,
                    utilization_pct      = utilization_pct,
                    piece_delta          = piece_delta,
                    frame_time_delta_s   = frame_time_delta if count_idle else 0,
                    idle_sessions_delta  = new_idle_session if count_idle else 0,
                )
                if piece_delta > 0:
                    if mode_manager.has_active_mode(unit):
                        mode_manager.on_piece_detected(unit, datetime.now())
                    else:
                        session_manager.on_piece_detected(unit, datetime.now())
            new_idle_session = 0

            # ── Render display frame (full original resolution) ────────────
            # Draw all overlays on the full-res annotated frame.
            # cv2.WINDOW_NORMAL scales it down for the grid view, and shows
            # full quality when the window is resized or full-screened.
            display = result.plot(boxes=False)
            dh, dw  = display.shape[:2]

            # ROI overlay at original pixel coords
            rx1, ry1 = roi["x"], roi["y"]
            rx2, ry2 = roi["x"] + roi["w"], roi["y"] + roi["h"]
            overlay = display.copy()
            cv2.rectangle(overlay, (rx1, ry1), (rx2, ry2), (0, 255, 0), -1)
            cv2.addWeighted(overlay, 0.08, display, 0.92, 0, display)
            _roi_thickness = max(2, int(2 * max(0.5, dw / 1280.0)))
            cv2.rectangle(display, (rx1, ry1), (rx2, ry2), (0, 255, 0), _roi_thickness)

            # Scale text/dots proportionally to actual frame width so they
            # remain readable at both grid size and full-screen.
            _scale = max(0.5, dw / 1280.0)
            _f   = cv2.FONT_HERSHEY_SIMPLEX
            _fs  = round(0.55 * _scale, 2)
            _ft  = max(1, int(1 * _scale))
            _pad = max(4, int(6 * _scale))
            _ty  = max(20, int(28 * _scale))

            # Left header: date/time
            _dt = time.strftime("%d-%m-%Y  %H:%M:%S")
            (dtw, dth), _ = cv2.getTextSize(_dt, _f, _fs, _ft)
            cv2.rectangle(display, (6 - _pad, _ty - dth - _pad), (6 + dtw + _pad, _ty + _pad), (0, 0, 0), -1)
            cv2.putText(display, _dt, (6, _ty), _f, _fs, (255, 255, 255), _ft)

            # Right header: unit | status | count
            _st_str   = "Active" if belt_active else "Downtime"
            _st_color = (0, 255, 0) if belt_active else (0, 0, 255)
            _seg_u = f"{unit} ";  _seg_s = f"({_st_str})";  _seg_c = f"  Count:{counter.total}"
            (uw, _), _ = cv2.getTextSize(_seg_u, _f, _fs, _ft)
            (sw, _), _ = cv2.getTextSize(_seg_s, _f, _fs, _ft)
            (cw, _), _ = cv2.getTextSize(_seg_c, _f, _fs, _ft)
            _rx = dw - uw - sw - cw - 8
            cv2.rectangle(display, (_rx - _pad, _ty - dth - _pad), (dw - 8 + _pad, _ty + _pad), (0, 0, 0), -1)
            cv2.putText(display, _seg_c, (dw - cw - 8, _ty),      _f, _fs, (255, 255, 255), _ft)
            cv2.putText(display, _seg_s, (dw - cw - sw - 8, _ty), _f, _fs, _st_color,       _ft)
            cv2.putText(display, _seg_u, (_rx, _ty),               _f, _fs, (255, 255, 255), _ft)

            # Track dots — radius scales with frame size
            _r_inner = max(4, int(5 * _scale))
            _r_outer = max(6, int(8 * _scale))
            for track in debug_tracks:
                tid, in_roi_flag = track["tid"], track["in_roi"]
                dcx = int(track["cx"])
                dcy = int(track["cy"])
                counted_now = tid in counted_ids_now
                counted     = tid in counter.counted_ids
                dot_color   = (255, 255, 0) if counted_now else ((0, 255, 0) if in_roi_flag else (0, 165, 255))
                cv2.circle(display, (dcx, dcy), _r_inner, dot_color, -1)
                cv2.circle(display, (dcx, dcy), _r_outer, dot_color, 2)

            # Put frame into display queue — drop oldest if full (never block inference)
            try:
                frame_queue.put_nowait(display)
            except queue.Full:
                try:
                    frame_queue.get_nowait()
                except queue.Empty:
                    pass
                frame_queue.put_nowait(display)

            frames_pushed += 1
            if frames_pushed % THUMB_EVERY == 0:
                _push_frame(unit, display)

        cap.release()

        # Loop videos; streams restart on disconnect
        if is_stream:
            if not stop_event.is_set():
                print(f"[{unit}] Stream disconnected, reconnecting in {reconnect_delay}s...")
                time.sleep(reconnect_delay)
                reconnect_delay = min(reconnect_delay * 2, 30)  # 2 → 4 → 8 → 16 → 30s max
        else:
            src_index += 1

    print(f"[{unit}] Worker done. Total counted: {counter.total}")


# ── Entry point ────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Spray Plant — All 6 Plants Simultaneously")
    parser.add_argument("--max-seconds", type=float, default=None, metavar="S",
                        help="Max seconds to process per video file (default: unlimited)")
    parser.add_argument("--model", type=Path, default=MODEL, metavar="PATH",
                        help=f"Path to YOLO model weights (default: {MODEL.name})")
    args = parser.parse_args()

    if not args.model.exists():
        raise FileNotFoundError(f"Model not found: {args.model}")

    # Load settings from DB (idle timeout, shift hours, etc.)
    global IDLE_TIMEOUT_SEC, DOWNTIME_THRESHOLD_SEC, DISPLAY_W, DISPLAY_H, _shift_start, _shift_end
    global _break_start_weekday, _break_end_weekday, _break_start_friday, _break_end_friday
    global _weekly_off_days_csv
    settings = _load_settings()
    IDLE_TIMEOUT_SEC       = int(settings.get("idle_timeout_sec",       30))
    DOWNTIME_THRESHOLD_SEC = int(settings.get("downtime_threshold_sec", 300))
    _shift_start           = settings.get("shift_start", "07:00")
    _shift_end             = settings.get("shift_end",   "17:00")
    _break_start_weekday   = settings.get("break_start_weekday", "13:00")
    _break_end_weekday     = settings.get("break_end_weekday",   "14:00")
    _break_start_friday    = settings.get("break_start_friday",  "13:00")
    _break_end_friday      = settings.get("break_end_friday",    "14:30")
    _weekly_off_days_csv   = settings.get("weekly_off_days",     "Sun")
    print(f"[settings] Idle timeout: {IDLE_TIMEOUT_SEC}s | Downtime threshold: {DOWNTIME_THRESHOLD_SEC}s")
    print(f"[shift]    Counting idle/downtime between {_shift_start} – {_shift_end}")
    print(f"[break]    Weekday {_break_start_weekday}-{_break_end_weekday} | "
          f"Friday {_break_start_friday}-{_break_end_friday} (excluded from idle)")
    _check_holiday_at_startup()
    _check_weekly_off_at_startup()

    DISPLAY_W, DISPLAY_H = _calc_window_size()
    sw, sh = _get_screen_size()
    print(f"[display]  Screen {sw}x{sh} → window {DISPLAY_W}x{DISPLAY_H} ({GRID_COLS}x{GRID_ROWS} grid)")

    if DEVICE == "cpu":
        print("[device] CUDA not available — running on CPU (will be slow for 6 plants).")
    else:
        props = torch.cuda.get_device_properties(0)
        print(f"[device] {torch.cuda.get_device_name(0)}  "
              f"({props.total_memory // 1024**2} MB VRAM)  |  CUDA {torch.version.cuda}")

    print(f"[model] Loading {args.model.name} ...")
    model = YOLO(str(args.model))
    model.to(DEVICE)
    print(f"[model] Loaded. Running 6 plants at target {TARGET_FPS} FPS each.")

    if not SHAPE_MODEL.exists():
        raise FileNotFoundError(f"Shape model not found: {SHAPE_MODEL}")
    print(f"[shape] Loading {SHAPE_MODEL.name} ...")
    shape_model = YOLO(str(SHAPE_MODEL))
    shape_model.to(DEVICE)
    print(f"[shape] Loaded.\n")

    unit_configs = _load_unit_configs()
    stop_event   = threading.Event()

    # Per-plant frame queues (maxsize=2 keeps display lag minimal)
    frame_queues: dict[str, queue.Queue] = {u: queue.Queue(maxsize=2) for u in UNITS}

    # Create and position all 6 windows before starting threads.
    # cv2.waitKey(1) after each call pumps the HighGUI message loop on Windows —
    # without it, resizeWindow/moveWindow can be dropped for some windows when
    # all 6 are created back-to-back, leaving them at the default size.
    for i, unit in enumerate(UNITS):
        row = i // GRID_COLS
        col = i % GRID_COLS
        x   = col * (DISPLAY_W + WINDOW_GAP)
        y   = row * (DISPLAY_H + WINDOW_GAP)
        cv2.namedWindow(unit, cv2.WINDOW_NORMAL)
        cv2.waitKey(1)
        cv2.resizeWindow(unit, DISPLAY_W, DISPLAY_H)
        cv2.waitKey(1)
        cv2.moveWindow(unit, x, y)
        cv2.waitKey(1)

    # Start session manager (polls AppSessions + handles timers)
    session_manager.start()
    mode_manager.start()

    # Start one worker thread per plant
    threads = []
    for unit in UNITS:
        t = threading.Thread(
            target=_plant_worker,
            args=(unit, model, shape_model, stop_event, frame_queues[unit], unit_configs, args.max_seconds),
            name=f"worker-{unit}",
            daemon=True,
        )
        t.start()
        threads.append(t)

    # Clear any stale signal left over from an unclean previous shutdown.
    try:
        STOP_SIGNAL_FILE.unlink(missing_ok=True)
    except Exception:
        pass

    print("All 6 workers started. Press ESC in any window to stop.\n")

    def _reposition_windows() -> None:
        """Re-apply grid positions and sizes — called after first frames arrive."""
        for i, unit in enumerate(UNITS):
            row = i // GRID_COLS
            col = i % GRID_COLS
            x   = col * (DISPLAY_W + WINDOW_GAP)
            y   = row * (DISPLAY_H + WINDOW_GAP)
            cv2.resizeWindow(unit, DISPLAY_W, DISPLAY_H)
            cv2.moveWindow(unit, x, y)
            cv2.waitKey(1)

    _repositioned   = False
    _frames_seen    = 0             # count total frames shown; reposition after first batch

    try:
        # Main display loop — must run on main thread (Windows cv2 requirement)
        while not stop_event.is_set():
            for unit in UNITS:
                try:
                    frame = frame_queues[unit].get_nowait()
                    cv2.imshow(unit, frame)
                    _frames_seen += 1
                except queue.Empty:
                    pass

            # Reposition once after all 6 windows have received at least one frame
            if not _repositioned and _frames_seen >= len(UNITS):
                _reposition_windows()
                _repositioned = True

            key = cv2.waitKey(1) & 0xFF
            if key == 27:   # ESC
                print("\nESC pressed — stopping all plants...")
                stop_event.set()
                break

            if STOP_SIGNAL_FILE.exists():
                print("\nStop signal received — stopping all plants...")
                stop_event.set()
                break

            # Exit cleanly if all workers finished naturally (e.g. all videos done)
            if all(not t.is_alive() for t in threads):
                break
    finally:
        # Always end active sessions with an accurate timestamp before exiting —
        # covers ESC, the stop-signal file, natural worker exit, and Ctrl+C.
        stop_event.set()
        session_manager.end_all_active_sessions()
        mode_manager.end_all_active_modes()
        session_manager.stop()
        for t in threads:
            t.join(timeout=5)
        cv2.destroyAllWindows()
        _push_pool.shutdown(wait=False)
        try:
            STOP_SIGNAL_FILE.unlink(missing_ok=True)
        except Exception:
            pass
        print("\nAll done.")


if __name__ == "__main__":
    import sys
    import traceback

    # ── File logging — survives terminal close ─────────────────────────────
    _log_dir = Path(__file__).resolve().parent / "logs"
    _log_dir.mkdir(exist_ok=True)
    _log_path = _log_dir / f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

    class _Tee:
        """Write to both the real stdout/stderr and a log file simultaneously."""
        def __init__(self, real, f):
            self._real = real
            self._f    = f
        def write(self, msg):
            self._real.write(msg)
            self._f.write(msg)
            self._f.flush()
        def flush(self):
            self._real.flush()
            self._f.flush()
        def __getattr__(self, name):
            return getattr(self._real, name)

    _log_f      = open(_log_path, "w", encoding="utf-8")
    sys.stdout  = _Tee(sys.__stdout__, _log_f)
    sys.stderr  = _Tee(sys.__stderr__, _log_f)

    print(f"[log] Writing to {_log_path}")
    try:
        main()
    except Exception:
        traceback.print_exc()
    finally:
        print("[log] Process exited.")
        _log_f.close()
