# Implementation Plan: Leather Cut & Hole Defect Detection System

## 🎯 Executive Overview

This plan outlines the architectural and codebase transformation required to convert the **Spray Plant Monitoring System** into an **AI-powered Leather Defect Inspection System**. 

The updated system will monitor conveyor belts via top-down cameras, track moving leather hides, and detect surface defects—specifically **cuts, holes, tears, and surface blemishes**—in real-time. It will grade each leather hide (e.g., *Grade A*, *Grade B*, *Rejected/Scrap*), log defect bounding boxes and severity metrics to SQL Server, and provide a live visual quality inspection interface on the Next.js dashboard.

---

## 🏗 System Architecture

```mermaid
flowchart TD
    subgraph Camera & Conveyor
        C[Top-Down Camera / RTSP] --> IC[inference-client]
    end

    subgraph Edge AI (inference-client)
        IC --> Y1[YOLO Hide Detector & Tracker]
        IC --> Y2[YOLO Defect Segmentation/Detection]
        Y1 & Y2 --> DP[Defect Processor & Quality Grader]
    end

    subgraph Data & Services
        DP --> DB[(SQL Server)]
        DP -- Live Annotations / WS --> BE[FastAPI Backend]
        BE --> DB
    end

    subgraph Quality Control UI
        BE -- REST + WebSockets --> FE[Next.js Dashboard]
        FE --> UI1[Live Defect Inspector]
        FE --> UI2[Quality Yield & Defect Reports]
    end
```

---

## 📊 Summary of System Changes

| System Component | Added Features | Modified Features | Removed / Deprecated Features |
| :--- | :--- | :--- | :--- |
| **`inference-client/`** | • Fine-tuned Cut & Hole Detection Model (YOLOv8/v11-seg or detect)<br>• Per-hide ROI Defect Segmentation<br>• Hide Quality Grading Logic (Pass/Grade B/Reject) based on cut count & area | • `run_all_plants.py` updated to stream frames with defect bounding boxes<br>• Frame tracking matches cuts/holes to specific moving hide IDs | • Spray-arm shape triggers (`WASHING`, `COLOR_MATCHING` modes)<br>• Spray nozzle utilization calculation |
| **`backend/`** | • `dbo.HideDefects` table (logs cut/hole type, confidence, bounding box, severity)<br>• `dbo.HideQualitySummary` table (per-piece yield %, grade, cut count)<br>• Quality Analytics Endpoints (`/api/quality/yield`, `/api/quality/defect-heatmap`) | • `/ws/plant_feed` to push live frame overlays with red cut/hole annotations<br>• Daily summary & email reports updated to include defect yield rates & rejection reasons | • Spray plant specific shift & nozzle timing watchdogs |
| **`dashboard/`** | • **Live Quality Inspector**: Real-time camera feed with bounding boxes around cuts & holes<br>• **Defect Breakdown Analytics**: Cut vs. Hole vs. Blemish Pareto charts<br>• **Hide History & Defect Gallery**: Visual inspect log for flagged/rejected hides | • `monitoring/page.tsx` reimagined as **Conveyor Quality Inspection Grid**<br>• `reports/page.tsx` updated with Yield %, Scrap %, and Defect Rate breakdown | • Spray-matching and spray-plant specific controls |

---

## 📁 Component-by-Component Transition Plan

### 1. `inference-client/` (Computer Vision & Edge AI)

* **Dual-Stage or Unified YOLO Pipeline**:
  * **Stage 1 (Hide Detection & Tracking)**: Detects the overall contour/bounding box of the leather hide on the conveyor using ByteTrack/DeepSORT so every piece receives a unique `hide_id`.
  * **Stage 2 (Defect Classifier & Segmenter)**: Inspects the surface inside the hide boundary for:
    * `cut`: Linear cuts, knife marks, or slicing damage.
    * `hole`: Punctures, missing material, or machine holes.
    * `tear`: Edge rips or jagged tears.
* **Hide Quality Grading Engine**:
  * Assigns quality grades per hide:
    * **Grade A (Premium)**: 0 cuts/holes.
    * **Grade B (Standard)**: 1–2 minor surface defects.
    * **Reject / Scrap**: 3+ cuts/holes or severe structural hole.
* **Output Stream & Storage**:
  * Saves annotated thumbnails of rejected hides to local disk/outbox buffer.
  * Pushes frame overlays to backend WebSocket for live browser streaming.

---

### 2. `backend/` (FastAPI & SQL Server Schema)

* **Database Schema Migration (`app/db/schema.py`)**:
  * New Table **`dbo.HideQualitySummary`**:
    * `HideID` (GUID/BigInt), `PlantID` (Conveyor ID), `LotNo`, `Timestamp`, `PieceNumber`, `Grade` (`GRADE_A`, `GRADE_B`, `REJECT`), `TotalCuts`, `TotalHoles`, `DefectAreaPct`, `Status`.
  * New Table **`dbo.HideDefects`**:
    * `DefectID`, `HideID`, `DefectType` (`CUT`, `HOLE`, `TEAR`), `Confidence`, `BBoxX`, `BBoxY`, `BBoxWidth`, `BBoxHeight`, `AreaCm2`.
* **New REST & WebSocket API Routers**:
  * `GET /api/quality/summary`: Real-time yield rate %, pass rate %, defect counts for current shift/lot.
  * `GET /api/quality/defects-by-type`: Aggregate breakdown (e.g. 60% Cuts, 30% Holes, 10% Tears).
  * `GET /api/quality/hide/{hide_id}`: Full defect breakdown and thumbnail image for a specific hide.
  * `WS /ws/quality_feed`: High-speed WebSocket streaming hide tracking and defect coordinates to the UI.

---

### 3. `dashboard/` (Next.js Quality Control Frontend)

* **Live Inspection View (`app/monitoring/page.tsx`)**:
  * Displays live camera feeds for each conveyor line with visual bounding boxes (Red for Cuts, Amber for Holes, Green for Clear Hides).
  * Real-time counters: **Passed Hides**, **Flagged Hides**, **Yield %**.
* **Defect Gallery & Inspector (`app/defects/page.tsx`)**:
  * A gallery of flagged hides allowing quality control engineers to visually verify detected cuts/holes.
* **Quality Reports Page (`app/reports/page.tsx`)**:
  * Shift-wise and Lot-wise defect reports, downloadable as PDF/Excel with defect distribution graphs.

---

## 🗓️ Implementation Roadmap

1. **Phase 1: Database & Core Models** (Schema migration for `HideQualitySummary` & `HideDefects`, FastAPI quality endpoints).
2. **Phase 2: Inference Client Integration** (YOLO Cut/Hole defect detection model integration & hide tracking logic).
3. **Phase 3: Dashboard UI Transformation** (Live Quality Inspection Grid, Defect Gallery & Yield Analytics).
4. **Phase 4: Calibration & Verification** (Simulated conveyor stream testing & defect bounding box overlay verification).

---

## ❓ Key Questions / Feedback Needed

1. **Defect Types**: Are **Cuts** and **Holes** the primary defect classes, or should we also include **Tears**, **Scars**, or **Surface Blemishes**?
2. **Grading Rules**: What criteria should define a **Pass (Grade A)** vs **Grade B** vs **Reject** hide (e.g. maximum allowed cuts, maximum hole size)?
3. **Camera Setup**: Will you be using RTSP IP Cameras or USB Webcams above the conveyor line?
