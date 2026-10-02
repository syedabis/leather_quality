"use client";
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiMaximize2, FiX, FiRefreshCw, FiEye, FiCheckCircle,
  FiAlertTriangle, FiSliders, FiCamera, FiCrosshair
} from 'react-icons/fi';
import { useUser } from '../../lib/mockAuth';
import { StaggerContainer, StaggerItem } from '../../components/ui/AnimateIn';
import Unauthorized from '../../components/Unauthorized';
import { usePlantsData } from '../../hooks/usePlantsData';
import { getDashboardAccess } from '../../lib/access';

interface DeskFeed {
  id: string;
  name: string;
  status: 'active' | 'calibrating' | 'idle';
  operator: string;
  lotId: string;
  totalInspected: number;
  gradeAYield: number;
  avgThickness: string;
  lastDefect: { code: string; name: string; time: string; category: string };
  bbox: { x: number; y: number; w: number; h: number; code: string; label: string; conf: number }[];
}

const DESK_FEEDS: DeskFeed[] = [
  {
    id: 'desk-01',
    name: 'Desk 01',
    status: 'active',
    operator: 'Rahim Khan',
    lotId: 'LOT-2026-0922',
    totalInspected: 28,
    gradeAYield: 52.4,
    avgThickness: '1.92 mm',
    lastDefect: { code: 'DHS', name: 'Deep Scratch', time: '2m ago', category: 'critical' },
    bbox: [
      { x: 32, y: 28, w: 22, h: 18, code: 'DHS', label: 'Deep Scratch', conf: 94 },
      { x: 65, y: 55, w: 14, h: 12, code: 'LG', label: 'Light Grain', conf: 88 }
    ]
  },
  {
    id: 'desk-02',
    name: 'Desk 02',
    status: 'active',
    operator: 'Sajid Ali',
    lotId: 'LOT-2026-0921',
    totalInspected: 24,
    gradeAYield: 44.0,
    avgThickness: '1.84 mm',
    lastDefect: { code: 'C', name: 'Cut Mark', time: '5m ago', category: 'critical' },
    bbox: [
      { x: 45, y: 35, w: 18, h: 24, code: 'C', label: 'Cut Mark', conf: 97 }
    ]
  },
  {
    id: 'desk-03',
    name: 'Desk 03',
    status: 'active',
    operator: 'Tariq Mahmood',
    lotId: 'LOT-2026-0919',
    totalInspected: 26,
    gradeAYield: 50.1,
    avgThickness: '1.89 mm',
    lastDefect: { code: 'IB', name: 'Insect Bite', time: '1m ago', category: 'surface' },
    bbox: [
      { x: 25, y: 60, w: 12, h: 14, code: 'IB', label: 'Insect Bite', conf: 91 },
      { x: 70, y: 20, w: 16, h: 16, code: 'NW', label: 'Wrinkle', conf: 85 }
    ]
  },
  {
    id: 'desk-04',
    name: 'Desk 04',
    status: 'active',
    operator: 'Usman Ghani',
    lotId: 'LOT-2026-0918',
    totalInspected: 22,
    gradeAYield: 46.8,
    avgThickness: '1.86 mm',
    lastDefect: { code: 'H', name: 'Hole Void', time: '8m ago', category: 'critical' },
    bbox: [
      { x: 50, y: 40, w: 15, h: 15, code: 'H', label: 'Hole Void', conf: 99 }
    ]
  },
  {
    id: 'desk-05',
    name: 'Desk 05',
    status: 'calibrating',
    operator: 'Bilal Ahmed',
    lotId: 'LOT-2026-0915',
    totalInspected: 21,
    gradeAYield: 49.2,
    avgThickness: '1.90 mm',
    lastDefect: { code: 'PS', name: 'Pin Spot', time: '12m ago', category: 'surface' },
    bbox: [
      { x: 40, y: 50, w: 10, h: 10, code: 'PS', label: 'Pin Spot', conf: 86 }
    ]
  },
  {
    id: 'desk-06',
    name: 'Desk 06',
    status: 'active',
    operator: 'Farhan Shah',
    lotId: 'LOT-2026-0912',
    totalInspected: 21,
    gradeAYield: 47.5,
    avgThickness: '1.87 mm',
    lastDefect: { code: 'HG', name: 'Heavy Grain', time: '4m ago', category: 'grain' },
    bbox: [
      { x: 55, y: 30, w: 28, h: 20, code: 'HG', label: 'Heavy Grain', conf: 92 }
    ]
  }
];

