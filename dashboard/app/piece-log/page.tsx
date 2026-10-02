"use client";

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import Link from 'next/link';
import {
  FiSearch, FiFilter, FiDownload, FiRefreshCw, FiEye, FiX,
  FiChevronLeft, FiChevronRight, FiCheckCircle, FiAlertTriangle,
  FiFileText, FiSliders, FiArrowUpRight, FiLayers
} from 'react-icons/fi';
import { API_URL } from '../../lib/constants';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DefectItem {
  code: string;
  name: string;
  color: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  x: number;
  y: number;
  len?: number;
  radius?: number;
}

interface PieceRecord {
  hide_id: string;
  plant_id: string;
  lot_no: string;
  piece_number: number;
  grade: string;
  area_sqm: number;
  brightness_from_target: number;
  thickness_mm: number;
  scan_timestamp: string;
  total_defects: number;
  status: 'PASS' | 'REJECT';
  defects: DefectItem[];
  rawImage?: string;
  resultImage?: string;
}

// ── Mock Initial Dataset ──────────────────────────────────────────────────────

const MOCK_PIECES: PieceRecord[] = [
  {
    hide_id: "FRAME-01-CUTS",
    plant_id: "DESK-01",
    lot_no: "LOT-2026-1001",
    piece_number: 1,
    grade: "REJECT",
    area_sqm: 4.75,
    brightness_from_target: -48.0,
    thickness_mm: 1.88,
    scan_timestamp: "2026-10-02T16:25:00Z",
    total_defects: 4,
    status: "REJECT",
    rawImage: "/cuts/raw/Frame 1.png",
    resultImage: "/cuts/cuts identified/Frame 1.png",
    defects: [
      { code: "C", name: "Cut Mark", color: "#06b6d4", severity: "HIGH", x: 0.42, y: 0.35, len: 55 },
      { code: "H", name: "Hole Void", color: "#7c3aed", severity: "HIGH", x: 0.65, y: 0.50, radius: 18 },
      { code: "DHS", name: "Deep Scratch", color: "#d946ef", severity: "HIGH", x: 0.28, y: 0.60, len: 40 },
    ]
  },
  {
    hide_id: "FRAME-02-CUTS",
    plant_id: "DESK-02",
    lot_no: "LOT-2026-1001",
    piece_number: 2,
    grade: "C",
    area_sqm: 4.60,
    brightness_from_target: -32.0,
    thickness_mm: 1.90,
    scan_timestamp: "2026-10-02T16:20:00Z",
    total_defects: 2,
    status: "REJECT",
    rawImage: "/cuts/raw/Frame 2.png",
    resultImage: "/cuts/cuts identified/Frame 2.png",
    defects: [
      { code: "C", name: "Cut Mark", color: "#06b6d4", severity: "HIGH", x: 0.50, y: 0.45, len: 48 },
      { code: "LG", name: "Light Grain", color: "#84cc16", severity: "LOW", x: 0.30, y: 0.25, len: 35 },
    ]
  },
  {
    hide_id: "HIDE-1042",
    plant_id: "SP-01",
    lot_no: "LOT-2026-0922",
    piece_number: 42,
    grade: "C",
    area_sqm: 4.56,
    brightness_from_target: -42.0,
    thickness_mm: 1.85,
    scan_timestamp: "2026-10-02T13:40:12Z",
    total_defects: 14,
    status: "REJECT",
    defects: [
      { code: "C", name: "Cut", color: "#06b6d4", severity: "HIGH", x: 0.32, y: 0.18, len: 45 },
      { code: "C", name: "Cut", color: "#06b6d4", severity: "HIGH", x: 0.68, y: 0.24, len: 38 },
      { code: "H", name: "Hole", color: "#7c3aed", severity: "HIGH", x: 0.72, y: 0.78, radius: 14 },
      { code: "LG", name: "Light Grain", color: "#84cc16", severity: "LOW", x: 0.28, y: 0.12, len: 65 },
      { code: "HG", name: "Heavy Grain", color: "#22c55e", severity: "LOW", x: 0.15, y: 0.35, len: 40 },
    ]
  },
  {
    hide_id: "HIDE-1043",
    plant_id: "SP-01",
    lot_no: "LOT-2026-0922",
    piece_number: 43,
    grade: "A",
    area_sqm: 4.82,
    brightness_from_target: 3.5,
    thickness_mm: 1.92,
    scan_timestamp: "2026-10-02T13:38:05Z",
    total_defects: 0,
    status: "PASS",
    defects: []
  },
  {
    hide_id: "HIDE-1044",
    plant_id: "SP-02",
    lot_no: "LOT-2026-0922",
    piece_number: 44,
    grade: "B",
    area_sqm: 4.35,
    brightness_from_target: -8.2,
    thickness_mm: 1.88,
    scan_timestamp: "2026-10-02T13:35:40Z",
    total_defects: 2,
    status: "PASS",
    defects: [
      { code: "LG", name: "Light Grain", color: "#84cc16", severity: "LOW", x: 0.40, y: 0.30, len: 30 },
      { code: "T", name: "Tick Mark", color: "#eab308", severity: "LOW", x: 0.60, y: 0.50, len: 20 },
    ]
  },
  {
    hide_id: "HIDE-1045",
    plant_id: "SP-01",
    lot_no: "LOT-2026-0923",
    piece_number: 45,
    grade: "A",
    area_sqm: 5.10,
    brightness_from_target: 1.2,
    thickness_mm: 1.95,
    scan_timestamp: "2026-10-02T13:30:15Z",
    total_defects: 0,
    status: "PASS",
    defects: []
  },
  {
    hide_id: "HIDE-1046",
    plant_id: "SP-03",
    lot_no: "LOT-2026-0923",
    piece_number: 46,
    grade: "REJECT",
    area_sqm: 3.90,
    brightness_from_target: -55.0,
    thickness_mm: 1.70,
    scan_timestamp: "2026-10-02T13:25:00Z",
    total_defects: 8,
    status: "REJECT",
    defects: [
      { code: "RHS", name: "Right Side Flaw", color: "#dc2626", severity: "HIGH", x: 0.20, y: 0.40, len: 60 },
      { code: "DHS", name: "Deep Scratch", color: "#d946ef", severity: "HIGH", x: 0.80, y: 0.60, len: 50 },
      { code: "H", name: "Hole", color: "#7c3aed", severity: "HIGH", x: 0.50, y: 0.70, radius: 16 },
    ]
  },
  {
    hide_id: "HIDE-1047",
    plant_id: "SP-02",
    lot_no: "LOT-2026-0923",
    piece_number: 47,
    grade: "B",
    area_sqm: 4.65,
    brightness_from_target: -11.0,
    thickness_mm: 1.86,
    scan_timestamp: "2026-10-02T13:20:18Z",
    total_defects: 3,
    status: "PASS",
    defects: [
      { code: "NW", name: "Natural Wrinkle", color: "#0d9488", severity: "LOW", x: 0.45, y: 0.25, len: 35 },
      { code: "P", name: "Pinhole", color: "#10b981", severity: "LOW", x: 0.55, y: 0.75, len: 15 },
    ]
  },
  {
    hide_id: "HIDE-1048",
    plant_id: "SP-01",
    lot_no: "LOT-2026-0924",
    piece_number: 48,
    grade: "A",
    area_sqm: 4.95,
    brightness_from_target: 2.1,
    thickness_mm: 1.90,
    scan_timestamp: "2026-10-02T13:15:30Z",
    total_defects: 0,
    status: "PASS",
    defects: []
  },
  {
    hide_id: "HIDE-1049",
    plant_id: "SP-02",
    lot_no: "LOT-2026-0924",
    piece_number: 49,
    grade: "C",
    area_sqm: 4.20,
    brightness_from_target: -38.5,
    thickness_mm: 1.82,
    scan_timestamp: "2026-10-02T13:10:00Z",
    total_defects: 6,
    status: "REJECT",
    defects: [
      { code: "C", name: "Cut", color: "#06b6d4", severity: "HIGH", x: 0.35, y: 0.55, len: 40 },
      { code: "CR", name: "Crack", color: "#854d0e", severity: "MEDIUM", x: 0.65, y: 0.45, len: 30 },
    ]
  }
];

