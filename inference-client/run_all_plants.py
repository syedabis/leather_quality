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

from app.db.frame_processor import FrameProcessor

# ── GPU / device ───────────────────────────────────────────────────────────
DEVICE   = "cuda:0" if torch.cuda.is_available() else "cpu"
_gpu_lock = threading.Lock()   # serialize GPU calls — CUDA predict is not thread-safe

# ── Paths ──────────────────────────────────────────────────────────────────
BASE        = Path(__file__).parent
MODEL       = BASE / "yolov8s_seg_best.pt"
VIDEOS_DIR  = BASE / "videos"
CFG_FILE    = BASE / "unit_configs.json"

# ── Inference config ───────────────────────────────────────────────────────
TARGET_FPS       = 5
CONF             = 0.15
IDLE_TIMEOUT_SEC        = 30   # default — overridden at startup from DB SystemSettings
DOWNTIME_THRESHOLD_SEC  = 300  # default — overridden at startup from DB SystemSettings

# ── Display config — calculated dynamically from screen resolution ─────────
GRID_COLS  = 3
GRID_ROWS  = 2
WINDOW_GAP = 4
DISPLAY_W  = 640   # overridden at startup by _calc_window_size()
DISPLAY_H  = 360   # overridden at startup by _calc_window_size()


def _get_screen_size() -> tuple[int, int]:
    """Return physical screen width/height in pixels, DPI-aware."""
    try:
        user32 = ctypes.windll.user32
        user32.SetProcessDPIAware()
        return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
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
    defaults = {"idle_timeout_sec": 30}
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT setting_key, setting_value FROM dbo.SystemSettings")
            rows = cur.fetchall()
            if rows:
                return {r[0]: r[1] for r in rows}
    except Exception as e:
        print(f"[settings] Could not read from DB, using defaults: {e}")
    return defaults


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


# ── Tracker & counter (per-plant instances) ────────────────────────────────

