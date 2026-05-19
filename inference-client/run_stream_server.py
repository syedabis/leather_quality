"""
run_stream_server.py — Spray Plant Inference + MJPEG Network Stream

Runs YOLOv8 inference and serves the annotated feed over HTTP so anyone
on the same network can watch in a browser.  No app install needed —
just open the printed URL in Chrome/Edge/Firefox.

    python run_stream_server.py --unit SP-01
    python run_stream_server.py --all
    python run_stream_server.py --unit SP-01 --port 8080

Browse to:
    http://<this-machine-ip>:8080/

Controls (on the machine running this script):
  Q   — skip current video / stream
  W   — go back
  ESC — quit
"""

from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import requests
import torch
from flask import Flask, Response, jsonify
from ultralytics import YOLO

from app.db.frame_processor import FrameProcessor

# ── GPU / device selection ─────────────────────────────────────────────────
DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"

# ── Paths ──────────────────────────────────────────────────────────────────
BASE        = Path(__file__).parent
MODEL       = BASE / "yolov8s_seg_best.pt"
VIDEOS_DIR  = BASE / "videos"
CFG_FILE    = BASE / "unit_configs.json"
OUT_DIR     = BASE / "results"
OUT_FILE    = OUT_DIR / "spray_plant_results.json"
REC_DIR     = BASE / "recordings"

TARGET_FPS         = 5
REC_FPS            = 10.0
CONF               = 0.15
DISPLAY_W          = 1280
DISPLAY_H          = 720
WINDOW_NAME        = "Leather Detection"
SKIP_START_SECONDS = 0
IDLE_TIMEOUT_SEC   = 30

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

BACKEND_URL   = os.getenv("BACKEND_URL", "http://localhost:8001").rstrip("/")
THUMB_EVERY   = 5
THUMB_QUALITY = 55

_push_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="frame-push")


# ── MJPEG stream server ────────────────────────────────────────────────────

_flask_app   = Flask(__name__)
_frame_lock  = threading.Lock()
_latest_jpeg: bytes = b""
_stream_meta = {"unit": "—", "count": 0, "status": "Starting…"}

_INDEX_HTML = """<!DOCTYPE html>
<html>
<head>
  <title>Spray Plant — Live Detection</title>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f0f0f; color: #e0e0e0; font-family: 'Segoe UI', monospace; height: 100vh; display: flex; flex-direction: column; }
    #header { padding: 10px 20px; background: #1a1a1a; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 32px; flex-shrink: 0; }
    #header h1 { font-size: 16px; font-weight: 600; color: #fff; letter-spacing: 0.5px; }
    .stat { font-size: 13px; color: #aaa; }
    .stat b { color: #fff; font-size: 14px; }
    #status-val { font-size: 14px; font-weight: 600; }
    #stream-wrap { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    #stream-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
    #no-feed { display: none; color: #555; font-size: 18px; }
  </style>
</head>
<body>
  <div id="header">
    <h1>&#9673; Spray Plant — Live Detection</h1>
    <div class="stat">Unit: <b id="unit">—</b></div>
    <div class="stat">Count: <b id="count">0</b></div>
    <div class="stat">Status: <b id="status-val" style="color:#aaa">Starting…</b></div>
  </div>
  <div id="stream-wrap">
    <img id="feed" src="/stream" onerror="this.style.display='none'; document.getElementById('no-feed').style.display='block'" />
    <div id="no-feed">No feed available yet — inference starting…</div>
  </div>
  <script>
    setInterval(() => {
      fetch('/status').then(r => r.json()).then(d => {
        document.getElementById('unit').textContent  = d.unit;
        document.getElementById('count').textContent = d.count;
        const el = document.getElementById('status-val');
        el.textContent = d.status;
        el.style.color = d.status === 'Active' ? '#00e676' : d.status === 'Downtime' ? '#ff5252' : '#aaa';
      }).catch(() => {});
    }, 1000);
  </script>
</body>
</html>"""