// ── Mini Leather Thumbnail Component ──────────────────────────────────────────

function MiniHideThumbnail({ defects, grade }: { defects: DefectItem[]; grade: string }) {
  const strokeColor = grade === 'A' ? '#22c55e' : grade === 'B' ? '#06b6d4' : grade === 'C' ? '#f59e0b' : '#ef4444';
  return (
    <div className="w-12 h-14 bg-gray-900 rounded-lg p-1 border border-gray-800 flex items-center justify-center relative shadow-sm">
      <svg viewBox="0 0 500 600" className="w-full h-full">
        <path
          d="M 250,45 C 280,48 310,65 325,95 C 340,125 320,155 365,170 C 410,185 455,200 460,265 C 465,330 435,370 445,415 C 455,460 415,505 375,525 C 335,545 305,530 250,555 C 195,530 165,545 125,525 C 85,505 45,460 55,415 C 65,370 35,330 40,265 C 45,200 90,185 135,170 C 180,155 160,125 175,95 C 190,65 220,48 250,45 Z"
          fill="#161616"
          stroke={strokeColor}
          strokeWidth="12"
        />
        {defects.map((d, i) => (
          <circle key={i} cx={d.x * 500} cy={d.y * 600} r="24" fill={d.color || '#ef4444'} />
        ))}
      </svg>
    </div>
  );
}

