"use client";

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiMaximize2, FiMinimize2, FiRefreshCw, FiChevronLeft, FiChevronRight,
  FiFilter, FiDownload, FiLayers, FiZap, FiActivity, FiSliders,
  FiCheckCircle, FiAlertTriangle, FiEye, FiCpu
} from 'react-icons/fi';
import { API_URL } from '../../lib/constants';

// Defect code definitions matching Mindhive FinishSelect specification
interface DefectCodeDef {
  code: string;
  name: string;
  color: string;
  textColor: string;
  category: 'critical' | 'surface' | 'grain' | 'natural';
}

const DEFECT_CODES: DefectCodeDef[] = [
  { code: 'H',   name: 'Hole',               color: '#7c3aed', textColor: '#ffffff', category: 'critical' },
  { code: 'IB',  name: 'Insect Bite',        color: '#ea580c', textColor: '#ffffff', category: 'surface'  },
  { code: 'RHS', name: 'Right Side Flaw',    color: '#dc2626', textColor: '#ffffff', category: 'critical' },
  { code: 'FHS', name: 'Front Side Flaw',    color: '#ec4899', textColor: '#ffffff', category: 'critical' },
  { code: 'DHS', name: 'Deep Hide Scratch',  color: '#d946ef', textColor: '#ffffff', category: 'critical' },
  { code: 'C',   name: 'Cut Mark',           color: '#06b6d4', textColor: '#000000', category: 'critical' },
  { code: 'PS',  name: 'Pin Spot',           color: '#0284c7', textColor: '#ffffff', category: 'surface'  },
  { code: 'NW',  name: 'Natural Wrinkle',    color: '#0d9488', textColor: '#ffffff', category: 'natural'  },
  { code: 'P',   name: 'Pinhole / Pox',      color: '#10b981', textColor: '#000000', category: 'surface'  },
  { code: 'LG',  name: 'Light Grain',        color: '#84cc16', textColor: '#000000', category: 'grain'    },
  { code: 'HG',  name: 'Heavy Grain',        color: '#22c55e', textColor: '#000000', category: 'grain'    },
  { code: 'CCH', name: 'Cattle Brand',       color: '#991b1b', textColor: '#ffffff', category: 'critical' },
  { code: 'CR',  name: 'Crack',              color: '#854d0e', textColor: '#ffffff', category: 'surface'  },
  { code: 'T',   name: 'Tick Mark',          color: '#eab308', textColor: '#000000', category: 'natural'  },
  { code: 'V',   name: 'Vein Pattern',       color: '#6b21a8', textColor: '#ffffff', category: 'natural'  },
  { code: 'PL',  name: 'Peeling Flaw',       color: '#65a30d', textColor: '#ffffff', category: 'surface'  },
];

interface DefectItem {
  code: string;
  name: string;
  color: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  x: number; // 0.0 to 1.0 relative
  y: number; // 0.0 to 1.0 relative
  len?: number;
  radius?: number;
}

interface PieceData {
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
  defects: DefectItem[];
}

