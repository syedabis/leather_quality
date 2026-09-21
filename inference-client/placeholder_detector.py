"""
Placeholder Defect Detector & Camera Stream Simulator
Simulates leather hide defect detection (Cuts & Holes) on a conveyor video feed.
"""
import time
import random
import json
import requests
import cv2
import numpy as np

BACKEND_API_URL = "http://localhost:8001/api/quality/log-hide"

class PlaceholderDefectDetector:
    """Simulates YOLO-based Cut & Hole defect detection on leather hides."""

    def __init__(self, pass_probability: float = 0.75):
        self.pass_probability = pass_probability  # 75% Pass rate, 25% Defect rate
        self.hide_counter = 1000

    def process_frame(self, frame: np.ndarray, plant_id: str = "SP-01") -> tuple:
        """
        Process a frame from the video feed.
        Returns (annotated_frame, hide_data).
        """
        h, w, _ = frame.shape
        annotated = frame.copy()

        # Simulate hide location in center of frame
        hide_box = [int(w * 0.15), int(h * 0.15), int(w * 0.7), int(h * 0.7)]
        hx, hy, hw, hh = hide_box

        # Draw Hide Boundary (Cyan/Blue)
        cv2.rectangle(annotated, (hx, hy), (hx + hw, hy + hh), (255, 200, 0), 2)
        cv2.putText(
            annotated,
            "Leather Hide",
            (hx, hy - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 200, 0),
            2,
        )

        defects = []
        is_defective = random.random() > self.pass_probability

        if is_defective:
            # Generate 1 to 3 defects (Cuts or Holes)
            num_defects = random.randint(1, 3)
            for i in range(num_defects):
                defect_type = random.choice(["CUT", "HOLE"])
                dx = random.randint(hx + 30, hx + hw - 80)
                dy = random.randint(hy + 30, hy + hh - 80)

                if defect_type == "CUT":
                    dw, dh = random.randint(40, 80), random.randint(10, 20)
                    color = (0, 0, 255)  # Red for Cut
                else:
                    dw, dh = random.randint(25, 45), random.randint(25, 45)
                    color = (0, 165, 255)  # Amber/Orange for Hole

                conf = round(random.uniform(0.85, 0.98), 2)
                defects.append({
                    "defect_type": defect_type,
                    "confidence": conf,
                    "bbox_x": dx,
                    "bbox_y": dy,
                    "bbox_w": dw,
                    "bbox_h": dh,
                    "severity": "HIGH" if defect_type == "CUT" else "MEDIUM"
                })

                # Draw defect box & label
                cv2.rectangle(annotated, (dx, dy), (dx + dw, dy + dh), color, 2)
                label = f"{defect_type} ({int(conf * 100)}%)"
                cv2.putText(
                    annotated,
                    label,
                    (dx, dy - 6),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    color,
                    2,
                )

        # Grading logic: 0 cut/hole = PASS, >=1 cut/hole = REJECT
        grade = "PASS" if len(defects) == 0 else "REJECT"
        self.hide_counter += 1
        hide_id = f"HIDE-{self.hide_counter}"

        # Overlay Banner
        banner_color = (0, 180, 0) if grade == "PASS" else (0, 0, 220)
        cv2.rectangle(annotated, (10, 10), (320, 55), (0, 0, 0), -1)
        cv2.putText(
            annotated,
            f"{hide_id} | STATUS: {grade}",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            banner_color,
            2,
        )

        hide_data = {
            "hide_id": hide_id,
            "plant_id": plant_id,
            "grade": grade,
            "defects": defects,
        }

        # Log payload to Backend asynchronously
        try:
            requests.post(
                BACKEND_API_URL,
                json={
                    "hide_id": hide_id,
                    "plant_id": plant_id,
                    "defects": defects,
                },
                timeout=0.5,
            )
        except Exception:
            pass  # Non-blocking log

        return annotated, hide_data


def run_simulated_stream(video_source: int = 0):
    """Run simulated video detection stream."""
    detector = PlaceholderDefectDetector()
    cap = cv2.VideoCapture(video_source)

    if not cap.isOpened():
        # Fallback to synthetic generated frame if video capture fails
        print("📹 Local video source unavailable. Generating synthetic conveyor frame...")
        while True:
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(
                frame,
                "Simulated Conveyor Feed",
                (180, 240),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (255, 255, 255),
                2,
            )
            annotated, data = detector.process_frame(frame)
            cv2.imshow("Leather Defect Detector (Placeholder)", annotated)
            if cv2.waitKey(1000) & 0xFF == ord('q'):
                break
        return

    print("🎥 Starting Leather Defect Detection Feed...")
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # Loop video
            continue

        annotated, data = detector.process_frame(frame)
        cv2.imshow("Leather Defect Detector (Placeholder)", annotated)

        if cv2.waitKey(30) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    run_simulated_stream()
