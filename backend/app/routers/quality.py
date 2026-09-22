"""
Quality router for Leather Defect Inspection (Cuts & Holes).
"""
import random
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/quality", tags=["quality"])

# In-memory storage fallback for defects & quality stats
_QUALITY_SUMMARY = {
    "total_inspected": 142,
    "passed": 128,
    "rejected": 14,
    "total_cuts": 9,
    "total_holes": 7,
    "pass_rate_pct": 90.1,
}

_RECENT_DEFECTS = [
    {
        "id": 1,
        "hide_id": "HIDE-1042",
        "plant_id": "SP-01",
        "defect_type": "CUT",
        "confidence": 0.94,
        "bbox": [120, 180, 45, 12],
        "severity": "HIGH",
        "timestamp": datetime.now().isoformat(),
        "grade": "REJECT",
    },
    {
        "id": 2,
        "hide_id": "HIDE-1039",
        "plant_id": "SP-01",
        "defect_type": "HOLE",
        "confidence": 0.88,
        "bbox": [310, 220, 25, 25],
        "severity": "MEDIUM",
        "timestamp": datetime.now().isoformat(),
        "grade": "REJECT",
    },
    {
        "id": 3,
        "hide_id": "HIDE-1035",
        "plant_id": "SP-02",
        "defect_type": "CUT",
        "confidence": 0.91,
        "bbox": [85, 140, 60, 15],
        "severity": "HIGH",
        "timestamp": datetime.now().isoformat(),
        "grade": "REJECT",
    }
]

class DefectItem(BaseModel):
    defect_type: str  # 'CUT' or 'HOLE'
    confidence: float
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float
    severity: Optional[str] = "MEDIUM"

class LogHideInspection(BaseModel):
    hide_id: str
    plant_id: str
    lot_no: Optional[str] = None
    piece_number: int = 1
    defects: List[DefectItem] = []


@router.get("/summary")
def get_quality_summary(plant_id: Optional[str] = None):
    """Returns overall defect & pass rate summary."""
    total = _QUALITY_SUMMARY["total_inspected"]
    passed = _QUALITY_SUMMARY["passed"]
    rejected = _QUALITY_SUMMARY["rejected"]
    pass_rate = round((passed / total * 100), 1) if total > 0 else 100.0

    return {
        "plant_id": plant_id or "ALL",
        "total_inspected": total,
        "passed": passed,
        "rejected": rejected,
        "total_cuts": _QUALITY_SUMMARY["total_cuts"],
        "total_holes": _QUALITY_SUMMARY["total_holes"],
        "pass_rate_pct": pass_rate,
        "grading_rule": "0 cut/hole per hide (Pass), >=1 cut/hole (Reject)"
    }


@router.get("/defects")
def get_recent_defects(limit: int = 20):
    """Returns recent defect detections."""
    return _RECENT_DEFECTS[:limit]


@router.post("/log-hide")
def log_hide(data: LogHideInspection):
    """Log an inspected hide from the camera inference system."""
    cuts = sum(1 for d in data.defects if d.defect_type.upper() == "CUT")
    holes = sum(1 for d in data.defects if d.defect_type.upper() == "HOLE")
    total_defects = cuts + holes

    # Strict rule: 0 cuts/holes = PASS, 1+ cuts/holes = REJECT
    grade = "PASS" if total_defects == 0 else "REJECT"

    _QUALITY_SUMMARY["total_inspected"] += 1
    if grade == "PASS":
        _QUALITY_SUMMARY["passed"] += 1
    else:
        _QUALITY_SUMMARY["rejected"] += 1

    _QUALITY_SUMMARY["total_cuts"] += cuts
    _QUALITY_SUMMARY["total_holes"] += holes

    if total_defects > 0:
        for d in data.defects:
            _RECENT_DEFECTS.insert(0, {
                "id": len(_RECENT_DEFECTS) + 1,
                "hide_id": data.hide_id,
                "plant_id": data.plant_id,
                "defect_type": d.defect_type.upper(),
                "confidence": d.confidence,
                "bbox": [d.bbox_x, d.bbox_y, d.bbox_w, d.bbox_h],
                "severity": d.severity or "MEDIUM",
                "timestamp": datetime.now().isoformat(),
                "grade": grade,
            })

    return {
        "status": "success",
        "hide_id": data.hide_id,
        "grade": grade,
        "cuts": cuts,
        "holes": holes,
        "total_defects": total_defects
    }