export default function PieceViewPage() {
  const [pieces, setPieces] = useState<PieceData[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeCodeFilter, setActiveCodeFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'silhouette' | 'heatmap' | 'photo'>('silhouette');
  const [isTvMode, setIsTvMode] = useState(false);
  const [scanAgeSec, setScanAgeSec] = useState(35);
  const [liveAutoCycle, setLiveAutoCycle] = useState(false);

  // Fetch piece inspection telemetry
  useEffect(() => {
    const fetchPieces = async () => {
      try {
        const res = await fetch(`${API_URL}/api/quality/pieces`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setPieces(data);
          }
        }
      } catch (err) {
        console.warn('Failed to load online piece telemetry, using fallback local dataset:', err);
      }
    };
    fetchPieces();
  }, []);

  // Timer for Scan Age
  useEffect(() => {
    const timer = setInterval(() => {
      setScanAgeSec(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto cycle live scanner mode
  useEffect(() => {
    if (!liveAutoCycle || pieces.length === 0) return;
    const cycleTimer = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % pieces.length);
      setScanAgeSec(1);
    }, 8000);
    return () => clearInterval(cycleTimer);
  }, [liveAutoCycle, pieces.length]);

  const currentPiece: PieceData = pieces[currentIndex] || {
    hide_id: "HIDE-1042",
    plant_id: "SP-01",
    lot_no: "LOT-2026-0922",
    piece_number: 42,
    grade: "C",
    area_sqm: 4.56,
    brightness_from_target: -42.0,
    thickness_mm: 1.85,
    scan_timestamp: new Date().toISOString(),
    total_defects: 14,
    defects: [
      { code: "C", name: "Cut", color: "#06b6d4", severity: "HIGH", x: 0.32, y: 0.18, len: 45 },
      { code: "C", name: "Cut", color: "#06b6d4", severity: "HIGH", x: 0.68, y: 0.24, len: 38 },
      { code: "H", name: "Hole", color: "#7c3aed", severity: "HIGH", x: 0.72, y: 0.78, radius: 14 },
      { code: "LG", name: "Light Grain", color: "#84cc16", severity: "LOW", x: 0.28, y: 0.12, len: 65 },
      { code: "LG", name: "Light Grain", color: "#84cc16", severity: "LOW", x: 0.52, y: 0.08, len: 80 },
      { code: "LG", name: "Light Grain", color: "#84cc16", severity: "LOW", x: 0.44, y: 0.15, len: 50 },
      { code: "HG", name: "Heavy Grain", color: "#22c55e", severity: "LOW", x: 0.15, y: 0.35, len: 40 },
      { code: "HG", name: "Heavy Grain", color: "#22c55e", severity: "LOW", x: 0.22, y: 0.45, len: 30 },
      { code: "RHS", name: "Right Side Flaw", color: "#dc2626", severity: "MEDIUM", x: 0.12, y: 0.28, len: 55 },
      { code: "FHS", name: "Front Side Flaw", color: "#ec4899", severity: "MEDIUM", x: 0.82, y: 0.42, len: 35 },
      { code: "DHS", name: "Deep Hide Scratch", color: "#d946ef", severity: "HIGH", x: 0.88, y: 0.58, len: 42 },
      { code: "CR", name: "Crack", color: "#854d0e", severity: "MEDIUM", x: 0.78, y: 0.65, len: 28 },
      { code: "T", name: "Tick Mark", color: "#eab308", severity: "LOW", x: 0.62, y: 0.85, len: 18 },
      { code: "T", name: "Tick Mark", color: "#eab308", severity: "LOW", x: 0.58, y: 0.88, len: 22 },
    ]
  };

  const filteredDefects = activeCodeFilter
    ? currentPiece.defects.filter(d => d.code === activeCodeFilter)
    : currentPiece.defects;

  const defectCountsByCode = currentPiece.defects.reduce((acc, d) => {
    acc[d.code] = (acc[d.code] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className={`min-h-screen bg-[#050b18] text-white flex flex-col font-sans transition-all duration-300 ${isTvMode ? 'fixed inset-0 z-50 p-4 bg-black' : 'p-4 md:p-6'}`}>
      
      {/* ── TOP HEADER: Defect Code Badges Strip (Mindhive FinishSelect Style) ── */}
      <div className="bg-[#0b1429]/90 border border-cyan-500/20 rounded-2xl p-2.5 mb-4 shadow-xl backdrop-blur-md">
        <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-cyan-500/30">
          <div className="flex items-center gap-1.5 flex-nowrap">
            {DEFECT_CODES.map((def) => {
              const count = defectCountsByCode[def.code] || 0;
              const isSelected = activeCodeFilter === def.code;
              return (
                <button
                  key={def.code}
                  onClick={() => setActiveCodeFilter(isSelected ? null : def.code)}
                  title={`${def.name} (${count} detected)`}
                  className={`flex items-center justify-center min-w-[36px] h-8 px-2 rounded font-bold text-xs transition-all duration-200 shadow-md ${
                    isSelected ? 'ring-2 ring-white scale-105 z-10' : 'hover:scale-105 opacity-90 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: def.color, color: def.textColor }}
                >
                  <span className="tracking-tight">{def.code}</span>
                  {count > 0 && (
                    <span className="ml-1 text-[10px] bg-black/40 text-white px-1 rounded-full">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setActiveCodeFilter(null)}
            className={`text-[11px] font-semibold px-3 py-1 rounded border transition-colors flex-shrink-0 ${
              activeCodeFilter
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 hover:bg-rose-500/30'
                : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20'
            }`}
          >
            {activeCodeFilter ? `Clear Filter (${activeCodeFilter})` : 'Show All Codes'}
          </button>
        </div>
      </div>

      {/* ── MAIN WORKSPACE: Central Hide Canvas + Right Metrics Panel ── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch min-h-[550px]">
        
        {/* ── LEFT/CENTER: Hide Contour Map Display (8 Cols) ── */}
        <div className="lg:col-span-8 bg-[#091122] border border-cyan-500/30 rounded-3xl p-4 md:p-6 shadow-2xl relative flex flex-col justify-between overflow-hidden">
          
          {/* Subtle Grid Background Pattern */}
          <div 
            className="absolute inset-0 opacity-15 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(#06b6d4 1px, transparent 1px)',
              backgroundSize: '24px 24px'
            }}
          />

          {/* Top Bar Controls Inside Display */}
          <div className="relative z-10 flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className="bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-bold text-xs px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                <FiCpu className="w-3.5 h-3.5 animate-pulse text-cyan-400" />
                {currentPiece.hide_id} ({currentPiece.plant_id})
              </span>
              <span className="text-xs text-slate-400 hidden sm:inline-block">
                Piece #{currentPiece.piece_number} • Lot {currentPiece.lot_no}
              </span>
            </div>

            {/* View Modes & TV Toggle */}
            <div className="flex items-center gap-2">
              <div className="bg-[#0f1d38] border border-slate-700/60 rounded-xl p-1 flex items-center gap-1">
                {(['silhouette', 'heatmap', 'photo'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg capitalize transition-all ${
                      viewMode === mode
                        ? 'bg-cyan-500 text-black shadow-md font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setIsTvMode(!isTvMode)}
                className="p-2 bg-[#0f1d38] border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 rounded-xl transition-all"
                title={isTvMode ? "Exit Fullscreen Kiosk Mode" : "Enter Fullscreen TV Kiosk Display"}
              >
                {isTvMode ? <FiMinimize2 className="w-4 h-4" /> : <FiMaximize2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* ── THE LEATHER HIDE CANVAS / MAP VIEW ── */}
          <div className="relative z-10 flex-1 flex items-center justify-center my-2 py-4">
            
            <motion.div 
              key={currentPiece.hide_id}
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="relative w-full max-w-[620px] aspect-[4/5] flex items-center justify-center"
            >
              {/* Silhouette Leather Hide SVG Path */}
              <svg 
                viewBox="0 0 500 600" 
                className="w-full h-full filter drop-shadow-[0_0_25px_rgba(6,182,212,0.25)]"
              >
                <defs>
                  {/* Glowing Silhouette Gradient */}
                  <linearGradient id="hideGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#08142c" />
                    <stop offset="50%" stopColor="#040a17" />
                    <stop offset="100%" stopColor="#091836" />
                  </linearGradient>

                  <linearGradient id="heatmapGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#3b82f6" />
                    <stop offset="30%" stopColor="#10b981" />
                    <stop offset="65%" stopColor="#eab308" />
                    <stop offset="100%" stopColor="#ef4444" />
                  </linearGradient>

                  {/* Glow filter */}
                  <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {/* Hide Perimeter Path */}
                <path
                  d="M 250,45 
                     C 280,48 310,65 325,95 
                     C 340,125 320,155 365,170 
                     C 410,185 455,200 460,265 
                     C 465,330 435,370 445,415 
                     C 455,460 415,505 375,525 
                     C 335,545 305,530 250,555 
                     C 195,530 165,545 125,525 
                     C 85,505 45,460 55,415 
                     C 65,370 35,330 40,265 
                     C 45,200 90,185 135,170 
                     C 180,155 160,125 175,95 
                     C 190,65 220,48 250,45 Z"
                  fill={viewMode === 'heatmap' ? 'url(#heatmapGradient)' : 'url(#hideGradient)'}
                  stroke="#06b6d4"
                  strokeWidth="3.5"
                  strokeLinejoin="round"
                  className="transition-all duration-500"
                />

                {/* Inner Scan Grid & Contour Guidelines */}
                <path
                  d="M 250,70 Q 250,300 250,530 M 100,285 Q 250,280 400,285 M 120,400 Q 250,395 380,400"
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth="0.8"
                  strokeDasharray="4 4"
                  opacity="0.35"
                />

                {/* Render Defect Line Traces & Markers */}
                {filteredDefects.map((d, i) => {
                  const cx = d.x * 500;
                  const cy = d.y * 600;
                  const length = d.len || 40;
                  const isMatch = !activeCodeFilter || activeCodeFilter === d.code;

                  return (
                    <g key={i} className="transition-all duration-300">
                      {/* Defect Vector Line / Scratch Mark */}
                      <line
                        x1={cx - length / 2}
                        y1={cy - (i % 2 === 0 ? 10 : -10)}
                        x2={cx + length / 2}
                        y2={cy + (i % 2 === 0 ? 15 : -15)}
                        stroke={d.color}
                        strokeWidth={d.severity === 'HIGH' ? "4" : "2.5"}
                        strokeLinecap="round"
                        filter="url(#neonGlow)"
                      />

                      {/* Bounding Point Marker */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={d.radius || 4}
                        fill={d.color}
                        stroke="#ffffff"
                        strokeWidth="1.2"
                      />

                      {/* Code Label Floating Badge */}
                      <g transform={`translate(${cx + 8}, ${cy - 8})`}>
                        <rect
                          width="24"
                          height="14"
                          rx="3"
                          fill={d.color}
                          opacity="0.9"
                        />
                        <text
                          x="12"
                          y="10.5"
                          fill="#ffffff"
                          fontSize="9"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          {d.code}
                        </text>
                      </g>
                    </g>
                  );
                })}
              </svg>

              {/* Watermark Branding inside Viewer */}
              <div className="absolute bottom-3 right-4 opacity-40 flex items-center gap-1.5 pointer-events-none">
                <span className="text-[10px] tracking-widest uppercase font-extrabold text-cyan-400">mindhive FinishSelect™</span>
              </div>
            </motion.div>
          </div>

          {/* ── BOTTOM CAROUSEL CONTROLS ── */}
          <div className="relative z-10 flex items-center justify-between pt-3 border-t border-cyan-500/20">
            <button
              onClick={() => setCurrentIndex(prev => (prev === 0 ? pieces.length - 1 : prev - 1))}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0f1d38] border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 rounded-xl text-xs font-semibold transition-all"
            >
              <FiChevronLeft className="w-4 h-4" /> Previous Piece
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setLiveAutoCycle(!liveAutoCycle)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  liveAutoCycle
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 animate-pulse'
                    : 'bg-[#0f1d38] border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                <FiZap className="w-3.5 h-3.5" />
                {liveAutoCycle ? 'Auto-Scanner Active' : 'Live Auto Cycle'}
              </button>
            </div>

            <button
              onClick={() => setCurrentIndex(prev => (prev + 1) % pieces.length)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0f1d38] border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 rounded-xl text-xs font-semibold transition-all"
            >
              Next Piece <FiChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── RIGHT METRICS & TELEMETRY PANEL (4 Cols) ── */}
        <div className="lg:col-span-4 bg-[#091122] border border-cyan-500/30 rounded-3xl p-5 md:p-6 shadow-2xl flex flex-col justify-between">
          
          <div>
            {/* Top Brand Logo */}
            <div className="flex items-center justify-between pb-4 border-b border-cyan-500/20 mb-6">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                  <FiLayers className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-black tracking-wide text-white uppercase font-[family-name:var(--font-inter-tight)]">
                    FinishSelect™
                  </h2>
                  <p className="text-[10px] text-cyan-400/80 font-medium">Mindhive Hide Intelligence</p>
                </div>
              </div>
              <span className="text-[10px] font-bold text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-full">
                {currentPiece.plant_id}
              </span>
            </div>

            {/* ── GRADE METRIC (Big Prominent Display) ── */}
            <div className="text-center my-4 py-4 bg-[#0d1a33] border border-cyan-500/20 rounded-2xl relative overflow-hidden shadow-inner">
              <div className="absolute top-2 left-3 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                Hide Grade Classification
              </div>
              
              <div className="my-2">
                <span className={`text-6xl font-black tracking-tight ${
                  currentPiece.grade === 'A' ? 'text-emerald-400' :
                  currentPiece.grade === 'B' ? 'text-cyan-400' :
                  currentPiece.grade === 'C' ? 'text-amber-400' : 'text-rose-500'
                }`}>
                  {currentPiece.grade}
                </span>
                <p className="text-xs font-semibold text-slate-300 mt-1 uppercase tracking-wider">Grade</p>
              </div>
            </div>

            {/* ── METRIC LIST ── */}
            <div className="space-y-4 my-6">
              {/* Area m² */}
              <div className="flex items-center justify-between p-3.5 bg-[#0d1a33]/80 border border-slate-800 rounded-xl">
                <div>
                  <p className="text-2xl font-black text-white tabular-nums">
                    {currentPiece.area_sqm.toFixed(2)}
                  </p>
                  <p className="text-[11px] font-medium text-slate-400">Area m²</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-cyan-400 bg-cyan-500/10 px-2.5 py-1 rounded-lg border border-cyan-500/20">
                    Full Surface
                  </span>
                </div>
              </div>

              {/* Brightness from target */}
              <div className="flex items-center justify-between p-3.5 bg-[#0d1a33]/80 border border-slate-800 rounded-xl">
                <div>
                  <p className={`text-2xl font-black tabular-nums ${
                    currentPiece.brightness_from_target < -20 ? 'text-rose-400' : 'text-emerald-400'
                  }`}>
                    {currentPiece.brightness_from_target > 0 ? `+${currentPiece.brightness_from_target}%` : `${currentPiece.brightness_from_target}%`}
                  </p>
                  <p className="text-[11px] font-medium text-slate-400">Brightness from target</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-semibold block">Delta Spec</span>
                  <span className="text-xs font-bold text-slate-300">Target ±15%</span>
                </div>
              </div>

              {/* Thickness mm */}
              <div className="flex items-center justify-between p-3.5 bg-[#0d1a33]/80 border border-slate-800 rounded-xl">
                <div>
                  <p className="text-2xl font-black text-white tabular-nums">
                    {currentPiece.thickness_mm.toFixed(2)} <span className="text-sm font-medium text-slate-400">mm</span>
                  </p>
                  <p className="text-[11px] font-medium text-slate-400">Hide Caliper Thickness</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                    Uniform
                  </span>
                </div>
              </div>

              {/* Scan Age */}
              <div className="flex items-center justify-between p-3.5 bg-[#0d1a33]/80 border border-slate-800 rounded-xl">
                <div>
                  <p className="text-2xl font-black text-cyan-400 tabular-nums">
                    {scanAgeSec}s
                  </p>
                  <p className="text-[11px] font-medium text-slate-400">Scan age</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1 justify-end">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    Live Telemetry
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Actions */}
          <div className="pt-4 border-t border-cyan-500/20 flex flex-col gap-2">
            <button 
              onClick={() => alert(`Piece Analysis Certificate generated for ${currentPiece.hide_id}`)}
              className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg flex items-center justify-center gap-2"
            >
              <FiDownload className="w-4 h-4" /> Export Piece Certificate
            </button>
          </div>

        </div>

      </div>

    </div>
  );
}
