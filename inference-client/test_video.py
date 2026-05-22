"""
test_video.py — Local video test for spray plant inference logic

Runs the full tracking + ROI + idle detection pipeline on a local video
file WITHOUT writing anything to the database.  Use this to verify:
  • overlap suppression (no duplicate IDs on one object)
  • idle timer behaviour (only resets on NEW pieces entering ROI)
  • ROI filtering (only in-ROI pieces affect status)

Usage:
    python test_video.py --video path/to/video.mp4
    python test_video.py --video path/to/video.mp4 --unit SP-03
    python test_video.py --video path/to/video.mp4 --unit SP-03 --record

Controls:
  Q   — skip / next video
  W   — go back
  ESC — quit
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import torch
from ultralytics import YOLO

# ── Paths ──────────────────────────────────────────────────────────────────
BASE       = Path(__file__).parent
MODEL      = BASE / "yolov8s_seg_best.pt"
CFG_FILE   = BASE / "unit_configs.json"
VIDEOS_DIR = BASE / "videos"
REC_DIR    = BASE / "recordings"

# ── Inference config ───────────────────────────────────────────────────────
TARGET_FPS      = 5
CONF            = 0.15
IDLE_TIMEOUT_SEC = 30

# ── Display config ─────────────────────────────────────────────────────────
DISPLAY_W   = 1280
DISPLAY_H   = 720
WINDOW_NAME = "Test — Spray Plant Inference"
REC_FPS     = 10.0

DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"


# ── Config helpers ─────────────────────────────────────────────────────────

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


def _in_roi(cx: float, cy: float, roi: dict) -> bool:
    return (roi["x"] <= cx <= roi["x"] + roi["w"] and
            roi["y"] <= cy <= roi["y"] + roi["h"])


# ── Tracker ────────────────────────────────────────────────────────────────

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


def _suppress_overlapping_tracks(
    track_results: list[tuple[int, list]],
    iou_threshold: float = 0.30,
) -> list[tuple[int, list]]:
    """Remove duplicate track IDs caused by one object getting multiple detections."""
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
            if SimpleIoUTracker._iou(box_i, box_j) > iou_threshold:
                suppressed.add(tid_j)
    return kept


# ── Main test loop ─────────────────────────────────────────────────────────

def run_test(model: YOLO, video_path: Path, unit: str, record: bool = False,
             max_seconds: Optional[float] = None) -> bool:
    """
    Returns True if user pressed ESC (abort all), False otherwise.
    """
    unit_configs = _load_unit_configs()

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"[error] Could not open: {video_path}")
        return False

    video_fps   = cap.get(cv2.CAP_PROP_FPS) or 20.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frame_w     = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h     = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration_s  = total_frames / video_fps if total_frames > 0 else 0.0
    frame_skip  = max(1, round(video_fps / TARGET_FPS))
    max_frames  = int(max_seconds * video_fps) if max_seconds else total_frames or 10**12

    roi, _line = _get_unit_cfg(unit_configs, unit, frame_w, frame_h)

    tracker  = SimpleIoUTracker()
    counter  = RoiCounter()

    total_count         = 0
    last_detection_time = time.time()
    belt_active         = True
    prev_belt_active    = True
    dynamic_frame_skip  = frame_skip
    new_idle_session    = 0
    idle_sessions_total = 0
    last_frame_time     = time.time()
    frame_num           = 0
    frames_processed    = 0
    aborted             = False
    go_back             = False

    writer   = None
    rec_path = None
    if record:
        REC_DIR.mkdir(parents=True, exist_ok=True)
        rec_path = REC_DIR / f"test_{unit}_{video_path.stem}.mp4"
        writer   = cv2.VideoWriter(str(rec_path), cv2.VideoWriter_fourcc(*"mp4v"),
                                   REC_FPS, (DISPLAY_W, DISPLAY_H))
        print(f"  Recording → {rec_path.name}")

    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW_NAME, DISPLAY_W, DISPLAY_H)

    print(f"\n{'─'*60}")
    print(f"  {unit}  |  {video_path.name}")
    print(f"  {total_frames} frames  |  {video_fps:.1f} fps  |  {duration_s:.1f}s")
    print(f"  Idle timeout: {IDLE_TIMEOUT_SEC}s  |  Q=skip  W=back  ESC=quit")
    print(f"  Dots: CYAN=new count  GREEN=in ROI  ORANGE=outside ROI")
    print(f"{'─'*60}")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_num += 1
        if frame_num > max_frames:
            print(f"  → {max_seconds}s cap reached.")
            break
        if frame_num % dynamic_frame_skip != 0:
            continue

        now              = time.time()
        frame_time_delta = now - last_frame_time
        last_frame_time  = now
        frames_processed += 1

        # ── Inference ─────────────────────────────────────────────────────
        results    = model.predict(frame, conf=CONF, iou=0.7, device=DEVICE, verbose=False, show=False)
        result     = results[0]
        boxes_xyxy = result.boxes.xyxy.cpu().numpy().tolist() if result.boxes is not None and len(result.boxes) > 0 else []

        # ── Tracking + overlap suppression ────────────────────────────────
        track_results = _suppress_overlapping_tracks(tracker.update(boxes_xyxy))
        debug_tracks: list[dict] = []
        roi_ids: list[int] = []
        for tid, box in track_results:
            cx, cy = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0
            in_roi = _in_roi(cx, cy, roi)
            debug_tracks.append({"tid": tid, "cx": cx, "cy": cy, "in_roi": in_roi})
            if in_roi:
                roi_ids.append(tid)
        counted_ids_now = counter.update(roi_ids)

        piece_delta  = len(counted_ids_now)
        total_count += piece_delta

        # ── Idle / active state ────────────────────────────────────────────
        time_since_new = time.time() - last_detection_time
        if len(counted_ids_now) > 0:
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
            new_idle_session    = 1
            idle_sessions_total += 1
        if not prev_belt_active and belt_active:
            tracker.reset()
        prev_belt_active = belt_active
        new_idle_session = 0

        # ── Render ────────────────────────────────────────────────────────
        annotated = result.plot(boxes=False)
        h, w      = annotated.shape[:2]
        scale     = min(DISPLAY_W / w, DISPLAY_H / h)
        new_w, new_h = int(w * scale), int(h * scale)
        resized   = cv2.resize(annotated, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        display  = np.zeros((DISPLAY_H, DISPLAY_W, 3), dtype=np.uint8)
        x_off    = (DISPLAY_W - new_w) // 2
        y_off    = (DISPLAY_H - new_h) // 2
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

        # Header
        _f, _fs, _ft, _pad, _ty = cv2.FONT_HERSHEY_SIMPLEX, 0.65, 1, 6, 27
        _dt = time.strftime("%d-%m-%Y  %H:%M:%S")
        (dtw, dth), _ = cv2.getTextSize(_dt, _f, _fs, _ft)
        cv2.rectangle(display, (10 - _pad, _ty - dth - _pad), (10 + dtw + _pad, _ty + _pad), (0, 0, 0), -1)
        cv2.putText(display, _dt, (10, _ty), _f, _fs, (255, 255, 255), _ft)

        _st_str   = "Active" if belt_active else "Idle"
        _st_color = (0, 255, 0) if belt_active else (0, 165, 255)
        _seg_u = f"{unit} "
        _seg_s = f"({_st_str})"
        _seg_c = f"  Count:{counter.total}  Idle sessions:{idle_sessions_total}"
        (uw, _), _ = cv2.getTextSize(_seg_u, _f, _fs, _ft)
        (sw, _), _ = cv2.getTextSize(_seg_s, _f, _fs, _ft)
        (cw, _), _ = cv2.getTextSize(_seg_c, _f, _fs, _ft)
        _rx = DISPLAY_W - uw - sw - cw - 10
        cv2.rectangle(display, (_rx - _pad, _ty - dth - _pad), (DISPLAY_W - 10 + _pad, _ty + _pad), (0, 0, 0), -1)
        cv2.putText(display, _seg_c, (DISPLAY_W - cw - 10, _ty),          _f, _fs, (255, 255, 255), _ft)
        cv2.putText(display, _seg_s, (DISPLAY_W - cw - sw - 10, _ty),     _f, _fs, _st_color,        _ft)
        cv2.putText(display, _seg_u, (DISPLAY_W - cw - sw - uw - 10, _ty),_f, _fs, (255, 255, 255),  _ft)

        # Idle countdown bar (bottom of screen when not idle and counting down)
        if not belt_active:
            cv2.rectangle(display, (0, DISPLAY_H - 6), (DISPLAY_W, DISPLAY_H), (0, 0, 180), -1)
        elif time_since_new > 0:
            frac = min(time_since_new / IDLE_TIMEOUT_SEC, 1.0)
            bar_w = int(DISPLAY_W * frac)
            cv2.rectangle(display, (0, DISPLAY_H - 6), (bar_w, DISPLAY_H), (0, 165, 255), -1)

        # Track dots with labels
        for track in debug_tracks:
            tid, in_roi_flag = track["tid"], track["in_roi"]
            dcx = int(track["cx"] * sx) + x_off
            dcy = int(track["cy"] * sy) + y_off
            counted_now = tid in counted_ids_now
            counted     = tid in counter.counted_ids
            dot_color   = (255, 255, 0) if counted_now else ((0, 255, 0) if in_roi_flag else (0, 165, 255))
            cv2.circle(display, (dcx, dcy), 5, dot_color, -1)
            cv2.circle(display, (dcx, dcy), 8, dot_color, 2)
            status   = ("ROI:Y" if in_roi_flag else "ROI:N") + (" NEW" if counted_now else (" COUNTED" if counted else ""))
            lbl      = f"ID{tid} {status}"
            (lw, lh), _ = cv2.getTextSize(lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            tx = max(8, min(dcx + 10, DISPLAY_W - lw - 8))
            ty = max(lh + 8, min(dcy - 6, DISPLAY_H - 8))
            cv2.rectangle(display, (tx - 3, ty - lh - 3), (tx + lw + 3, ty + 3), (0, 0, 0), -1)
            cv2.putText(display, lbl, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.45, dot_color, 1)

        cv2.imshow(WINDOW_NAME, display)
        if writer:
            writer.write(display)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            print("  → Next (Q).")
            break
        if key == ord("w"):
            print("  → Back (W).")
            go_back = True
            break
        if key == 27:
            print("  → Aborted (ESC).")
            aborted = True
            break

    cap.release()
    if writer:
        writer.release()
        print(f"  Saved → {rec_path}")

    print(f"\n  ── Results ──────────────────────────────")
    print(f"  Frames processed : {frames_processed}")
    print(f"  Pieces counted   : {counter.total}")
    print(f"  Idle sessions    : {idle_sessions_total}")
    print(f"  Final status     : {'Active' if belt_active else 'Idle'}")
    print(f"  ─────────────────────────────────────────\n")

    return aborted, go_back


# ── Entry point ────────────────────────────────────────────────────────────

UNITS = ["SP-01", "SP-02", "SP-03", "SP-04", "SP-05", "SP-06"]


def _load_model(model_path: Path) -> YOLO:
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")
    if DEVICE == "cpu":
        print("[device] CUDA not available — running on CPU.")
    else:
        props = torch.cuda.get_device_properties(0)
        print(f"[device] {torch.cuda.get_device_name(0)}  ({props.total_memory // 1024**2} MB VRAM)")
    print(f"[model]  Loading {model_path.name} ...")
    model = YOLO(str(model_path))
    model.to(DEVICE)
    return model


def main() -> None:
    parser = argparse.ArgumentParser(description="Local video test — spray plant inference (no DB writes)")
    parser.add_argument("--all",         action="store_true",
                        help="Run all units SP-01..SP-06 from videos/ folder, Q/W to navigate")
    parser.add_argument("--video",       type=Path, default=None, metavar="PATH",
                        help="Path to a single video file or folder of .mp4 files")
    parser.add_argument("--unit",        type=str,  default="SP-01", metavar="UNIT",
                        help="Unit name for ROI lookup when using --video (default: SP-01)")
    parser.add_argument("--model",       type=Path, default=MODEL,   metavar="PATH",
                        help=f"YOLO model weights (default: {MODEL.name})")
    parser.add_argument("--max-seconds", type=float, default=None,   metavar="S",
                        help="Cap processing at N seconds per video")
    parser.add_argument("--record",      action="store_true",
                        help="Save annotated output to recordings/")
    args = parser.parse_args()

    model = _load_model(args.model)

    if args.all:
        # Build flat list of (unit, video_path) across all SP-XX folders
        all_items: list[tuple[str, Path]] = []
        for unit in UNITS:
            folder = VIDEOS_DIR / unit
            if folder.is_dir():
                videos = sorted(folder.glob("*.mp4"))
                for v in videos:
                    all_items.append((unit, v))
            else:
                print(f"[{unit}] No folder at videos/{unit}/ — skipping.")

        if not all_items:
            print("No videos found in videos/SP-XX/ folders.")
            return

        print(f"[model]  Loaded. --all mode: {len(all_items)} video(s) across {len(set(u for u,_ in all_items))} unit(s)")
        print(f"         Q=next video/unit  W=previous  ESC=quit\n")

        i = 0
        current_unit = None
        while i < len(all_items):
            unit, video_path = all_items[i]
            if unit != current_unit:
                print(f"\n{'━'*60}\n  {unit}\n{'━'*60}")
                current_unit = unit
            aborted, go_back = run_test(model, video_path, unit=unit,
                                        record=args.record, max_seconds=args.max_seconds)
            if aborted:
                break
            if go_back:
                new_i = max(0, i - 1)
                if all_items[new_i][0] != unit:
                    current_unit = None  # force unit banner reprint
                i = new_i
            else:
                i += 1

    else:
        # Single video / folder mode
        if args.video is None:
            parser.error("Provide --video PATH or use --all")

        if args.video.is_dir():
            sources = sorted(args.video.glob("*.mp4"))
            if not sources:
                raise FileNotFoundError(f"No .mp4 files in: {args.video}")
        elif args.video.is_file():
            sources = [args.video]
        else:
            raise FileNotFoundError(f"Video not found: {args.video}")

        print(f"[model]  Loaded. Unit={args.unit}  Videos={len(sources)}\n")

        i = 0
        while i < len(sources):
            aborted, go_back = run_test(model, sources[i], unit=args.unit,
                                        record=args.record, max_seconds=args.max_seconds)
            if aborted:
                break
            i = max(0, i - 1) if go_back else i + 1

    cv2.destroyAllWindows()
    print("Done.")


if __name__ == "__main__":
    main()