// ── Main Page Component ───────────────────────────────────────────────────────

export default function PieceLogPage() {
  const [records, setRecords] = useState<PieceRecord[]>(MOCK_PIECES);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGrade, setSelectedGrade] = useState<string>('ALL');
  const [selectedResult, setSelectedResult] = useState<string>('ALL');
  const [selectedDefectCode, setSelectedDefectCode] = useState<string>('ALL');
  const [selectedRecord, setSelectedRecord] = useState<PieceRecord | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Fetch online telemetry if backend available
  useEffect(() => {
    const fetchOnlinePieces = async () => {
      try {
        const res = await fetch(`${API_URL}/api/quality/pieces`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            const formatted: PieceRecord[] = data.map((p: any) => ({
              ...p,
              status: (p.defects?.some((d: any) => d.code === 'C' || d.code === 'H' || d.code === 'RHS') || p.grade === 'REJECT') ? 'REJECT' : 'PASS'
            }));
            setRecords(formatted);
          }
        }
      } catch (e) {
        // Fallback to MOCK_PIECES
      }
    };
    fetchOnlinePieces();
  }, []);

  // Filtered dataset
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const matchSearch =
        searchQuery === '' ||
        r.hide_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.lot_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.plant_id.toLowerCase().includes(searchQuery.toLowerCase());

      const matchGrade = selectedGrade === 'ALL' || r.grade === selectedGrade;
      const matchResult = selectedResult === 'ALL' || r.status === selectedResult;
      const matchDefect =
        selectedDefectCode === 'ALL' ||
        r.defects.some(d => d.code === selectedDefectCode);

      return matchSearch && matchGrade && matchResult && matchDefect;
    });
  }, [records, searchQuery, selectedGrade, selectedResult, selectedDefectCode]);

  // Paginated records
  const totalPages = Math.ceil(filteredRecords.length / pageSize) || 1;
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  // Summary counts
  const passedCount = records.filter(r => r.status === 'PASS').length;
  const rejectedCount = records.filter(r => r.status === 'REJECT').length;
  const passRate = records.length ? Math.round((passedCount / records.length) * 100) : 100;

  // CSV Export
  const exportCSV = () => {
    const headers = ['Hide ID', 'Plant ID', 'Lot No', 'Piece No', 'Grade', 'Status', 'Area (sqm)', 'Thickness (mm)', 'Brightness Delta', 'Defects Count', 'Timestamp'];
    const rows = filteredRecords.map(r => [
      r.hide_id,
      r.plant_id,
      r.lot_no,
      r.piece_number,
      r.grade,
      r.status,
      r.area_sqm,
      r.thickness_mm,
      `${r.brightness_from_target}%`,
      r.total_defects,
      r.scan_timestamp
    ]);
    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `WorkingDesk_Inspection_Log_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0d0d0d] overflow-y-auto p-5 font-[family-name:var(--font-roboto)]">

      {/* ── Page Header ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-6 py-4 shadow-sm mb-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-500 font-bold text-lg">
            <FiFileText />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white font-[family-name:var(--font-inter-tight)] tracking-tight">
              Working Desk Hide Inspection Log
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Complete tabular audit log of scanned leather hides, defect codes & specs
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs rounded-xl shadow-md transition-all"
          >
            <FiDownload className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </motion.div>

      {/* ── KPI Summary Cards ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] text-gray-500 font-medium uppercase">Total Inspected</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">
            {records.length} <span className="text-xs font-normal text-gray-500">Hides</span>
          </p>
        </div>

        <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium uppercase">Pass Rate</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">
            {passRate}% <span className="text-xs font-normal text-gray-500">({passedCount} Passed)</span>
          </p>
        </div>

        <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] text-rose-600 dark:text-rose-400 font-medium uppercase">Rejections</p>
          <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1 tabular-nums">
            {rejectedCount} <span className="text-xs font-normal text-gray-500">Hides</span>
          </p>
        </div>

        <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-4 shadow-sm">
          <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium uppercase">Defects Logged</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
            {records.reduce((s, r) => s + r.total_defects, 0)} <span className="text-xs font-normal text-gray-500">Events</span>
          </p>
        </div>
      </div>

      {/* ── Filter & Search Controls ─────────────────────────────────── */}
      <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-4 shadow-sm mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          
          {/* Search bar */}
          <div className="relative lg:col-span-2">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search Hide ID, Lot #..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Grade filter */}
          <div>
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">All Grades</option>
              <option value="A">Grade A</option>
              <option value="B">Grade B</option>
              <option value="C">Grade C</option>
              <option value="REJECT">Reject</option>
            </select>
          </div>

          {/* Result filter */}
          <div>
            <select
              value={selectedResult}
              onChange={(e) => setSelectedResult(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">All Results</option>
              <option value="PASS">Pass Only</option>
              <option value="REJECT">Reject Only</option>
            </select>
          </div>

          {/* Defect Code filter */}
          <div>
            <select
              value={selectedDefectCode}
              onChange={(e) => setSelectedDefectCode(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-[#111111] border border-gray-200 dark:border-[#2c2c2c] rounded-xl text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">All Defect Codes</option>
              <option value="C">Cut (C)</option>
              <option value="H">Hole (H)</option>
              <option value="RHS">Right Flaw (RHS)</option>
              <option value="DHS">Deep Scratch (DHS)</option>
              <option value="LG">Light Grain (LG)</option>
            </select>
          </div>

        </div>
      </div>

      {/* ── Main Data Table ──────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl shadow-sm overflow-hidden mb-5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-100 dark:bg-[#151515] border-b border-gray-200 dark:border-[#2c2c2c] text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider">
                <th className="py-3 px-4">Raw Image</th>
                <th className="py-3 px-4">Final Result</th>
                <th className="py-3 px-4">Hide ID & Lot</th>
                <th className="py-3 px-4">Scan Time</th>
                <th className="py-3 px-4">Grade</th>
                <th className="py-3 px-4">Specs (Area / Thickness)</th>
                <th className="py-3 px-4">Defects Breakdown</th>
                <th className="py-3 px-4 text-center">Result</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#262626]">
              {paginatedRecords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-gray-400">
                    No hide inspection logs found matching your filters.
                  </td>
                </tr>
              ) : (
                paginatedRecords.map((r) => {
                  const dateStr = format(new Date(r.scan_timestamp), 'dd MMM yyyy, HH:mm:ss');
                  return (
                    <tr
                      key={r.hide_id}
                      className="hover:bg-gray-50/80 dark:hover:bg-[#202020] transition-colors group cursor-pointer"
                      onClick={() => setSelectedRecord(r)}
                    >
                      {/* Raw Image Column */}
                      <td className="py-3 px-4">
                        {r.rawImage ? (
                          <div className="relative w-20 h-14 rounded-lg bg-black overflow-hidden border border-gray-700 shadow-sm group-hover:border-gray-500 transition-all">
                            <img src={r.rawImage} alt="Raw Scan" className="w-full h-full object-cover" />
                            <span className="absolute bottom-0.5 left-0.5 bg-black/80 text-[8px] font-extrabold text-gray-300 px-1 rounded border border-white/10">
                              RAW
                            </span>
                          </div>
                        ) : (
                          <MiniHideThumbnail defects={r.defects} grade={r.grade} />
                        )}
                      </td>

                      {/* Final Result Column */}
                      <td className="py-3 px-4">
                        {r.resultImage ? (
                          <div className="relative w-20 h-14 rounded-lg bg-black overflow-hidden border border-emerald-500/60 shadow-sm group-hover:border-emerald-400 transition-all">
                            <img src={r.resultImage} alt="Final AI Result" className="w-full h-full object-cover" />
                            <span className="absolute bottom-0.5 left-0.5 bg-emerald-500 text-[8px] font-black text-black px-1 rounded shadow uppercase">
                              CUTS
                            </span>
                          </div>
                        ) : (
                          <MiniHideThumbnail defects={r.defects} grade={r.grade} />
                        )}
                      </td>

                      {/* Hide ID & Lot */}
                      <td className="py-3 px-4">
                        <p className="font-bold text-gray-900 dark:text-white text-sm group-hover:text-emerald-500 transition-colors">
                          {r.hide_id}
                        </p>
                        <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                          {r.lot_no} • #{r.piece_number}
                        </p>
                      </td>

                      {/* Scan Time */}
                      <td className="py-3 px-4 text-gray-600 dark:text-gray-300 tabular-nums">
                        {dateStr}
                      </td>

                      {/* Grade Badge */}
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-1 rounded-full font-extrabold text-xs inline-block ${
                          r.grade === 'A' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' :
                          r.grade === 'B' ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20' :
                          r.grade === 'C' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' :
                          'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                        }`}>
                          Grade {r.grade}
                        </span>
                      </td>

                      {/* Area & Thickness */}
                      <td className="py-3 px-4 text-gray-700 dark:text-gray-200">
                        <p className="font-semibold">{r.area_sqm.toFixed(2)} m²</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{r.thickness_mm.toFixed(2)} mm caliper</p>
                      </td>

                      {/* Defects Breakdown */}
                      <td className="py-3 px-4">
                        {r.defects.length === 0 ? (
                          <span className="text-emerald-500 font-medium">Clean Hide (0 defects)</span>
                        ) : (
                          <div className="flex items-center gap-1 flex-wrap">
                            {r.defects.slice(0, 3).map((d, i) => (
                              <span
                                key={i}
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                                style={{ backgroundColor: `${d.color}25`, color: d.color, border: `1px solid ${d.color}40` }}
                              >
                                {d.code}
                              </span>
                            ))}
                            {r.defects.length > 3 && (
                              <span className="text-[10px] text-gray-400 font-semibold">
                                +{r.defects.length - 3} more
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Result Pill */}
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2.5 py-1 rounded-full font-bold text-[11px] ${
                          r.status === 'PASS'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                        }`}>
                          {r.status}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setSelectedRecord(r)}
                          className="px-3 py-1.5 bg-gray-100 dark:bg-[#252525] hover:bg-emerald-500 hover:text-black dark:hover:bg-emerald-500 dark:hover:text-black font-semibold rounded-lg transition-colors text-xs inline-flex items-center gap-1"
                        >
                          <FiEye className="w-3.5 h-3.5" /> Details
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer / Pagination Controls */}
        <div className="px-4 py-3 bg-gray-50 dark:bg-[#151515] border-t border-gray-200 dark:border-[#2c2c2c] flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Showing <span className="font-semibold text-gray-700 dark:text-gray-200">{filteredRecords.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}</span> to{' '}
            <span className="font-semibold text-gray-700 dark:text-gray-200">{Math.min(currentPage * pageSize, filteredRecords.length)}</span> of{' '}
            <span className="font-semibold text-gray-700 dark:text-gray-200">{filteredRecords.length}</span> records
          </p>

          <div className="flex items-center gap-2">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              className="p-1.5 rounded-lg border border-gray-200 dark:border-[#2c2c2c] disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-[#252525] transition-colors"
            >
              <FiChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold px-2 text-gray-700 dark:text-gray-300">
              Page {currentPage} of {totalPages}
            </span>
            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
              className="p-1.5 rounded-lg border border-gray-200 dark:border-[#2c2c2c] disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-[#252525] transition-colors"
            >
              <FiChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Slide-over Detail Drawer ─────────────────────────────────── */}
      <AnimatePresence>
        {selectedRecord && (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 250 }}
              className="w-full max-w-lg bg-white dark:bg-[#141414] h-full shadow-2xl p-6 overflow-y-auto flex flex-col justify-between border-l border-gray-200 dark:border-[#2c2c2c]"
            >
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-[#2c2c2c] mb-5">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                      {selectedRecord.hide_id}
                    </h2>
                    <p className="text-xs text-gray-500 font-mono mt-0.5">
                      Lot {selectedRecord.lot_no} • Piece #{selectedRecord.piece_number}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedRecord(null)}
                    className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-[#222]"
                  >
                    <FiX className="w-5 h-5" />
                  </button>
                </div>

                {/* Hide Preview or Side-by-Side Image Comparison */}
                {selectedRecord.rawImage && selectedRecord.resultImage ? (
                  <div className="space-y-2 mb-5">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase">
                          <span>Raw Image</span>
                          <span className="text-gray-500">Unannotated</span>
                        </div>
                        <div className="bg-black rounded-xl overflow-hidden border border-gray-700 aspect-video relative shadow-md">
                          <img src={selectedRecord.rawImage} alt="Raw Scan" className="w-full h-full object-cover" />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-extrabold text-emerald-400 uppercase">
                          <span>Final Result</span>
                          <span className="text-emerald-500">Cuts Identified</span>
                        </div>
                        <div className="bg-black rounded-xl overflow-hidden border border-emerald-500/60 aspect-video relative shadow-md">
                          <img src={selectedRecord.resultImage} alt="Final Result" className="w-full h-full object-cover" />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-900 rounded-2xl p-4 mb-5 flex items-center justify-center relative border border-gray-800">
                    <div className="w-48 h-56 relative">
                      <svg viewBox="0 0 500 600" className="w-full h-full">
                        <path
                          d="M 250,45 C 280,48 310,65 325,95 C 340,125 320,155 365,170 C 410,185 455,200 460,265 C 465,330 435,370 445,415 C 455,460 415,505 375,525 C 335,545 305,530 250,555 C 195,530 165,545 125,525 C 85,505 45,460 55,415 C 65,370 35,330 40,265 C 45,200 90,185 135,170 C 180,155 160,125 175,95 C 190,65 220,48 250,45 Z"
                          fill="#1a1a1a"
                          stroke="#2aaa8a"
                          strokeWidth="8"
                        />
                        {selectedRecord.defects.map((d, i) => (
                          <g key={i}>
                            <circle cx={d.x * 500} cy={d.y * 600} r="16" fill={d.color} />
                            <text x={d.x * 500} y={d.y * 600 + 5} fill="#ffffff" fontSize="18" fontWeight="bold" textAnchor="middle">
                              {d.code}
                            </text>
                          </g>
                        ))}
                      </svg>
                    </div>
                  </div>
                )}

                {/* Grade & Status */}
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div className="bg-gray-50 dark:bg-[#1a1a1a] p-3 rounded-xl border border-gray-200 dark:border-[#2a2a2a]">
                    <p className="text-[10px] text-gray-500 uppercase font-medium">Grade</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white mt-1">
                      Grade {selectedRecord.grade}
                    </p>
                  </div>
                  <div className="bg-gray-50 dark:bg-[#1a1a1a] p-3 rounded-xl border border-gray-200 dark:border-[#2a2a2a]">
                    <p className="text-[10px] text-gray-500 uppercase font-medium">Result</p>
                    <p className={`text-xl font-bold mt-1 ${selectedRecord.status === 'PASS' ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {selectedRecord.status}
                    </p>
                  </div>
                </div>

                {/* Defects Table */}
                <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">
                  Defect Items ({selectedRecord.defects.length})
                </h3>
                <div className="space-y-2 mb-6">
                  {selectedRecord.defects.length === 0 ? (
                    <p className="text-xs text-gray-400 py-2">No defects recorded on this piece.</p>
                  ) : (
                    selectedRecord.defects.map((d, i) => (
                      <div key={i} className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-xl text-xs">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded font-bold" style={{ backgroundColor: `${d.color}25`, color: d.color }}>
                            {d.code}
                          </span>
                          <span className="font-semibold text-gray-900 dark:text-white">{d.name}</span>
                        </div>
                        <span className="text-[10px] text-gray-400 uppercase font-bold">{d.severity}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-gray-200 dark:border-[#2c2c2c]">
                <Link
                  href="/piece-view"
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
                >
                  <FiArrowUpRight className="w-4 h-4" /> Open in Interactive Piece View
                </Link>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
