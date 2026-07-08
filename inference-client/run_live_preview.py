"""
run_live_preview.py — Spray Plant Inference Client

Runs YOLO inference on a camera stream or local video and writes
frame-level metrics directly to SQL Server.

Single-unit mode:
    python run_live_preview.py --unit SP-01

Multi-unit batch mode:
    python run_live_preview.py --all
    python run_live_preview.py --all --max-seconds 60

Controls while a video plays:
  Q   — skip the current video / stream
  ESC — abort the entire run

Configuration:
  unit_configs.json  — set the camera source (RTSP URL or file path) per unit
  .env               — set DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import requests
import torch
from ultralytics import YOLO

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}


def _is_image(path) -> bool:
    return Path(str(path)).suffix.lower() in IMAGE_EXTS

# ── GPU / device selection ─────────────────────────────────────────────────
# GTX 960 (Maxwell SM 5.2) is supported by CUDA 11.8 + PyTorch cu118.
# Install GPU torch first:
#   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"

# ── Paths ──────────────────────────────────────────────────────────────────
BASE        = Path(__file__).parent
MODEL       = BASE / "yolov8s_seg_best.pt"
VIDEOS_DIR  = BASE / "videos2"          # fallback local video files (optional)
CFG_FILE    = BASE / "unit_configs.json"
TRACKER_CFG = BASE / "bytetrack_conveyor.yaml"
OUT_DIR     = BASE / "results"
OUT_FILE    = OUT_DIR / "spray_plant_results.json"
REC_DIR     = BASE / "recordings"

TARGET_FPS          = 5        # target inference rate; frames between this and video FPS are skipped
REC_FPS             = 10.0
CONF                = 0.70     # default confidence — matches run_all_plants.py production default
DISPLAY_W           = 1280
DISPLAY_H           = 720
WINDOW_NAME         = "Leather Detection"
SKIP_START_SECONDS  = 0        # set > 0 to skip the first N seconds (useful for testing)
IDLE_TIMEOUT_SEC    = 30       # seconds of no new pieces before belt is marked idle

UNITS = ["SP-01", "SP-02", "SP-03", "SP-04", "SP-05", "SP-06"]

UNIT_MAP = {
    "SP-01": "SP-01",
    "SP-02": "SP-02",
    "SP-03": "SP-03",
    "SP-04": "SP-04",
    "SP-05": "SP-05",
    "SP-06": "SP-06",
    "preview": "SP-01",
}

# ── Dashboard frame streaming ───────────────────────────────────────────────
# Set BACKEND_URL in .env to push annotated frames to the dashboard.
# Set to empty string to disable streaming (inference-only mode).
BACKEND_URL  = os.getenv("BACKEND_URL", "http://localhost:8001").rstrip("/")
THUMB_EVERY  = 5     # push every Nth processed frame (~1-2 FPS to dashboard)
THUMB_QUALITY = 55   # JPEG quality 0-100 — lower = smaller, faster network transfer

_push_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="frame-push")


def _push_frame(plant_id: str, frame_bgr) -> None:
    """Fire-and-forget: encode frame as JPEG and POST it to the backend."""
    if not BACKEND_URL:
        return
    ok, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, THUMB_QUALITY])
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
            pass  # never block inference on network issues

    _push_pool.submit(_post)


# ── Config loaders ─────────────────────────────────────────────────────────

def _load_unit_configs() -> dict:
    if not CFG_FILE.exists():
        return {}
    try:
        with open(CFG_FILE) as f:
            return json.load(f)
    except Exception as exc:
        print(f"[warn] Could not load {CFG_FILE.name}: {exc}")
        return {}


def _get_unit_cfg(configs: dict, unit: str, frame_w: int, frame_h: int) -> tuple[dict, dict]:
    """Get ROI and line config, converting from normalized (0.0-1.0) to pixel coordinates."""
    entry = configs.get(unit, {})
    roi_norm  = entry.get("roi",  {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0})
    line_norm = entry.get("line", {"start": [0.5, 0.0], "end": [0.5, 1.0]})
    
    # Convert normalized coordinates (0.0-1.0) to pixel coordinates
    roi = {
        "x": int(roi_norm["x"] * frame_w),
        "y": int(roi_norm["y"] * frame_h),
        "w": int(roi_norm["w"] * frame_w),
        "h": int(roi_norm["h"] * frame_h),
    }
    line = {
        "start": [int(line_norm["start"][0] * frame_w), int(line_norm["start"][1] * frame_h)],
        "end": [int(line_norm["end"][0] * frame_w), int(line_norm["end"][1] * frame_h)],
    }
    return roi, line


def _get_unit_source(configs: dict, unit: str) -> Optional[str]:
    entry = configs.get(unit, {}) or {}
    src   = entry.get("source")
    if not src:
        return None
    src = str(src).strip()
    return src or None



def _is_stream_url(source: str) -> bool:
    s = source.lower()
    return s.startswith(("rtsp://", "rtsps://", "http://", "https://", "udp://", "tcp://"))


def _resolve_sources(source: str) -> list:
    """Resolve a source string to a list of usable video inputs.

    - Stream URL  → [url]            (passed straight to cv2/YOLO)
    - Directory   → [sorted mp4s]    (play every *.mp4 in the folder)
    - File path   → [path]
    - Anything else → []
    """
    if _is_stream_url(source):
        return [source]
    p = Path(source)
    if p.is_dir():
        videos = sorted(p.glob("*.mp4"))
        images = sorted(f for ext in IMAGE_EXTS for f in p.glob(f"*{ext}"))
        sources = sorted(set(videos + images), key=lambda x: x.name)
        if not sources:
            print(f"  [warn] Directory has no .mp4 or image files: {p}")
        return sources
    if p.is_file():
        return [p]
    print(f"  [warn] Source not found: {source}")
    return []


def _get_unit_conf(configs: dict, unit: str) -> float:
    """Per-unit YOLO confidence threshold — matches run_all_plants.py logic."""
    val = (configs.get(unit) or {}).get("confidence")
    try:
        return float(val) if val is not None else CONF
    except (TypeError, ValueError):
        return CONF


def _in_roi(cx: float, cy: float, roi: dict) -> bool:
    return (roi["x"] <= cx <= roi["x"] + roi["w"] and
            roi["y"] <= cy <= roi["y"] + roi["h"])


# ── Data classes ───────────────────────────────────────────────────────────

@dataclass
class VideoStats:
    unit: str
    filename: str
    total_frames: int = 0
    frames_processed: int = 0
    frames_with_detections: int = 0
    total_detections: int = 0
    max_in_frame: int = 0
    min_in_frame: int = 0
    avg_per_frame: float = 0.0
    detection_rate_pct: float = 0.0
    avg_inference_ms: float = 0.0
    avg_fps: float = 0.0
    duration_s: float = 0.0
    items_counted: int = 0
    skipped: bool = False
    skip_reason: str = ""


@dataclass
class UnitStats:
    unit: str
    videos_processed: int = 0
    total_frames_processed: int = 0
    total_detections: int = 0
    avg_per_frame: float = 0.0
    detection_rate_pct: float = 0.0
    avg_inference_ms: float = 0.0


@dataclass
class RunSummary:
    run_timestamp: str = ""
    model: str = ""
    confidence: float = 0.0
    frame_skip: int = 0
    total_videos: int = 0
    total_frames_processed: int = 0
    total_detections: int = 0
    overall_avg_per_frame: float = 0.0
    overall_detection_rate_pct: float = 0.0
    overall_avg_inference_ms: float = 0.0
    videos: list[VideoStats] = field(default_factory=list)
    units: list[UnitStats] = field(default_factory=list)


# ── Simple IoU tracker (replaces ByteTrack) ────────────────────────────────
#
# ByteTrack's Hungarian algorithm absorbs new detections into existing or
# "lost" tracks when there is any IoU overlap, preventing new IDs from being
# assigned while old tracks are alive. This simple greedy tracker guarantees
# a fresh ID for every detection that doesn't spatially overlap with an
# already-active track.

class SimpleIoUTracker:
    def __init__(self, iou_thresh: float = 0.25, max_age: int = 20):
        self.iou_thresh = iou_thresh  # min IoU to link a detection to an existing track
        self.max_age    = max_age     # frames before an unmatched track is deleted
        self._next_id   = 1
        self._tracks: dict[int, dict] = {}  # id → {"box": [x1,y1,x2,y2], "age": int}

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
        """
        Match detections to existing tracks (greedy, highest IoU first).
        Unmatched detections always get a new ID immediately.

        Returns list of (track_id, [x1, y1, x2, y2]) for every detection.
        """
        matched_tids: set[int] = set()
        det_to_tid: dict[int, int] = {}

        # Greedy match: for each detection find best overlapping track
        for di, box in enumerate(boxes):
            best_iou = self.iou_thresh
            best_tid = None
            for tid, trk in self._tracks.items():
                if tid in matched_tids:
                    continue
                iou = self._iou(box, trk["box"])
                if iou > best_iou:
                    best_iou = iou
                    best_tid = tid
            if best_tid is not None:
                det_to_tid[di]  = best_tid
                matched_tids.add(best_tid)

        # Update matched tracks
        for di, tid in det_to_tid.items():
            self._tracks[tid]["box"] = boxes[di]
            self._tracks[tid]["age"] = 0

        # New tracks for every unmatched detection
        for di, box in enumerate(boxes):
            if di not in det_to_tid:
                tid = self._next_id
                self._next_id += 1
                self._tracks[tid] = {"box": box, "age": 0}
                det_to_tid[di]    = tid

        # Age unmatched tracks; remove expired ones
        for tid in list(self._tracks):
            if tid not in matched_tids:
                self._tracks[tid]["age"] += 1
                if self._tracks[tid]["age"] >= self.max_age:
                    del self._tracks[tid]

        return [(det_to_tid[i], boxes[i]) for i in range(len(boxes))]


# ── ROI presence counter ───────────────────────────────────────────────────

class RoiCounter:
    def __init__(self):
        self.counted_ids: set[int] = set()

    def update(self, track_ids) -> set[int]:
        if track_ids is None or len(track_ids) == 0:
            return set()
        counted_now: set[int] = set()
        for tid in track_ids:
            tid = int(tid)
            if tid not in self.counted_ids:
                self.counted_ids.add(tid)
                counted_now.add(tid)
        return counted_now

    @property
    def total(self) -> int:
        return len(self.counted_ids)


def _suppress_overlapping_tracks(
    track_results: list[tuple[int, list]],
    iou_threshold: float = 0.60,
    iomin_threshold: float = 0.80,
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


# ── Core inference loop ────────────────────────────────────────────────────

def _reset_track_state(model: YOLO) -> None:
    predictor = getattr(model, "predictor", None)
    if predictor is None:
        return
    for attr in ("trackers", "vid_path", "_feats", "tracker", "frame_count"):
        if hasattr(predictor, attr):
            delattr(predictor, attr)
    if hasattr(model, "tracker"):
        delattr(model, "tracker")
    hook = getattr(predictor, "_hook", None)
    if hook is not None:
        hook.remove()
        delattr(predictor, "_hook")


def run_video(model: YOLO, video_source, unit: str,
              max_seconds: Optional[float] = None,
              record: bool = False,
              unit_configs: Optional[dict] = None,
              display_name: Optional[str] = None,
              writer: Optional["cv2.VideoWriter"] = None,
              rec_path_override: Optional[Path] = None) -> tuple[VideoStats, bool, bool]:

    is_stream = isinstance(video_source, str) and _is_stream_url(video_source)
    cap_arg   = video_source if is_stream else str(video_source)
    name      = display_name or (f"{unit}-stream" if is_stream else Path(str(video_source)).name)

    stats = VideoStats(unit=unit, filename=name)

    cap = cv2.VideoCapture(cap_arg)
    if not cap.isOpened():
        stats.skipped    = True
        stats.skip_reason = f"cv2 could not open source: {cap_arg}"
        return stats, False, False

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    video_fps    = cap.get(cv2.CAP_PROP_FPS) or 20.0
    duration_s   = (total_frames / video_fps) if total_frames > 0 else 0.0
    max_frames   = (int(max_seconds * video_fps) if max_seconds else total_frames) if total_frames > 0 else (int(max_seconds * video_fps) if max_seconds else 10**12)
    frame_w      = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h      = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    stats.total_frames = total_frames
    stats.duration_s   = round(duration_s, 2)

    # How many source frames to skip between each processed frame so that
    # inference keeps up with real time.  E.g. 25 FPS source / 5 TARGET_FPS = skip 5.
    frame_skip = max(1, round(video_fps / TARGET_FPS))

    configs   = unit_configs or {}
    roi, _line = _get_unit_cfg(configs, unit, frame_w, frame_h)
    unit_conf  = _get_unit_conf(configs, unit)

    # ─────────────────────────────────────────────────────────────────────────

    counter           = RoiCounter()
    tracker           = SimpleIoUTracker(iou_thresh=0.25, max_age=20)
    sx, sy            = DISPLAY_W / frame_w, DISPLAY_H / frame_h

    # If the caller passed a writer, this video appends to that shared
    # (session-wide) recording and must NOT release it here. Only create —
    # and own — a per-video writer when no shared writer was supplied.
    own_writer = False
    rec_path   = None
    if record and writer is None:
        REC_DIR.mkdir(parents=True, exist_ok=True)
        rec_path  = rec_path_override or (REC_DIR / f"{unit}.mp4")
        writer    = cv2.VideoWriter(str(rec_path), cv2.VideoWriter_fourcc(*"mp4v"), REC_FPS, (DISPLAY_W, DISPLAY_H))
        own_writer = True
        print(f"  Recording → {rec_path.name}")

    inference_times: list[float] = []
    detection_counts: list[int]  = []
    frame_num           = 0
    aborted             = False
    go_back             = False
    db_unit             = UNIT_MAP.get(unit, unit)
    total_count         = 0
    last_detection_time = time.time()
    belt_active         = True
    prev_belt_active    = True
    dynamic_frame_skip  = frame_skip
    idle_started        = None
    new_idle_session    = 0
    last_frame_time     = time.time()
    skip_start_frames   = int(SKIP_START_SECONDS * video_fps)
    proc_frame          = 0                      # processed-frame counter for eviction
    last_roi_frame: dict[int, int] = {}          # tid → proc_frame when last seen IN roi

    if SKIP_START_SECONDS > 0:
        print(f"  Skipping first {SKIP_START_SECONDS}s ({skip_start_frames} frames)")

    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(WINDOW_NAME, cv2.WND_PROP_TOPMOST, 1)  # bring to front
    print(f"  [keys] Click on the video window, then: Q=next  W=back  ESC=quit")
    print(f"\n{'─'*60}")
    print(f"  {unit}  |  {name}{'  [LIVE STREAM]' if is_stream else ''}")
    if total_frames > 0:
        print(f"  {total_frames} frames  |  {video_fps:.1f} fps  |  {duration_s:.1f}s")
    else:
        print(f"  Live stream  |  {video_fps:.1f} fps")
    print(f"{'─'*60}")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_num += 1

        if frame_num < skip_start_frames:
            continue
        elif frame_num == skip_start_frames:
            last_frame_time = time.time()
            continue

        if frame_num > max_frames:
            print(f"  → {max_seconds}s cap reached.")
            break
        if frame_num % dynamic_frame_skip != 0:
            continue

        now              = time.time()
        frame_time_delta = now - last_frame_time
        last_frame_time  = now

        results    = model.predict(frame, conf=unit_conf, iou=0.45, device=DEVICE, verbose=False, show=False)
        result     = results[0]
        boxes_xyxy = result.boxes.xyxy.cpu().numpy().tolist() if result.boxes is not None and len(result.boxes) > 0 else []
        confs_list = result.boxes.conf.cpu().numpy().tolist() if result.boxes is not None and len(result.boxes) > 0 else []
        _box_to_conf = {tuple(int(v) for v in b): c for b, c in zip(boxes_xyxy, confs_list)}

        track_results   = _suppress_overlapping_tracks(tracker.update(boxes_xyxy))   # [(tid, box), ...]
        debug_tracks: list[dict] = []
        counted_ids_now: set[int] = set()
        roi_ids: list[int] = []
        for tid, box in track_results:
            cx, cy = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0
            in_roi = _in_roi(cx, cy, roi)
            conf   = _box_to_conf.get(tuple(int(v) for v in box), None)
            debug_tracks.append({"tid": tid, "cx": cx, "cy": cy, "in_roi": in_roi, "conf": conf})
            if in_roi:
                roi_ids.append(tid)
        counted_ids_now = counter.update(roi_ids)

        proc_frame += 1
        for _tid in roi_ids:
            last_roi_frame[_tid] = proc_frame

        # Evict a counted ghost track using two triggers:
        #  1. Detected OUTSIDE the ROI → evict immediately (piece has moved on, fast path)
        #  2. Not detected anywhere for 5 processed frames (~1 s at 5 FPS) → fallback eviction
        #     for pieces that exit the ROI without ever being detected outside.
        all_visible_ids = {tid for tid, _ in track_results}
        roi_set = set(roi_ids)
        for _tid in list(counter.counted_ids):
            if _tid not in roi_set and _tid in tracker._tracks:
                if _tid in all_visible_ids:
                    del tracker._tracks[_tid]
                elif proc_frame - last_roi_frame.get(_tid, 0) >= 5:
                    del tracker._tracks[_tid]

        stats.items_counted = counter.total
        count               = len(result.boxes) if result.boxes is not None else 0
        piece_delta         = len(counted_ids_now)
        total_count        += piece_delta

        # Status follows ROI presence (any tracked object in ROI, new or not).
        # Detections outside the ROI never flip the status.
        if len(roi_ids) > 0:
            last_detection_time = time.time()
            belt_active         = True
            dynamic_frame_skip  = frame_skip
        elif time.time() - last_detection_time > IDLE_TIMEOUT_SEC:
            belt_active        = False
            dynamic_frame_skip = frame_skip * 2   # half the rate during idle
            if not idle_started:
                idle_started = time.time()
        else:
            # Hold last status during the short grace window.
            dynamic_frame_skip = frame_skip

        if prev_belt_active and not belt_active:
            new_idle_session = 1
        # When belt comes back active after idle, flush stale tracker state so
        # ghost tracks from the previous batch cannot absorb new detections.
        if not prev_belt_active and belt_active:
            tracker.reset()
            idle_started = None
        prev_belt_active = belt_active

        utilization_pct = 0.0
        if result.boxes is not None and len(result.boxes) > 0:
            confs = result.boxes.conf
            if confs is not None and len(confs) > 0:
                utilization_pct = float(confs.mean().cpu().numpy()) * 100

        # Mirror run_all_plants.py: skip writes entirely on a holiday or
        # weekly off-day; otherwise status is always real, and idle time /
        # sessions only accumulate inside shift hours AND outside the break
        # window.
        new_idle_session = 0

        detection_counts.append(count)
        inference_times.append(result.speed["inference"])
        if count > 0:
            stats.frames_with_detections += 1

        # ── Display ──────────────────────────────────────────────────────
        annotated  = result.plot(boxes=False)
        
        # ── Fit video to display size while maintaining aspect ratio ──
        h, w = annotated.shape[:2]
        scale = min(DISPLAY_W / w, DISPLAY_H / h)  # scale to fit within display bounds
        new_w, new_h = int(w * scale), int(h * scale)
        resized = cv2.resize(annotated, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        
        # Create black canvas and center the resized frame
        display = np.zeros((DISPLAY_H, DISPLAY_W, 3), dtype=np.uint8)
        x_offset = (DISPLAY_W - new_w) // 2
        y_offset = (DISPLAY_H - new_h) // 2
        display[y_offset:y_offset+new_h, x_offset:x_offset+new_w] = resized
        
        # Adjust scale factors for drawing on the fitted display
        sx, sy = scale, scale

        # ROI coordinates are already in frame pixels, just apply scale and offset
        rx1 = int(roi["x"] * sx) + x_offset
        ry1 = int(roi["y"] * sy) + y_offset
        rx2 = int((roi["x"] + roi["w"]) * sx) + x_offset
        ry2 = int((roi["y"] + roi["h"]) * sy) + y_offset
        overlay  = display.copy()
        cv2.rectangle(overlay, (rx1, ry1), (rx2, ry2), (0, 255, 0), -1)
        cv2.addWeighted(overlay, 0.08, display, 0.92, 0, display)
        cv2.rectangle(display, (rx1, ry1), (rx2, ry2), (0, 255, 0), 2)

        # ── Header overlays — text-only black backgrounds ─────────────────
        _f, _fs, _ft = cv2.FONT_HERSHEY_SIMPLEX, 0.65, 1
        _pad = 6
        _ty  = 27   # baseline y for both labels

        # Left: DD-MM-YYYY  HH:MM:SS  (white)
        _dt = time.strftime("%d-%m-%Y  %H:%M:%S")
        (dtw, dth), _ = cv2.getTextSize(_dt, _f, _fs, _ft)
        cv2.rectangle(display,
                      (10 - _pad, _ty - dth - _pad),
                      (10 + dtw + _pad, _ty + _pad),
                      (0, 0, 0), -1)
        cv2.putText(display, _dt, (10, _ty), _f, _fs, (255, 255, 255), _ft)

        # Right: "SP-XX " white | "(Active/Downtime)" green/red | "  Count: N" white
        _st_str   = "Active" if belt_active else "Downtime"
        _st_color = (0, 255, 0) if belt_active else (0, 0, 255)
        _seg_u = f"{unit} "
        _seg_s = f"({_st_str})"
        _seg_c = f"  Count: {counter.total}"
        (uw, _), _ = cv2.getTextSize(_seg_u, _f, _fs, _ft)
        (sw, _), _ = cv2.getTextSize(_seg_s, _f, _fs, _ft)
        (cw, _), _ = cv2.getTextSize(_seg_c, _f, _fs, _ft)
        _rx = DISPLAY_W - uw - sw - cw - 10
        cv2.rectangle(display,
                      (_rx - _pad, _ty - dth - _pad),
                      (DISPLAY_W - 10 + _pad, _ty + _pad),
                      (0, 0, 0), -1)
        _xc = DISPLAY_W - cw - 10
        _xs = _xc - sw
        _xu = _xs - uw
        cv2.putText(display, _seg_c, (_xc, _ty), _f, _fs, (255, 255, 255), _ft)
        cv2.putText(display, _seg_s, (_xs, _ty), _f, _fs, _st_color,        _ft)
        cv2.putText(display, _seg_u, (_xu, _ty), _f, _fs, (255, 255, 255),  _ft)

        # Dot color legend:
        #   Magenta (255,0,255) = detected + counted NOW  (first frame in ROI)
        #   Green   (0,255,0)   = detected + already counted (subsequent ROI frames)
        #   Orange  (0,165,255) = detected but outside ROI
        _COLOR_COUNTED_NOW = (255, 0, 255)   # Magenta
        _COLOR_COUNTED     = (0, 255, 0)     # Green
        _COLOR_OUT_OF_ROI  = (0, 165, 255)   # Orange

        for track in debug_tracks:
            tid, in_roi_flag = track["tid"], track["in_roi"]
            dcx = int(track["cx"] * sx) + x_offset
            dcy = int(track["cy"] * sy) + y_offset
            counted_now = tid in counted_ids_now
            counted     = tid in counter.counted_ids
            if counted_now:
                dot_color = _COLOR_COUNTED_NOW
                status    = "COUNTED NOW"
            elif in_roi_flag and counted:
                dot_color = _COLOR_COUNTED
                status    = "COUNTED"
            else:
                dot_color = _COLOR_OUT_OF_ROI
                status    = "OUT OF ROI"
            _conf   = track.get("conf")
            _conf_s = f"{_conf:.0%}" if _conf is not None else "?"
            cv2.circle(display, (dcx, dcy), 7, dot_color, -1)
            cv2.circle(display, (dcx, dcy), 11, dot_color, 2)
            dbg_text = f"ID{tid} {_conf_s} {status}"
            (dtw, dth), _ = cv2.getTextSize(dbg_text, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1)
            tx = max(8, min(dcx + 13, DISPLAY_W - dtw - 8))
            ty = max(dth + 8, min(dcy - 13, DISPLAY_H - 8))
            cv2.rectangle(display, (tx - 3, ty - dth - 3), (tx + dtw + 3, ty + 3), (0, 0, 0), -1)
            cv2.putText(display, dbg_text, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.48, dot_color, 1)

        # Legend — bottom-left corner
        _legend = [
            ((255, 0, 255), "Counted NOW"),
            ((0, 255, 0),   "Already counted"),
            ((0, 165, 255), "Out of ROI"),
        ]
        _lx, _ly = 10, DISPLAY_H - 14
        for _lc, _lt in reversed(_legend):
            (lw, lh), _ = cv2.getTextSize(_lt, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            cv2.rectangle(display, (_lx - 3, _ly - lh - 3), (_lx + 14 + lw + 3, _ly + 3), (0, 0, 0), -1)
            cv2.circle(display, (_lx + 5, _ly - lh // 2), 5, _lc, -1)
            cv2.putText(display, _lt, (_lx + 14, _ly), cv2.FONT_HERSHEY_SIMPLEX, 0.45, _lc, 1)
            _ly -= lh + 8


        cv2.imshow(WINDOW_NAME, display)
        if writer:
            writer.write(display)

        # Push annotated frame to backend dashboard (every THUMB_EVERY processed frames)
        if stats.frames_processed % THUMB_EVERY == 0:
            _push_frame(db_unit, display)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), ord("Q")):
            print("  → Next (Q).")
            break
        if key in (ord("w"), ord("W")):
            print("  → Back (W).")
            go_back = True
            break
        if key == 27 or key == 3:   # ESC or Ctrl+C
            print("  → Aborted by user (ESC).")
            aborted = True
            break
        # ──────────────────────────────────────────────────────────────────────

    cap.release()
    if own_writer and writer:
        writer.release()
        print(f"  Saved → {rec_path}")

    n = len(detection_counts)
    if n:
        stats.frames_processed   = n
        stats.total_detections   = sum(detection_counts)
        stats.max_in_frame       = max(detection_counts)
        stats.min_in_frame       = min(detection_counts)
        stats.avg_per_frame      = round(stats.total_detections / n, 2)
        stats.detection_rate_pct = round(100 * stats.frames_with_detections / n, 1)
        avg_ms                   = sum(inference_times) / n
        stats.avg_inference_ms   = round(avg_ms, 2)
        stats.avg_fps            = round(1000 / avg_ms, 1) if avg_ms else 0.0
    else:
        stats.skipped     = True
        stats.skip_reason = "no frames processed"

    _print_video_stats(stats)
    return stats, aborted, go_back


def _print_video_stats(s: VideoStats) -> None:
    if s.skipped:
        print(f"  SKIPPED: {s.skip_reason}")
        return
    print(f"  Frames processed : {s.frames_processed} / {s.total_frames}")
    print(f"  Detections       : {s.total_detections}  (avg {s.avg_per_frame}/frame)")
    print(f"  Items counted    : {s.items_counted}")
    print(f"  Detection rate   : {s.detection_rate_pct}%")
    print(f"  Inference speed  : {s.avg_fps} FPS  ({s.avg_inference_ms}ms/frame)")


def _aggregate_unit(unit: str, video_stats: list[VideoStats]) -> UnitStats:
    us    = UnitStats(unit=unit)
    valid = [v for v in video_stats if not v.skipped and v.frames_processed > 0]
    us.videos_processed       = len(valid)
    us.total_frames_processed = sum(v.frames_processed for v in valid)
    us.total_detections       = sum(v.total_detections for v in valid)
    if us.total_frames_processed:
        us.avg_per_frame      = round(us.total_detections / us.total_frames_processed, 2)
        us.detection_rate_pct = round(100 * sum(v.frames_with_detections for v in valid) / us.total_frames_processed, 1)
    if valid:
        us.avg_inference_ms   = round(sum(v.avg_inference_ms for v in valid) / len(valid), 2)
    return us


# ── Image inference ────────────────────────────────────────────────────────

def run_image(model: YOLO, image_path, unit: str,
              unit_configs: Optional[dict] = None) -> tuple[VideoStats, bool, bool]:
    """Run inference on a single image. SPACE/Q=next  W=back  ESC=quit."""
    name   = Path(str(image_path)).name
    stats  = VideoStats(unit=unit, filename=name)
    frame  = cv2.imread(str(image_path))
    if frame is None:
        stats.skipped     = True
        stats.skip_reason = f"Could not read image: {image_path}"
        return stats, False, False

    frame_h, frame_w = frame.shape[:2]
    configs           = unit_configs or {}
    roi, _            = _get_unit_cfg(configs, unit, frame_w, frame_h)

    t0      = time.time()
    results = model.predict(frame, conf=CONF, iou=0.45, device=DEVICE, verbose=False, show=False)
    result  = results[0]
    inf_ms  = result.speed.get("inference", (time.time() - t0) * 1000)

    boxes_xyxy   = result.boxes.xyxy.cpu().numpy().tolist() if result.boxes is not None and len(result.boxes) > 0 else []
    confs_list   = result.boxes.conf.cpu().numpy().tolist() if result.boxes is not None and len(result.boxes) > 0 else []
    _box_to_conf = {tuple(int(v) for v in b): c for b, c in zip(boxes_xyxy, confs_list)}
    tracker      = SimpleIoUTracker(iou_thresh=0.25, max_age=20)
    counter      = RoiCounter()
    track_results = _suppress_overlapping_tracks(tracker.update(boxes_xyxy))

    debug_tracks: list[dict] = []
    roi_ids: list[int] = []
    for tid, box in track_results:
        cx, cy = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0
        in_roi = _in_roi(cx, cy, roi)
        conf   = _box_to_conf.get(tuple(int(v) for v in box), None)
        debug_tracks.append({"tid": tid, "cx": cx, "cy": cy, "in_roi": in_roi, "conf": conf})
        if in_roi:
            roi_ids.append(tid)
    counted_ids_now = counter.update(roi_ids)

    # Evict counted tracks that have left the ROI to prevent ghost-ID reuse
    _roi_set = set(roi_ids)
    for _tid in list(counter.counted_ids):
        if _tid not in _roi_set and _tid in tracker._tracks:
            del tracker._tracks[_tid]

    count           = len(result.boxes) if result.boxes is not None else 0

    # ── Build display ─────────────────────────────────────────────────────
    annotated = result.plot(boxes=False)
    h, w      = annotated.shape[:2]
    scale     = min(DISPLAY_W / w, DISPLAY_H / h)
    new_w, new_h = int(w * scale), int(h * scale)
    resized   = cv2.resize(annotated, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    display   = np.zeros((DISPLAY_H, DISPLAY_W, 3), dtype=np.uint8)
    x_off     = (DISPLAY_W - new_w) // 2
    y_off     = (DISPLAY_H - new_h) // 2
    display[y_off:y_off + new_h, x_off:x_off + new_w] = resized
    sx        = scale

    # ROI overlay
    rx1 = int(roi["x"] * sx) + x_off;  ry1 = int(roi["y"] * sx) + y_off
    rx2 = int((roi["x"] + roi["w"]) * sx) + x_off
    ry2 = int((roi["y"] + roi["h"]) * sx) + y_off
    ov  = display.copy()
    cv2.rectangle(ov, (rx1, ry1), (rx2, ry2), (0, 255, 0), -1)
    cv2.addWeighted(ov, 0.08, display, 0.92, 0, display)
    cv2.rectangle(display, (rx1, ry1), (rx2, ry2), (0, 255, 0), 2)

    _f, _fs, _ft, _pad, _ty = cv2.FONT_HERSHEY_SIMPLEX, 0.65, 1, 6, 27

    # Left header: filename
    (dtw, dth), _ = cv2.getTextSize(name, _f, _fs, _ft)
    cv2.rectangle(display, (10 - _pad, _ty - dth - _pad), (10 + dtw + _pad, _ty + _pad), (0, 0, 0), -1)
    cv2.putText(display, name, (10, _ty), _f, _fs, (255, 255, 255), _ft)

    # Right header: unit + counts
    _seg_u = f"{unit}  detections:{count}  in_roi:{len(roi_ids)}"
    (uw, _), _ = cv2.getTextSize(_seg_u, _f, _fs, _ft)
    cv2.rectangle(display, (DISPLAY_W - uw - 10 - _pad, _ty - dth - _pad), (DISPLAY_W - 10 + _pad, _ty + _pad), (0, 0, 0), -1)
    cv2.putText(display, _seg_u, (DISPLAY_W - uw - 10, _ty), _f, _fs, (255, 255, 255), _ft)

    # Bottom hint
    hint = "SPACE / Q = next    W = back    ESC = quit"
    (hw, hh), _ = cv2.getTextSize(hint, _f, 0.5, 1)
    cv2.rectangle(display, (10 - _pad, DISPLAY_H - hh - 12 - _pad), (10 + hw + _pad, DISPLAY_H - 12 + _pad), (0, 0, 0), -1)
    cv2.putText(display, hint, (10, DISPLAY_H - 12), _f, 0.5, (180, 180, 180), 1)

    # Track dots (same color scheme as run_video)
    _COLOR_COUNTED_NOW = (255, 0, 255)
    _COLOR_COUNTED     = (0, 255, 0)
    _COLOR_OUT_OF_ROI  = (0, 165, 255)
    for track in debug_tracks:
        tid, in_roi_f = track["tid"], track["in_roi"]
        dcx = int(track["cx"] * sx) + x_off
        dcy = int(track["cy"] * sx) + y_off
        c_now    = tid in counted_ids_now
        counted  = tid in counter.counted_ids
        if c_now:
            dot    = _COLOR_COUNTED_NOW
            status = "COUNTED NOW"
        elif in_roi_f and counted:
            dot    = _COLOR_COUNTED
            status = "COUNTED"
        else:
            dot    = _COLOR_OUT_OF_ROI
            status = "OUT OF ROI"
        _conf   = track.get("conf")
        _conf_s = f"{_conf:.0%}" if _conf is not None else "?"
        cv2.circle(display, (dcx, dcy), 7, dot, -1)
        cv2.circle(display, (dcx, dcy), 11, dot, 2)
        lbl = f"ID{tid} {_conf_s} {status}"
        (lw, lh), _ = cv2.getTextSize(lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1)
        tx = max(8, min(dcx + 13, DISPLAY_W - lw - 8))
        ty = max(lh + 8, min(dcy - 13, DISPLAY_H - 8))
        cv2.rectangle(display, (tx - 3, ty - lh - 3), (tx + lw + 3, ty + 3), (0, 0, 0), -1)
        cv2.putText(display, lbl, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.48, dot, 1)

    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.imshow(WINDOW_NAME, display)
    print(f"  {name}  |  detections={count}  in_roi={len(roi_ids)}  inf={inf_ms:.0f}ms  |  SPACE/Q=next  W=back  ESC=quit")

    stats.frames_processed   = 1
    stats.total_detections   = count
    stats.frames_with_detections = 1 if count > 0 else 0
    stats.items_counted      = counter.total
    stats.avg_inference_ms   = round(inf_ms, 2)

    aborted = go_back = False
    while True:
        key = cv2.waitKey(0) & 0xFF
        if key in (ord("q"), ord(" "), 13):   # Q / Space / Enter → next
            break
        if key == ord("w"):
            go_back = True
            break
        if key == 27:
            aborted = True
            break

    return stats, aborted, go_back


# ── Modes ──────────────────────────────────────────────────────────────────

def run_single(model: YOLO, record: bool = False, unit: Optional[str] = None,
               max_seconds: Optional[float] = None) -> None:
    unit_configs = _load_unit_configs()

    if unit is None:
        # No unit specified — collect everything from videos/
        unit    = "preview"
        src_dir = VIDEOS_DIR
        videos  = sorted(src_dir.glob("**/*.mp4")) if src_dir.is_dir() else []
        images  = sorted(f for ext in IMAGE_EXTS for f in src_dir.glob(f"**/*{ext}")) if src_dir.is_dir() else []
        sources = sorted(set(videos + images), key=lambda x: x.name)
        if not sources:
            raise FileNotFoundError(
                "No --unit specified and no videos/images found in videos/. "
                "Either pass --unit SP-XX or place files in the videos/ folder."
            )
    else:
        folder  = VIDEOS_DIR / unit
        sources = _resolve_sources(str(folder)) if folder.is_dir() else []

        if not sources:
            raise FileNotFoundError(
                f"No videos found for {unit} in {folder}. "
                f"Place .mp4 files in inference-client/videos2/{unit}/"
            )

    # Pre-compute one recording path per source so each video gets its own file
    if record:
        REC_DIR.mkdir(parents=True, exist_ok=True)
    rec_paths = [REC_DIR / f"{unit} ({idx+1}).mp4" for idx in range(len(sources))]

    i = 0
    while i < len(sources):
        src   = sources[i]
        label = str(src) if _is_stream_url(str(src)) else Path(str(src)).name
        print(f"Source: {label}  |  Unit: {unit}  |  Q/SPACE=next  W=back  ESC=quit")
        if _is_image(src):
            _, aborted, go_back = run_image(model, src, unit=unit, unit_configs=unit_configs)
        else:
            _, aborted, go_back = run_video(model, src, unit=unit, record=record,
                                            unit_configs=unit_configs, max_seconds=max_seconds,
                                            rec_path_override=rec_paths[i])
        if aborted:
            break
        i = max(0, i - 1) if go_back else i + 1

    cv2.destroyAllWindows()
    cv2.waitKey(1)


def run_all(model: YOLO, max_seconds: Optional[float], record: bool = False) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    unit_configs = _load_unit_configs()

    print("=" * 60)
    print("  SPRAY PLANT — Leather Detection  |  All Units")
    print(f"  Model : {MODEL.name}")
    print(f"  Conf  : {CONF}   Target FPS: {TARGET_FPS}  (frame skip: {max(1, round(30 / TARGET_FPS))})")
    print(f"  Controls : Q = next   W = back   ESC = quit")
    if max_seconds:
        print(f"  Cap   : {max_seconds}s per video")
    print("=" * 60)

    # Build a flat ordered list of (unit, source) so Q/W navigate
    # freely across all units and all their videos in sequence.
    all_items: list[tuple[str, any]] = []
    for unit in UNITS:
        folder  = VIDEOS_DIR / unit
        sources = _resolve_sources(str(folder)) if folder.is_dir() else []
        if not sources:
            print(f"\n[{unit}] No videos found in videos2/{unit}/ — skipping.")
            continue
        for src in sources:
            all_items.append((unit, src))

    if not all_items:
        print("  No sources found for any unit.")
        cv2.destroyAllWindows()
        return

    # Pre-compute per-unit indexed recording paths: SP-01 (1).mp4, SP-01 (2).mp4 …
    if record:
        REC_DIR.mkdir(parents=True, exist_ok=True)
    unit_counters: dict[str, int] = {}
    item_rec_paths: list[Path] = []
    for u, _ in all_items:
        unit_counters[u] = unit_counters.get(u, 0) + 1
        item_rec_paths.append(REC_DIR / f"{u} ({unit_counters[u]}).mp4")

    all_video_stats: list[VideoStats] = []
    run_aborted  = False
    current_unit = None
    i = 0

    while i < len(all_items):
        unit, src = all_items[i]

        # Print unit banner whenever we enter (or re-enter after W) a unit.
        if unit != current_unit:
            cfg_source = _get_unit_source(unit_configs, unit)
            src_label  = cfg_source if cfg_source and _is_stream_url(cfg_source) \
                         else f"{sum(1 for u, _ in all_items if u == unit)} video(s)"
            print(f"\n{'━'*60}\n  {unit}  —  {src_label}\n{'━'*60}")
            current_unit = unit

        if _is_image(src):
            vstats, aborted, go_back = run_image(model, src, unit, unit_configs=unit_configs)
        else:
            vstats, aborted, go_back = run_video(
                model, src, unit, max_seconds=max_seconds,
                record=record, unit_configs=unit_configs,
                rec_path_override=item_rec_paths[i],
            )
        all_video_stats.append(vstats)

        if aborted:
            run_aborted = True
            break

        if go_back:
            new_i = max(0, i - 1)
            # If going back crosses a unit boundary, reset banner so it reprints.
            if all_items[new_i][0] != unit:
                current_unit = None
            i = new_i
        else:
            next_i = i + 1
            # Print unit totals when we finish the last source of a unit.
            if next_i >= len(all_items) or all_items[next_i][0] != unit:
                unit_stats   = [v for v in all_video_stats if v.unit == unit]
                unit_agg     = _aggregate_unit(unit, unit_stats)
                unit_counted = sum(v.items_counted for v in unit_stats if not v.skipped)
                print(f"\n  [{unit} TOTAL] videos={unit_agg.videos_processed}  "
                      f"frames={unit_agg.total_frames_processed}  "
                      f"detections={unit_agg.total_detections}  "
                      f"counted={unit_counted}  avg/frame={unit_agg.avg_per_frame}")
            i = next_i

    cv2.destroyAllWindows()
    cv2.waitKey(1)

    valid_all              = [v for v in all_video_stats if not v.skipped and v.frames_processed > 0]
    total_frames_processed = sum(v.frames_processed for v in valid_all)
    total_detections       = sum(v.total_detections for v in valid_all)
    all_unit_stats         = [
        _aggregate_unit(unit, [v for v in all_video_stats if v.unit == unit])
        for unit in UNITS
        if any(v.unit == unit for v in all_video_stats)
    ]

    summary = RunSummary(
        run_timestamp              = time.strftime("%Y-%m-%dT%H:%M:%S"),
        model                      = MODEL.name,
        confidence                 = CONF,
        frame_skip                 = TARGET_FPS,
        total_videos               = len(valid_all),
        total_frames_processed     = total_frames_processed,
        total_detections           = total_detections,
        overall_avg_per_frame      = round(total_detections / total_frames_processed, 2) if total_frames_processed else 0.0,
        overall_detection_rate_pct = round(100 * sum(v.frames_with_detections for v in valid_all) / total_frames_processed, 1) if total_frames_processed else 0.0,
        overall_avg_inference_ms   = round(sum(v.avg_inference_ms for v in valid_all) / len(valid_all), 2) if valid_all else 0.0,
        videos = all_video_stats,
        units  = all_unit_stats,
    )

    with open(OUT_FILE, "w") as f:
        json.dump(asdict(summary), f, indent=2)

    print(f"\n{'='*60}\n  OVERALL RESULTS\n{'='*60}")
    print(f"  Videos    : {summary.total_videos}")
    print(f"  Frames    : {summary.total_frames_processed}")
    print(f"  Detections: {summary.total_detections}")
    print(f"  Avg/frame : {summary.overall_avg_per_frame}")
    print(f"  Rate      : {summary.overall_detection_rate_pct}%")
    print(f"  Speed     : {summary.overall_avg_inference_ms}ms/frame")
    print(f"  Saved to  : {OUT_FILE}")
    print("=" * 60)
    if run_aborted:
        print("\n  [!] Run aborted early — partial results saved.")


# ── Entry point ────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Spray Plant — Leather Detection Inference Client")
    parser.add_argument("--all",         action="store_true", help="Run all units defined in unit_configs.json")
    parser.add_argument("--unit",        choices=UNITS, default=None, metavar="UNIT",
                        help="Run a single unit (e.g. SP-01). Source comes from unit_configs.json.")
    parser.add_argument("--max-seconds", type=float, default=None, metavar="S",
                        help="Max seconds to process per source (default: unbounded)")
    parser.add_argument("--model",       type=Path, default=MODEL, metavar="PATH",
                        help=f"Path to YOLO model weights (default: {MODEL.name})")
    parser.add_argument("--record",      action="store_true", help="Save annotated output to recordings/")
    args = parser.parse_args()

    model_path = args.model
    if not model_path.exists():
        raise FileNotFoundError(
            f"Model not found: {model_path}\n"
            f"Copy yolov8s_seg_best.pt into: {BASE}"
        )

    if DEVICE == "cpu":
        print("[device] CUDA not available — running on CPU.")
    else:
        print(f"[device] GPU detected: {torch.cuda.get_device_name(0)}  "
              f"({torch.cuda.get_device_properties(0).total_memory // 1024**2} MB VRAM)")

    model       = YOLO(str(model_path))
    model.to(DEVICE)   # move weights to GPU once at load time
    cap_seconds = args.max_seconds if args.max_seconds and args.max_seconds > 0 else None

    if args.all:
        run_all(model, max_seconds=cap_seconds, record=args.record)
    else:
        run_single(model, record=args.record, unit=args.unit, max_seconds=cap_seconds)


if __name__ == "__main__":
    main()