class SimpleIoUTracker:
    def __init__(self, iou_thresh: float = 0.25, max_age: int = 5):
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
    stop_event: threading.Event,
    frame_queue: queue.Queue,
    unit_configs: dict,
    max_seconds: Optional[float],
) -> None:
    db_unit  = UNIT_MAP.get(unit, unit)
    cfg_src  = _get_unit_source(unit_configs, unit)
    sources  = _resolve_sources(cfg_src) if cfg_src else sorted((VIDEOS_DIR / unit).glob("*.mp4")) if (VIDEOS_DIR / unit).is_dir() else []

    if not sources:
        print(f"[{unit}] No source found — worker exiting.")
        return

    tracker  = SimpleIoUTracker()
    counter  = RoiCounter()

    total_count         = 0
    last_detection_time = time.time()
    belt_active         = True
    prev_belt_active    = True
    new_idle_session    = 0
    frames_pushed       = 0

    src_index = 0

    while not stop_event.is_set() and src_index < len(sources):
        source   = sources[src_index]
        is_stream = isinstance(source, str) and _is_stream_url(str(source))
        cap      = cv2.VideoCapture(str(source))

        if not cap.isOpened():
            print(f"[{unit}] Could not open source: {source}")
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

        print(f"[{unit}] Starting: {Path(str(source)).name if not is_stream else str(source)}")

        while not stop_event.is_set():
            ret, frame = cap.read()
            if not ret:
                break

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
                results = model.predict(frame, conf=CONF, iou=0.7, device=DEVICE, verbose=False, show=False)
            result     = results[0]
            boxes_xyxy = result.boxes.xyxy.cpu().numpy().tolist() if result.boxes is not None and len(result.boxes) > 0 else []

            # ── Tracking ───────────────────────────────────────────────────
            track_results    = tracker.update(boxes_xyxy)
            debug_tracks: list[dict] = []
            roi_ids: list[int] = []
            for tid, box in track_results:
                cx, cy = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0
                in_roi = _in_roi(cx, cy, roi)
                debug_tracks.append({"tid": tid, "cx": cx, "cy": cy, "in_roi": in_roi})
                if in_roi:
                    roi_ids.append(tid)
            counted_ids_now = counter.update(roi_ids)

            count       = len(result.boxes) if result.boxes is not None else 0
            piece_delta = len(counted_ids_now)
            total_count += piece_delta

            # ── Belt idle / active state ───────────────────────────────────
            time_since_new = time.time() - last_detection_time
            if len(roi_ids) > 0:
                last_detection_time = time.time()
                belt_active         = True
                dynamic_frame_skip  = frame_skip
            elif time_since_new > IDLE_TIMEOUT_SEC:
                belt_active        = False
                dynamic_frame_skip = frame_skip * 2
            else:
                belt_active        = True
                dynamic_frame_skip = frame_skip

            if prev_belt_active and not belt_active:
                new_idle_session = 1
            if not prev_belt_active and belt_active:
                tracker.reset()
            prev_belt_active = belt_active

            utilization_pct = 0.0
            if result.boxes is not None and len(result.boxes) > 0 and result.boxes.conf is not None:
                utilization_pct = float(result.boxes.conf.mean().cpu().numpy()) * 100

            # ── DB write ───────────────────────────────────────────────────
            FrameProcessor.process_frame(
                source_note          = db_unit,
                total_count          = total_count,
                belt_active          = belt_active,
                utilization_pct      = utilization_pct,
                piece_delta          = piece_delta,
                frame_time_delta_s   = frame_time_delta,
                idle_sessions_delta  = new_idle_session,
            )
            new_idle_session = 0

            # ── Render display frame ───────────────────────────────────────
            annotated = result.plot(boxes=False)
            h, w      = annotated.shape[:2]
            scale     = min(DISPLAY_W / w, DISPLAY_H / h)
            new_w, new_h = int(w * scale), int(h * scale)
            resized   = cv2.resize(annotated, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

            display   = np.zeros((DISPLAY_H, DISPLAY_W, 3), dtype=np.uint8)
            x_off     = (DISPLAY_W - new_w) // 2
            y_off     = (DISPLAY_H - new_h) // 2
            display[y_off:y_off + new_h, x_off:x_off + new_w] = resized

            sx, sy = scale, scale

            # ROI overlay
            rx1 = int(roi["x"] * sx) + x_off;  ry1 = int(roi["y"] * sy) + y_off
            rx2 = int((roi["x"] + roi["w"]) * sx) + x_off
            ry2 = int((roi["y"] + roi["h"]) * sy) + y_off
            overlay = display.copy()
            cv2.rectangle(overlay, (rx1, ry1), (rx2, ry2), (0, 255, 0), -1)
            cv2.addWeighted(overlay, 0.08, display, 0.92, 0, display)
            cv2.rectangle(display, (rx1, ry1), (rx2, ry2), (0, 255, 0), 2)

            # Header text
            _f, _fs, _ft, _pad, _ty = cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1, 4, 20
            _dt = time.strftime("%d-%m-%Y  %H:%M:%S")
            (dtw, dth), _ = cv2.getTextSize(_dt, _f, _fs, _ft)
            cv2.rectangle(display, (6 - _pad, _ty - dth - _pad), (6 + dtw + _pad, _ty + _pad), (0, 0, 0), -1)
            cv2.putText(display, _dt, (6, _ty), _f, _fs, (255, 255, 255), _ft)

            _st_str   = "Active" if belt_active else "Downtime"
            _st_color = (0, 255, 0) if belt_active else (0, 0, 255)
            _seg_u = f"{unit} ";  _seg_s = f"({_st_str})";  _seg_c = f"  Count:{counter.total}"
            (uw, _), _ = cv2.getTextSize(_seg_u, _f, _fs, _ft)
            (sw, _), _ = cv2.getTextSize(_seg_s, _f, _fs, _ft)
            (cw, _), _ = cv2.getTextSize(_seg_c, _f, _fs, _ft)
            _rx = DISPLAY_W - uw - sw - cw - 8
            cv2.rectangle(display, (_rx - _pad, _ty - dth - _pad), (DISPLAY_W - 8 + _pad, _ty + _pad), (0, 0, 0), -1)
            cv2.putText(display, _seg_c, (DISPLAY_W - cw - 8, _ty),     _f, _fs, (255, 255, 255), _ft)
            cv2.putText(display, _seg_s, (DISPLAY_W - cw - sw - 8, _ty), _f, _fs, _st_color,        _ft)
            cv2.putText(display, _seg_u, (_rx, _ty),                     _f, _fs, (255, 255, 255),  _ft)

            # Track dots
            for track in debug_tracks:
                tid, in_roi_flag = track["tid"], track["in_roi"]
                dcx = int(track["cx"] * sx) + x_off
                dcy = int(track["cy"] * sy) + y_off
                counted_now = tid in counted_ids_now
                counted     = tid in counter.counted_ids
                dot_color   = (255, 255, 0) if counted_now else ((0, 255, 0) if in_roi_flag else (0, 165, 255))
                cv2.circle(display, (dcx, dcy), 4, dot_color, -1)
                cv2.circle(display, (dcx, dcy), 6, dot_color, 2)

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
                print(f"[{unit}] Stream disconnected, reconnecting in 2s...")
                time.sleep(2)
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

    # Load settings from DB (idle timeout etc.)
    global IDLE_TIMEOUT_SEC, DOWNTIME_THRESHOLD_SEC, DISPLAY_W, DISPLAY_H
    settings = _load_settings()
    IDLE_TIMEOUT_SEC       = int(settings.get("idle_timeout_sec",       30))
    DOWNTIME_THRESHOLD_SEC = int(settings.get("downtime_threshold_sec", 300))
    print(f"[settings] Idle timeout: {IDLE_TIMEOUT_SEC}s | Downtime threshold: {DOWNTIME_THRESHOLD_SEC}s")

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
    print(f"[model] Loaded. Running 6 plants at target {TARGET_FPS} FPS each.\n")

    unit_configs = _load_unit_configs()
    stop_event   = threading.Event()

    # Per-plant frame queues (maxsize=2 keeps display lag minimal)
    frame_queues: dict[str, queue.Queue] = {u: queue.Queue(maxsize=2) for u in UNITS}

    # Create and position all 6 windows before starting threads
    for i, unit in enumerate(UNITS):
        row = i // GRID_COLS
        col = i % GRID_COLS
        x   = col * (DISPLAY_W + WINDOW_GAP)
        y   = row * (DISPLAY_H + WINDOW_GAP)
        cv2.namedWindow(unit, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(unit, DISPLAY_W, DISPLAY_H)
        cv2.moveWindow(unit, x, y)

    # Start one worker thread per plant
    threads = []
    for unit in UNITS:
        t = threading.Thread(
            target=_plant_worker,
            args=(unit, model, stop_event, frame_queues[unit], unit_configs, args.max_seconds),
            name=f"worker-{unit}",
            daemon=True,
        )
        t.start()
        threads.append(t)

    print("All 6 workers started. Press ESC in any window to stop.\n")

    # Main display loop — must run on main thread (Windows cv2 requirement)
    while not stop_event.is_set():
        for unit in UNITS:
            try:
                frame = frame_queues[unit].get_nowait()
                cv2.imshow(unit, frame)
            except queue.Empty:
                pass

        key = cv2.waitKey(1) & 0xFF
        if key == 27:   # ESC
            print("\nESC pressed — stopping all plants...")
            stop_event.set()
            break

        # Exit cleanly if all workers finished naturally (e.g. all videos done)
        if all(not t.is_alive() for t in threads):
            break

    stop_event.set()
    for t in threads:
        t.join(timeout=5)
    cv2.destroyAllWindows()
    _push_pool.shutdown(wait=False)
    print("\nAll done.")


if __name__ == "__main__":
    main()