def _update_stream(frame_bgr, unit: str, count: int, belt_active: bool) -> None:
    global _latest_jpeg
    ok, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not ok:
        return
    with _frame_lock:
        _latest_jpeg = buf.tobytes()
        _stream_meta["unit"]   = unit
        _stream_meta["count"]  = count
        _stream_meta["status"] = "Active" if belt_active else "Downtime"


def _mjpeg_generator():
    while True:
        with _frame_lock:
            frame = _latest_jpeg
        if frame:
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        time.sleep(0.04)  # cap at ~25 FPS to clients


@_flask_app.route("/")
def _index():
    return _INDEX_HTML


@_flask_app.route("/stream")
def _stream():
    return Response(_mjpeg_generator(), mimetype="multipart/x-mixed-replace; boundary=frame")


@_flask_app.route("/status")
def _status():
    with _frame_lock:
        meta = dict(_stream_meta)
    return jsonify(meta)


def _start_flask(host: str, port: int) -> None:
    log = logging.getLogger("werkzeug")
    log.setLevel(logging.ERROR)
    _flask_app.run(host=host, port=port, threaded=True, use_reloader=False)


def _get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"


# ── Dashboard frame push ───────────────────────────────────────────────────

def _push_frame(plant_id: str, frame_bgr) -> None:
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
            pass

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
    entry     = configs.get(unit, {})
    roi_norm  = entry.get("roi",  {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0})
    line_norm = entry.get("line", {"start": [0.5, 0.0], "end": [0.5, 1.0]})
    roi = {
        "x": int(roi_norm["x"] * frame_w),
        "y": int(roi_norm["y"] * frame_h),
        "w": int(roi_norm["w"] * frame_w),
        "h": int(roi_norm["h"] * frame_h),
    }
    line = {
        "start": [int(line_norm["start"][0] * frame_w), int(line_norm["start"][1] * frame_h)],
        "end":   [int(line_norm["end"][0]   * frame_w), int(line_norm["end"][1]   * frame_h)],
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
    if _is_stream_url(source):
        return [source]
    p = Path(source)
    if p.is_dir():
        videos = sorted(p.glob("*.mp4"))
        if not videos:
            print(f"  [warn] Directory has no .mp4 files: {p}")
        return videos
    if p.is_file():
        return [p]
    print(f"  [warn] Source not found: {source}")
    return []


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


# ── Tracker ────────────────────────────────────────────────────────────────

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


# ── Core inference loop ────────────────────────────────────────────────────

def run_video(model: YOLO, video_source, unit: str,
              max_seconds: Optional[float] = None,
              record: bool = False,
              unit_configs: Optional[dict] = None,
              display_name: Optional[str] = None) -> tuple[VideoStats, bool, bool]:

    is_stream = isinstance(video_source, str) and _is_stream_url(video_source)
    cap_arg   = video_source if is_stream else str(video_source)
    name      = display_name or (f"{unit}-stream" if is_stream else Path(str(video_source)).name)

    stats = VideoStats(unit=unit, filename=name)

    cap = cv2.VideoCapture(cap_arg)
    if not cap.isOpened():
        stats.skipped     = True
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

    frame_skip = max(1, round(video_fps / TARGET_FPS))

    configs = unit_configs or {}
    roi, _line = _get_unit_cfg(configs, unit, frame_w, frame_h)

    counter          = RoiCounter()
    tracker          = SimpleIoUTracker(iou_thresh=0.25, max_age=5)

    writer   = None
    rec_path = None
    if record:
        REC_DIR.mkdir(parents=True, exist_ok=True)
        safe_name = Path(name).stem.replace(" ", "_") or unit
        rec_path  = REC_DIR / f"{unit}_{safe_name}.mp4"
        writer    = cv2.VideoWriter(str(rec_path), cv2.VideoWriter_fourcc(*"mp4v"), REC_FPS, (DISPLAY_W, DISPLAY_H))
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

    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)

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

        results    = model.predict(frame, conf=CONF, iou=0.7, device=DEVICE, verbose=False, show=False)
        result     = results[0]
        boxes_xyxy = result.boxes.xyxy.cpu().numpy().tolist() if result.boxes is not None and len(result.boxes) > 0 else []

        track_results   = tracker.update(boxes_xyxy)
        debug_tracks: list[dict] = []
        roi_ids: list[int] = []
        for tid, box in track_results:
            cx, cy = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0
            in_roi = _in_roi(cx, cy, roi)
            debug_tracks.append({"tid": tid, "cx": cx, "cy": cy, "in_roi": in_roi})
            if in_roi:
                roi_ids.append(tid)
        counted_ids_now = counter.update(roi_ids)

        stats.items_counted = counter.total
        count               = len(result.boxes) if result.boxes is not None else 0
        piece_delta         = len(counted_ids_now)
        total_count        += piece_delta

        time_since_new_id = time.time() - last_detection_time
        if len(counted_ids_now) > 0:
            last_detection_time = time.time()
            belt_active         = True
            dynamic_frame_skip  = frame_skip
            idle_started        = None
        elif time_since_new_id > IDLE_TIMEOUT_SEC:
            if not idle_started:
                idle_started = time.time()
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
        if result.boxes is not None and len(result.boxes) > 0:
            confs = result.boxes.conf
            if confs is not None and len(confs) > 0:
                utilization_pct = float(confs.mean().cpu().numpy()) * 100

        FrameProcessor.process_frame(
            source_note        = db_unit,
            total_count        = total_count,
            belt_active        = belt_active,
            utilization_pct    = utilization_pct,
            piece_delta        = piece_delta,
            frame_time_delta_s = frame_time_delta,
            idle_sessions_delta = new_idle_session,
        )
        new_idle_session = 0

        detection_counts.append(count)
        inference_times.append(result.speed["inference"])
        if count > 0:
            stats.frames_with_detections += 1

        # ── Build display frame ───────────────────────────────────────────
        annotated = result.plot(boxes=False)

        h, w  = annotated.shape[:2]
        scale = min(DISPLAY_W / w, DISPLAY_H / h)
        new_w, new_h = int(w * scale), int(h * scale)
        resized = cv2.resize(annotated, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        display  = np.zeros((DISPLAY_H, DISPLAY_W, 3), dtype=np.uint8)
        x_offset = (DISPLAY_W - new_w) // 2
        y_offset = (DISPLAY_H - new_h) // 2
        display[y_offset:y_offset+new_h, x_offset:x_offset+new_w] = resized

        sx, sy = scale, scale

        rx1 = int(roi["x"] * sx) + x_offset
        ry1 = int(roi["y"] * sy) + y_offset
        rx2 = int((roi["x"] + roi["w"]) * sx) + x_offset
        ry2 = int((roi["y"] + roi["h"]) * sy) + y_offset
        overlay = display.copy()
        cv2.rectangle(overlay, (rx1, ry1), (rx2, ry2), (0, 255, 0), -1)
        cv2.addWeighted(overlay, 0.08, display, 0.92, 0, display)
        cv2.rectangle(display, (rx1, ry1), (rx2, ry2), (0, 255, 0), 2)

        _f, _fs, _ft = cv2.FONT_HERSHEY_SIMPLEX, 0.65, 1
        _pad = 6
        _ty  = 27

        _dt = time.strftime("%d-%m-%Y  %H:%M:%S")
        (dtw, dth), _ = cv2.getTextSize(_dt, _f, _fs, _ft)
        cv2.rectangle(display, (10 - _pad, _ty - dth - _pad), (10 + dtw + _pad, _ty + _pad), (0, 0, 0), -1)
        cv2.putText(display, _dt, (10, _ty), _f, _fs, (255, 255, 255), _ft)

        _st_str   = "Active" if belt_active else "Downtime"
        _st_color = (0, 255, 0) if belt_active else (0, 0, 255)
        _seg_u = f"{unit} "
        _seg_s = f"({_st_str})"
        _seg_c = f"  Count: {counter.total}"
        (uw, _), _ = cv2.getTextSize(_seg_u, _f, _fs, _ft)
        (sw, _), _ = cv2.getTextSize(_seg_s, _f, _fs, _ft)
        (cw, _), _ = cv2.getTextSize(_seg_c, _f, _fs, _ft)
        _rx = DISPLAY_W - uw - sw - cw - 10
        cv2.rectangle(display, (_rx - _pad, _ty - dth - _pad), (DISPLAY_W - 10 + _pad, _ty + _pad), (0, 0, 0), -1)
        _xc = DISPLAY_W - cw - 10
        _xs = _xc - sw
        _xu = _xs - uw
        cv2.putText(display, _seg_c, (_xc, _ty), _f, _fs, (255, 255, 255), _ft)
        cv2.putText(display, _seg_s, (_xs, _ty), _f, _fs, _st_color,        _ft)
        cv2.putText(display, _seg_u, (_xu, _ty), _f, _fs, (255, 255, 255),  _ft)

        for track in debug_tracks:
            tid, in_roi_flag = track["tid"], track["in_roi"]
            dcx = int(track["cx"] * sx) + x_offset
            dcy = int(track["cy"] * sy) + y_offset
            counted_now = tid in counted_ids_now
            counted     = tid in counter.counted_ids
            dot_color   = (255, 255, 0) if counted_now else ((0, 255, 0) if in_roi_flag else (0, 165, 255))
            cv2.circle(display, (dcx, dcy), 5, dot_color, -1)
            cv2.circle(display, (dcx, dcy), 8, dot_color, 2)
            status   = ("ROI:Y" if in_roi_flag else "ROI:N") + (" NEW" if counted_now else (" COUNTED" if counted else ""))
            dbg_text = f"ID {tid}  ({int(track['cx'])},{int(track['cy'])})  {status}"
            (dtw2, dth2), _ = cv2.getTextSize(dbg_text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            tx = max(8, min(dcx + 10, DISPLAY_W - dtw2 - 8))
            ty = max(dth2 + 8, min(dcy - 10, DISPLAY_H - 8))
            cv2.rectangle(display, (tx - 3, ty - dth2 - 3), (tx + dtw2 + 3, ty + 3), (0, 0, 0), -1)
            cv2.putText(display, dbg_text, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.45, dot_color, 1)

        # ── Push to network stream ────────────────────────────────────────
        _update_stream(display, unit, counter.total, belt_active)

        # ── Local display ─────────────────────────────────────────────────
        cv2.imshow(WINDOW_NAME, display)
        if writer:
            writer.write(display)

        if stats.frames_processed % THUMB_EVERY == 0:
            _push_frame(db_unit, display)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            print("  → Next (Q).")
            break
        if key == ord("w"):
            print("  → Back (W).")
            go_back = True
            break
        if key == 27:
            print("  → Aborted by user (ESC).")
            aborted = True
            break

    cap.release()
    if writer:
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
    print(f"  DB               : Real-time data written to SQL Server")


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


# ── Modes ──────────────────────────────────────────────────────────────────

def run_single(model: YOLO, record: bool = False, unit: Optional[str] = None,
               max_seconds: Optional[float] = None) -> None:
    unit_configs = _load_unit_configs()

    if unit is None:
        videos = sorted(VIDEOS_DIR.glob("**/*.mp4")) if VIDEOS_DIR.is_dir() else []
        if not videos:
            raise FileNotFoundError(
                "No --unit specified and no videos found in videos/. "
                "Either pass --unit SP-XX or place an .mp4 in the videos/ folder."
            )
        unit   = "preview"
        source = videos[0]
        print(f"Video: {source.name}  |  Unit: preview  |  Press Q to skip")
    else:
        cfg_source = _get_unit_source(unit_configs, unit)
        if cfg_source:
            sources = _resolve_sources(cfg_source)
        else:
            folder  = VIDEOS_DIR / unit
            sources = sorted(folder.glob("*.mp4")) if folder.is_dir() else []

        if not sources:
            raise FileNotFoundError(
                f"No source for {unit}. Set unit_configs.json[\"{unit}\"][\"source\"] "
                f"to an RTSP URL, a video file, or a folder containing .mp4 files."
            )

        i = 0
        while i < len(sources):
            source = sources[i]
            label  = str(source) if _is_stream_url(str(source)) else Path(str(source)).name
            print(f"Source: {label}  |  Unit: {unit} → {UNIT_MAP.get(unit, unit)}  |  Q=next  W=back  ESC=quit")
            _, aborted, go_back = run_video(model, source, unit=unit, record=record,
                                            unit_configs=unit_configs, max_seconds=max_seconds)
            if aborted:
                break
            i = max(0, i - 1) if go_back else i + 1

    cv2.destroyAllWindows()


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

    all_items: list[tuple[str, any]] = []
    for unit in UNITS:
        cfg_source = _get_unit_source(unit_configs, unit)
        if cfg_source:
            sources: list = _resolve_sources(cfg_source)
        else:
            folder  = VIDEOS_DIR / unit
            sources = sorted(folder.glob("*.mp4")) if folder.is_dir() else []
        if not sources:
            print(f"\n[{unit}] No source configured and no videos in videos/{unit}/ — skipping.")
            continue
        for src in sources:
            all_items.append((unit, src))

    if not all_items:
        print("  No sources found for any unit.")
        cv2.destroyAllWindows()
        return

    all_video_stats: list[VideoStats] = []
    run_aborted  = False
    current_unit = None
    i = 0

    while i < len(all_items):
        unit, src = all_items[i]

        if unit != current_unit:
            cfg_source = _get_unit_source(unit_configs, unit)
            src_label  = cfg_source if cfg_source and _is_stream_url(cfg_source) \
                         else f"{sum(1 for u, _ in all_items if u == unit)} video(s)"
            print(f"\n{'━'*60}\n  {unit}  —  {src_label}\n{'━'*60}")
            current_unit = unit

        vstats, aborted, go_back = run_video(
            model, src, unit, max_seconds=max_seconds,
            record=record, unit_configs=unit_configs
        )
        all_video_stats.append(vstats)

        if aborted:
            run_aborted = True
            break

        if go_back:
            new_i = max(0, i - 1)
            if all_items[new_i][0] != unit:
                current_unit = None
            i = new_i
        else:
            next_i = i + 1
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
    parser = argparse.ArgumentParser(description="Spray Plant — Inference + Network Stream")
    parser.add_argument("--all",         action="store_true", help="Run all units")
    parser.add_argument("--unit",        choices=UNITS, default=None, metavar="UNIT")
    parser.add_argument("--max-seconds", type=float, default=None, metavar="S")
    parser.add_argument("--model",       type=Path, default=MODEL, metavar="PATH")
    parser.add_argument("--record",      action="store_true")
    parser.add_argument("--port",        type=int, default=8080, metavar="PORT",
                        help="Port for the MJPEG HTTP stream server (default: 8080)")
    args = parser.parse_args()

    model_path = args.model
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}\nCopy yolov8s_seg_best.pt into: {BASE}")

    if DEVICE == "cpu":
        print("[device] CUDA not available — running on CPU.")
    else:
        print(f"[device] GPU detected: {torch.cuda.get_device_name(0)}  "
              f"({torch.cuda.get_device_properties(0).total_memory // 1024**2} MB VRAM)")

    # Start MJPEG stream server in background
    local_ip = _get_local_ip()
    t = threading.Thread(target=_start_flask, args=("0.0.0.0", args.port), daemon=True)
    t.start()
    print(f"\n[stream] Live feed available at:")
    print(f"[stream]   http://{local_ip}:{args.port}/          ← share this with others on the network")
    print(f"[stream]   http://localhost:{args.port}/            ← local browser\n")

    model       = YOLO(str(model_path))
    model.to(DEVICE)
    cap_seconds = args.max_seconds if args.max_seconds and args.max_seconds > 0 else None

    if args.all:
        run_all(model, max_seconds=cap_seconds, record=args.record)
    else:
        run_single(model, record=args.record, unit=args.unit, max_seconds=cap_seconds)


if __name__ == "__main__":
    main()