export default function DeskMonitoring() {
  const { connected } = usePlantsData();
  const [fullscreenDesk, setFullscreenDesk] = useState<DeskFeed | null>(null);
  const [showOverlays, setShowOverlays] = useState(true);
  const [scanPulse, setScanPulse] = useState(0);

  const { user, isLoaded } = useUser();
  const role = getDashboardAccess(user?.publicMetadata).role ?? 'admin';

  // Simulated live laser scan line pulse animation
  useEffect(() => {
    const interval = setInterval(() => {
      setScanPulse(prev => (prev + 1) % 100);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  if (!isLoaded && user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#2AAA8A]/30 border-t-[#2AAA8A] rounded-full animate-spin" />
      </div>
    );
  }

  if (role !== 'admin') {
    return <Unauthorized />;
  }

  return (
    <div className="p-6 text-gray-900 dark:text-white relative">
      {/* ── Top Header Bar ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-[family-name:var(--font-inter-tight)] tracking-tight text-gray-900 dark:text-white">
              Desk Live Monitoring
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              12.3 MP Optical Stream
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Overhead high-resolution optical camera feeds — 6 Working Desks active
          </p>
        </motion.div>

        <div className="flex items-center gap-3">
          {/* Overlay Toggle Button */}
          <button
            onClick={() => setShowOverlays(!showOverlays)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              showOverlays
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-gray-800/40 border-gray-700 text-gray-400'
            }`}
          >
            <FiCrosshair className="w-3.5 h-3.5" />
            AI Overlays {showOverlays ? 'ON' : 'OFF'}
          </button>

          {/* System Connection Pill */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
            connected
              ? 'bg-[#2AAA8A]/10 border-[#2AAA8A]/25 text-[#2AAA8A]'
              : 'bg-gray-100 border-gray-200 text-gray-400'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[#2AAA8A] pulse-dot' : 'bg-gray-400'}`} />
            {connected ? '6 Feeds Live' : 'Reconnecting...'}
          </div>
        </div>
      </div>

      {/* ── 6 Desk Feeds Grid ─────────────────────────────────────────── */}
      <StaggerContainer stagger={0.06} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {DESK_FEEDS.map((desk) => (
          <StaggerItem key={desk.id}>
            <motion.div
              whileHover={{ y: -3 }}
              className="bg-[#141414] border border-[#262626] hover:border-[#383838] rounded-2xl overflow-hidden shadow-lg transition-all"
            >
              {/* 16:9 Feed Canvas Viewport */}
              <div className="relative aspect-video bg-[#0a0a0a] overflow-hidden group">
                {/* Background Simulated Hide Surface Scan */}
                <div className="absolute inset-0 bg-gradient-to-br from-[#1c1c1e] via-[#121214] to-[#08080a] flex items-center justify-center">
                  {/* Leather Hide Contour Silhouette Graphics */}
                  <svg className="w-4/5 h-4/5 opacity-20 text-emerald-500" viewBox="0 0 200 120" fill="currentColor">
                    <path d="M 20,40 C 30,10 80,15 110,10 C 150,5 180,20 185,50 C 190,80 170,110 130,115 C 90,120 40,110 20,90 C 5,70 10,60 20,40 Z" />
                  </svg>

                  {/* Animated Laser Scanning Line */}
                  <div
                    className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_8px_#34d399] opacity-75"
                    style={{ top: `${scanPulse}%` }}
                  />
                </div>

                {/* AI Defect Bounding Box Overlays */}
                {showOverlays && desk.bbox.map((box, idx) => (
                  <div
                    key={idx}
                    className="absolute border-2 border-emerald-400 bg-emerald-500/10 rounded pointer-events-none transition-all"
                    style={{
                      left: `${box.x}%`,
                      top: `${box.y}%`,
                      width: `${box.w}%`,
                      height: `${box.h}%`,
                    }}
                  >
                    <span className="absolute -top-5 left-0 bg-emerald-500 text-black font-extrabold text-[9px] px-1 py-0.2 rounded shadow">
                      [{box.code}] {box.conf}%
                    </span>
                  </div>
                ))}

                {/* Top-Left: Desk Label & Operator */}
                <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
                  <div className="bg-black/80 backdrop-blur-md border border-white/10 px-2.5 py-1 rounded-lg flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span className="text-xs font-black text-white uppercase tracking-wider">{desk.name}</span>
                  </div>
                  <span className="bg-black/60 backdrop-blur-md border border-white/10 text-[10px] text-gray-300 px-2 py-1 rounded-lg">
                    {desk.operator}
                  </span>
                </div>

                {/* Top-Right: Fullscreen & Snap controls */}
                <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10 opacity-80 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setFullscreenDesk(desk)}
                    className="w-7 h-7 bg-black/80 backdrop-blur-md border border-white/10 rounded-lg flex items-center justify-center text-gray-300 hover:text-white hover:border-emerald-500/40 transition-all"
                    title="Fullscreen Feed"
                  >
                    <FiMaximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Bottom-Left: Live Scan Lot & Grade Prediction */}
                <div className="absolute bottom-3 left-3 z-10">
                  <div className="bg-black/80 backdrop-blur-md border border-white/10 px-2.5 py-1 rounded-lg flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 font-medium">{desk.lotId}</span>
                    <span className="text-xs font-extrabold text-emerald-400">{desk.gradeAYield}% Grade A</span>
                  </div>
                </div>

                {/* Bottom-Right: Thickness Tag */}
                <div className="absolute bottom-3 right-3 z-10">
                  <div className="bg-black/80 backdrop-blur-md border border-white/10 px-2.5 py-1 rounded-lg text-[10px] font-bold text-sky-400">
                    📏 {desk.avgThickness}
                  </div>
                </div>
              </div>

              {/* Desk Footer Status Bar */}
              <div className="p-3 bg-[#181818] border-t border-[#262626] flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">Inspected:</span>
                  <span className="font-bold text-white">{desk.totalInspected} hides</span>
                </div>

                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="text-gray-400">Last Defect:</span>
                  <span className="font-extrabold text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                    {desk.lastDefect.code} ({desk.lastDefect.time})
                  </span>
                </div>
              </div>
            </motion.div>
          </StaggerItem>
        ))}
      </StaggerContainer>

      {/* ── Fullscreen Modal Overlay ───────────────────────────────────── */}
      <AnimatePresence>
        {fullscreenDesk && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/95 backdrop-blur-lg flex items-center justify-center z-50 p-4"
          >
            <div className="relative w-full max-w-6xl aspect-video bg-[#0d0d0f] border border-[#2a2a2c] rounded-2xl overflow-hidden shadow-2xl">
              {/* Simulated Live Viewport */}
              <div className="relative w-full h-full bg-[#08080a] flex items-center justify-center overflow-hidden">
                <svg className="w-3/4 h-3/4 opacity-25 text-emerald-500" viewBox="0 0 200 120" fill="currentColor">
                  <path d="M 20,40 C 30,10 80,15 110,10 C 150,5 180,20 185,50 C 190,80 170,110 130,115 C 90,120 40,110 20,90 C 5,70 10,60 20,40 Z" />
                </svg>

                {/* Laser scan line */}
                <div
                  className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_#34d399]"
                  style={{ top: `${scanPulse}%` }}
                />

                {/* Bounding box overlays */}
                {fullscreenDesk.bbox.map((box, idx) => (
                  <div
                    key={idx}
                    className="absolute border-2 border-emerald-400 bg-emerald-500/15 rounded"
                    style={{
                      left: `${box.x}%`,
                      top: `${box.y}%`,
                      width: `${box.w}%`,
                      height: `${box.h}%`,
                    }}
                  >
                    <span className="absolute -top-6 left-0 bg-emerald-500 text-black font-extrabold text-xs px-2 py-0.5 rounded shadow">
                      [{box.code}] {box.label} ({box.conf}%)
                    </span>
                  </div>
                ))}
              </div>

              {/* Header inside Modal */}
              <div className="absolute top-4 left-4 flex items-center gap-3 z-10">
                <div className="bg-black/80 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-xl flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-sm font-black text-white uppercase">{fullscreenDesk.name} — Live Camera Stream</span>
                </div>
                <span className="bg-black/80 backdrop-blur-md border border-white/10 text-xs text-gray-300 px-3 py-1.5 rounded-xl">
                  Operator: {fullscreenDesk.operator}
                </span>
              </div>

              {/* Close Button */}
              <button
                onClick={() => setFullscreenDesk(null)}
                className="absolute top-4 right-4 w-9 h-9 bg-black/80 backdrop-blur-md border border-white/10 rounded-xl flex items-center justify-center text-gray-300 hover:text-white hover:border-rose-500/40 transition-all z-10"
              >
                <FiX className="w-5 h-5" />
              </button>

              {/* Bottom Info Bar inside Modal */}
              <div className="absolute bottom-4 left-4 right-4 bg-black/80 backdrop-blur-md border border-white/10 p-3 rounded-xl flex items-center justify-between z-10 text-xs">
                <div className="flex items-center gap-4 text-white">
                  <span>Batch Lot: <strong>{fullscreenDesk.lotId}</strong></span>
                  <span>Grade A Yield: <strong className="text-emerald-400">{fullscreenDesk.gradeAYield}%</strong></span>
                  <span>Avg Thickness: <strong className="text-sky-400">{fullscreenDesk.avgThickness}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">Resolution:</span>
                  <span className="text-xs font-bold text-emerald-400">4000 × 3000 (12.3 MP)</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