# Detailed Pieces Mock & Storage for Mindhive / FinishSelect Piece Inspector
_PIECES_DATABASE = [
    {
        "hide_id": "HIDE-1042",
        "plant_id": "SP-01",
        "lot_no": "LOT-2026-0922",
        "piece_number": 42,
        "grade": "C",
        "area_sqm": 4.56,
        "brightness_from_target": -42.0,
        "thickness_mm": 1.85,
        "scan_timestamp": datetime.now().isoformat(),
        "total_defects": 14,
        "defects": [
            {"code": "C", "name": "Cut", "color": "#06b6d4", "severity": "HIGH", "x": 0.32, "y": 0.18, "len": 45},
            {"code": "C", "name": "Cut", "color": "#06b6d4", "severity": "HIGH", "x": 0.68, "y": 0.24, "len": 38},
            {"code": "H", "name": "Hole", "color": "#7c3aed", "severity": "HIGH", "x": 0.72, "y": 0.78, "radius": 14},
            {"code": "LG", "name": "Light Grain", "color": "#84cc16", "severity": "LOW", "x": 0.28, "y": 0.12, "len": 65},
            {"code": "LG", "name": "Light Grain", "color": "#84cc16", "severity": "LOW", "x": 0.52, "y": 0.08, "len": 80},
            {"code": "LG", "name": "Light Grain", "color": "#84cc16", "severity": "LOW", "x": 0.44, "y": 0.15, "len": 50},
            {"code": "HG", "name": "Heavy Grain", "color": "#22c55e", "severity": "LOW", "x": 0.15, "y": 0.35, "len": 40},
            {"code": "HG", "name": "Heavy Grain", "color": "#22c55e", "severity": "LOW", "x": 0.22, "y": 0.45, "len": 30},
            {"code": "RHS", "name": "Right Side Flaw", "color": "#dc2626", "severity": "MEDIUM", "x": 0.12, "y": 0.28, "len": 55},
            {"code": "FHS", "name": "Front Side Flaw", "color": "#ec4899", "severity": "MEDIUM", "x": 0.82, "y": 0.42, "len": 35},
            {"code": "DHS", "name": "Deep Hide Scratch", "color": "#d946ef", "severity": "HIGH", "x": 0.88, "y": 0.58, "len": 42},
            {"code": "CR", "name": "Crack", "color": "#854d0e", "severity": "MEDIUM", "x": 0.78, "y": 0.65, "len": 28},
            {"code": "T", "name": "Tick Mark", "color": "#eab308", "severity": "LOW", "x": 0.62, "y": 0.85, "len": 18},
            {"code": "T", "name": "Tick Mark", "color": "#eab308", "severity": "LOW", "x": 0.58, "y": 0.88, "len": 22},
        ]
    },
    {
        "hide_id": "HIDE-1041",
        "plant_id": "SP-02",
        "lot_no": "LOT-2026-0922",
        "piece_number": 41,
        "grade": "A",
        "area_sqm": 5.12,
        "brightness_from_target": 2.5,
        "thickness_mm": 2.10,
        "scan_timestamp": datetime.now().isoformat(),
        "total_defects": 2,
        "defects": [
            {"code": "NW", "name": "Natural Wrinkle", "color": "#0d9488", "severity": "LOW", "x": 0.30, "y": 0.20, "len": 40},
            {"code": "PS", "name": "Pin Spot", "color": "#0284c7", "severity": "LOW", "x": 0.60, "y": 0.50, "radius": 5},
        ]
    },
    {
        "hide_id": "HIDE-1040",
        "plant_id": "SP-01",
        "lot_no": "LOT-2026-0922",
        "piece_number": 40,
        "grade": "B",
        "area_sqm": 4.88,
        "brightness_from_target": -12.4,
        "thickness_mm": 1.95,
        "scan_timestamp": datetime.now().isoformat(),
        "total_defects": 5,
        "defects": [
            {"code": "IB", "name": "Insect Bite", "color": "#ea580c", "severity": "MEDIUM", "x": 0.40, "y": 0.35, "radius": 8},
            {"code": "P", "name": "Pinhole", "color": "#10b981", "severity": "LOW", "x": 0.25, "y": 0.45, "radius": 4},
            {"code": "LG", "name": "Light Grain", "color": "#84cc16", "severity": "LOW", "x": 0.70, "y": 0.30, "len": 55},
            {"code": "T", "name": "Tick Mark", "color": "#eab308", "severity": "LOW", "x": 0.75, "y": 0.60, "len": 20},
            {"code": "PL", "name": "Peeling", "color": "#65a30d", "severity": "MEDIUM", "x": 0.18, "y": 0.72, "len": 30},
        ]
    },
    {
        "hide_id": "HIDE-1039",
        "plant_id": "SP-02",
        "lot_no": "LOT-2026-0922",
        "piece_number": 39,
        "grade": "REJECT",
        "area_sqm": 4.15,
        "brightness_from_target": -28.0,
        "thickness_mm": 1.70,
        "scan_timestamp": datetime.now().isoformat(),
        "total_defects": 9,
        "defects": [
            {"code": "C", "name": "Cut", "color": "#06b6d4", "severity": "HIGH", "x": 0.45, "y": 0.40, "len": 90},
            {"code": "H", "name": "Hole", "color": "#7c3aed", "severity": "HIGH", "x": 0.50, "y": 0.55, "radius": 22},
            {"code": "CCH", "name": "Cattle Brand", "color": "#991b1b", "severity": "HIGH", "x": 0.20, "y": 0.30, "len": 110},
            {"code": "V", "name": "Vein", "color": "#6b21a8", "severity": "MEDIUM", "x": 0.35, "y": 0.65, "len": 75},
            {"code": "DHS", "name": "Deep Hide Scratch", "color": "#d946ef", "severity": "HIGH", "x": 0.65, "y": 0.25, "len": 60},
        ]
    }
]


@router.get("/pieces")
def get_pieces_list(plant_id: Optional[str] = None, limit: int = 20):
    """Returns list of scanned hides/pieces with defect metrics."""
    pieces = _PIECES_DATABASE
    if plant_id and plant_id.upper() != "ALL":
        pieces = [p for p in pieces if p["plant_id"].upper() == plant_id.upper()]
    return pieces[:limit]


@router.get("/pieces/{hide_id}")
def get_piece_detail(hide_id: str):
    """Returns piece inspection details for a specific hide ID."""
    for piece in _PIECES_DATABASE:
        if piece["hide_id"].upper() == hide_id.upper():
            return piece
    # Fallback default piece structure if not found
    return _PIECES_DATABASE[0]

