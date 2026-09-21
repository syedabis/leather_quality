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
