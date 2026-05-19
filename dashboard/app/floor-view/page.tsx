"use client";
import { useMemo, useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { FiDownload } from 'react-icons/fi';

import { usePlantsData } from '../../hooks/usePlantsData';
import { PLANTS } from '../../lib/constants';
import { useSidebar } from '../../contexts/SidebarContext';
import type { PlantId, PlantState } from '../../types';

// ── Constants ──────────────────────────────────────────────────────────────────
interface LotInfo { lot: string; party: string; orderId: string; articleNo: string; articleName: string; color: string; }
const LOT_DATA: Record<PlantId, LotInfo> = {
  'SP-01': { lot: 'LOT-2841', party: 'Servis Industries',   orderId: 'ORD-4471', articleNo: 'ART-5021', articleName: 'Black Formal Upper',  color: 'Jet Black'    },
  'SP-02': { lot: 'LOT-2842', party: 'Bata Pakistan',       orderId: 'ORD-4472', articleNo: 'ART-5034', articleName: 'Brown Derby Upper',   color: 'Walnut Brown' },
  'SP-03': { lot: 'LOT-2843', party: 'Stylo Group',         orderId: 'ORD-4473', articleNo: 'ART-5047', articleName: 'Tan Casual Moccasin', color: 'Sand Tan'     },
  'SP-04': { lot: '',         party: 'Hush Puppies PK',     orderId: 'ORD-4474', articleNo: 'ART-5058', articleName: 'Suede Chelsea Boot',  color: 'Charcoal'     },
  'SP-05': { lot: 'LOT-2845', party: 'Insignia Leather',    orderId: 'ORD-4475', articleNo: 'ART-5063', articleName: 'Black Oxford Upper',  color: 'Onyx'         },
  'SP-06': { lot: 'LOT-2846', party: 'Borjan Pvt Ltd',      orderId: 'ORD-4476', articleNo: 'ART-5071', articleName: 'Cognac Loafer Upper', color: 'Cognac'       },
};

const LOT_COLORS: Record<PlantId, { bg: string; text: string }> = {
  'SP-01': { bg: '#3B0764', text: '#C4B5FD' },
  'SP-02': { bg: '#052E16', text: '#86EFAC' },
  'SP-03': { bg: '#422006', text: '#FDE68A' },
  'SP-04': { bg: '#4A044E', text: '#F0ABFC' },
  'SP-05': { bg: '#0C1A4B', text: '#93C5FD' },
  'SP-06': { bg: '#450A0A', text: '#FCA5A5' },
};

// [colorMatch%, wash%, idle%] — must sum to 100
const IDLE_BREAKDOWN: Record<PlantId, [number, number, number]> = {
  'SP-01': [ 6, 18, 76],
  'SP-02': [22,  9, 69],
  'SP-03': [41,  2, 57],
  'SP-04': [ 0, 68, 32],
  'SP-05': [42, 13, 45],
  'SP-06': [39, 13, 48],
};

const STATUS_SCENARIOS: Array<Partial<Record<PlantId, { belt_active: boolean; online: boolean }>>> = [
  {},
  { 'SP-02': { belt_active: true,  online: true } },
  { 'SP-01': { belt_active: false, online: true }, 'SP-02': { belt_active: true, online: true } },
  { 'SP-02': { belt_active: false, online: true } },
  { 'SP-04': { belt_active: false, online: true } },
  {},
];

// ── Plant card ─────────────────────────────────────────────────────────────────
interface PlantCardProps {
  plant: PlantState;
  plantIdx: number;
  dayElapsedSecs: number;
  delay?: number;
}

function PlantCard({ plant, plantIdx, dayElapsedSecs, delay = 0 }: PlantCardProps) {
  const displayId = `SP-${plantIdx + 1}`;
  const lotInfo   = LOT_DATA[plant.plant_id as PlantId] ?? { lot: '', party: 'Unknown', orderId: '—', articleNo: '—', articleName: '—', color: '—' };
  const lotStyle  = LOT_COLORS[plant.plant_id as PlantId] ?? { bg: '#1a1a1a', text: '#fff' };
  const lotLabel  = lotInfo.lot?.trim() ? lotInfo.lot : 'unaccounted';
  const hasLot    = !!lotInfo.lot?.trim();
  const [cmPct, washPct, idlePct] = IDLE_BREAKDOWN[plant.plant_id as PlantId] ?? [33, 33, 34];

  const isRunning = plant.online && plant.belt_active;
  const isIdle    = plant.online && !plant.belt_active;

  const activeHrs = (plant.runtime_s / 3600).toFixed(1);
  const idleHrs   = (plant.idle_s   / 3600).toFixed(1);

  // Progress bar — proportional to day elapsed
  const total      = dayElapsedSecs || 1;
  const activeFrac = Math.min(plant.runtime_s / total, 1) * 100;
  const idleFrac   = Math.min(plant.idle_s    / total, 1) * 100;
  const cmFrac     = idleFrac * (cmPct   / 100);
  const washFrac   = idleFrac * (washPct / 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl overflow-hidden flex flex-col"
    >
      {/* SP name + Lot # at top right */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="text-gray-900 dark:text-white font-black text-lg tracking-tight">{displayId}</span>
        <span
          title={hasLot ? `Lot ${lotInfo.lot}` : 'No lot number entered'}
          className="text-[10px] font-bold px-2 py-0.5 rounded-md flex-shrink-0 max-w-[55%] truncate"
          style={hasLot
            ? { backgroundColor: lotStyle.bg, color: lotStyle.text }
            : { backgroundColor: '#3F1212', color: '#FCA5A5' }}
        >
          {lotLabel}
        </span>
      </div>

      {/* Status badge */}
      <div className="px-3 pb-2">
        {isRunning && (
          <span className="bg-[#22C55E] text-black text-[10px] font-bold px-2.5 py-0.5 rounded-full">
            Running
          </span>
        )}
        {isIdle && (
          <span className="bg-[#F59E0B] text-black text-[10px] font-bold px-2.5 py-0.5 rounded-full">
            Idle
          </span>
        )}
        {!plant.online && (
          <span className="bg-gray-700 text-gray-300 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
            Offline
          </span>
        )}
      </div>

      {/* Party / Order / Article / Color */}
      <div className="px-3 pb-3 grid grid-cols-2 gap-x-2 gap-y-1.5">
        <div className="col-span-2">
          <p className="text-gray-500 text-[9px] font-semibold uppercase tracking-wider leading-none mb-0.5">Party</p>
          <p className="text-[12px] font-bold text-gray-900 dark:text-white truncate leading-tight">{lotInfo.party}</p>
        </div>
        <div>
          <p className="text-gray-500 text-[9px] font-semibold uppercase tracking-wider leading-none mb-0.5">Order</p>
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 truncate tabular-nums">{lotInfo.orderId}</p>
        </div>
        <div>
          <p className="text-gray-500 text-[9px] font-semibold uppercase tracking-wider leading-none mb-0.5">Color</p>
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 truncate">{lotInfo.color}</p>
        </div>
        <div className="col-span-2">
          <p className="text-gray-500 text-[9px] font-semibold uppercase tracking-wider leading-none mb-0.5">Article</p>
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 truncate">{lotInfo.articleName}</p>
        </div>
      </div>

      {/* Pieces today / Active */}
      <div className="mx-3 mb-2 bg-gray-50 dark:bg-[#111111] rounded-xl p-2.5">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            {/* fixed-height label area = 2 lines */}
            <p className="text-gray-500 text-[10px] font-medium leading-tight mb-1.5 h-[28px] flex items-end">
              Pieces today
            </p>
            <p className="text-gray-900 dark:text-white font-black text-2xl leading-none tabular-nums">
              {(plant.total_count ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-col">
            <p className="text-gray-500 text-[10px] font-medium leading-tight mb-1.5 h-[28px] flex items-end">
              Active
            </p>
            <p className="text-green-600 dark:text-green-400 font-black text-2xl leading-none tabular-nums">
              {activeHrs}h
            </p>
          </div>
        </div>
      </div>

      {/* Total Idle */}
      <div className="mx-3 mb-2 bg-amber-50 dark:bg-[#1c1400] rounded-xl px-3 py-2 flex items-center justify-between">
        <span className="text-amber-700 text-[10px] font-black uppercase tracking-widest leading-tight">
          TOTAL<br />IDLE
        </span>
        <span className="text-orange-500 dark:text-orange-400 font-black text-2xl tabular-nums leading-none">
          {idleHrs}h
        </span>
      </div>

      {/* % of idle time */}
      <div className="px-3 pb-2 flex-1">
        <p className="text-gray-600 text-[9px] font-semibold uppercase tracking-widest mb-2">
          % of idle time
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          <div className="flex flex-col items-center gap-1.5">
            <span className="bg-blue-50 dark:bg-[#0a2040] text-blue-600 dark:text-blue-300 text-[9px] font-semibold rounded w-full text-center leading-tight h-[32px] flex items-center justify-center">
              Color<br />match
            </span>
            <span className="text-gray-900 dark:text-white font-black text-base tabular-nums">{cmPct}%</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <span className="bg-amber-50 dark:bg-[#221500] text-amber-600 dark:text-amber-300 text-[9px] font-semibold rounded w-full text-center leading-tight h-[32px] flex items-center justify-center">
              Wash
            </span>
            <span className="text-gray-900 dark:text-white font-black text-base tabular-nums">{washPct}%</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <span className="bg-gray-100 dark:bg-[#252525] text-gray-600 dark:text-gray-400 text-[9px] font-semibold rounded w-full text-center leading-tight h-[32px] flex items-center justify-center">
              Idle
            </span>
            <span className="text-gray-900 dark:text-white font-black text-base tabular-nums">{idlePct}%</span>
          </div>
        </div>
      </div>

      {/* Progress bar — edge to edge */}
      <div className="flex h-1.5">
        <div className="bg-[#22C55E]" style={{ width: `${activeFrac}%` }} />
        <div className="bg-[#3B82F6]" style={{ width: `${cmFrac}%` }} />
        <div className="bg-[#F59E0B]" style={{ width: `${washFrac}%` }} />
        <div className="bg-[#4B5563] flex-1" />
      </div>
    </motion.div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function FloorView() {
  const { plants, connected } = usePlantsData();
  const { collapsed, hidden: sidebarHidden } = useSidebar();
  const [statusTick, setStatusTick] = useState(0);
  const [now,        setNow]        = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setStatusTick(t => t + 1), 8_000);
    return () => clearInterval(id);
  }, []);

  const plantList = PLANTS.map(p => {
    const base     = plants[p.id];
    if (!base) return null;
    const override = STATUS_SCENARIOS[statusTick % STATUS_SCENARIOS.length][p.id];
    return override ? { ...base, ...override } : base;
  }).filter(Boolean) as PlantState[];

  const dayElapsedSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const dayElapsedHrs  = (dayElapsedSecs / 3600).toFixed(1);
  const clockStr       = format(now, 'HH:mm:ss');

  const { totalPieces, totalActiveHrs, totalIdleHrs, runningCount } = useMemo(() => ({
    totalPieces:    plantList.reduce((s, p) => s + (p.total_count ?? 0), 0),
    totalActiveHrs: parseFloat(
      (plantList.reduce((s, p) => s + (p.runtime_s ?? 0), 0) / 3600).toFixed(1)
    ),
    totalIdleHrs: parseFloat(
      (plantList.reduce((s, p) => s + (p.idle_s ?? 0), 0) / 3600).toFixed(1)
    ),
    runningCount: plantList.filter(p => p.online && p.belt_active).length,
  }), [plantList]);

  const exportPDF = useCallback(() => {
    const dateStr  = format(now, 'MMMM d, yyyy');
    const pdfRows  = plantList.map(p => `
      <tr>
        <td>${p.plant_name}</td>
        <td>${p.online ? (p.belt_active ? '<span class="running">Running</span>' : '<span class="idle">Idle</span>') : '<span class="offline">Offline</span>'}</td>
        <td>${(p.total_count ?? 0).toLocaleString()}</td>
        <td>${(p.runtime_s / 3600).toFixed(2)}</td>
        <td>${(p.idle_s    / 3600).toFixed(2)}</td>
        <td>${Math.round(p.utilization ?? 0)}%</td>
      </tr>`).join('');
    const html = `<!DOCTYPE html><html><head><title>Floor View — ${dateStr}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
        h1   { font-size: 18px; margin-bottom: 4px; }
        p    { font-size: 12px; color: #666; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { background: #f4f4f4; text-align: left; padding: 8px 12px; border-bottom: 2px solid #ddd; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
        td { padding: 8px 12px; border-bottom: 1px solid #eee; }
        .running { color: #16a34a; font-weight: 700; }
        .idle    { color: #d97706; font-weight: 700; }
        .offline { color: #9ca3af; font-weight: 700; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <h1>Dada Enterprises — Floor View</h1>
      <p>${dateStr} · Kasur, Punjab · Total pieces: ${totalPieces.toLocaleString()}</p>
      <table>
        <thead><tr><th>Plant</th><th>Status</th><th>Pieces</th><th>Active (h)</th><th>Idle (h)</th><th>Utilization</th></tr></thead>
        <tbody>${pdfRows}</tbody>
      </table></body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }, [plantList, now, totalPieces]);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-[#0d0d0d] text-gray-900 dark:text-white px-5 pt-4 pb-10 font-[family-name:var(--font-roboto)]">

      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
            <h1 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">
              Dada Enterprises — Spray Plant Floor View
            </h1>
          </div>
          <p className="text-gray-500 text-sm ml-[26px]">Kasur, Punjab · Live Monitoring</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-xl px-4 py-2 text-sm">
            <span className="text-gray-500">Hour: </span>
            <span className="text-gray-900 dark:text-white font-bold">{now.getHours().toString().padStart(2, '0')}</span>
          </div>
          <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-xl px-4 py-2">
            <span className="text-gray-900 dark:text-white font-mono font-bold text-sm tabular-nums">{clockStr}</span>
          </div>
          <button
            onClick={exportPDF}
            className="flex items-center gap-1.5 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c]
              hover:border-[#2AAA8A]/40 rounded-xl px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-400
              hover:text-[#2AAA8A] transition-all"
          >
            <FiDownload className="w-3.5 h-3.5" />
            PDF
          </button>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 pb-4 border-b border-gray-200 dark:border-[#1f1f1f]">
        <div>
          <p className="text-gray-600 text-[10px] font-semibold uppercase tracking-[0.15em] mb-2">
            Total Pieces Today
          </p>
          <p className="text-gray-900 dark:text-white font-black text-3xl tabular-nums leading-none mb-0.5">
            {totalPieces.toLocaleString()}
          </p>
          <p className="text-gray-600 text-xs">all 6 plants</p>
        </div>
        <div>
          <p className="text-gray-600 text-[10px] font-semibold uppercase tracking-[0.15em] mb-1">
            Total Active Hrs
          </p>
          <p className="text-gray-900 dark:text-white font-black text-3xl tabular-nums leading-none mb-0.5">
            {totalActiveHrs}h
          </p>
          <p className="text-gray-600 text-xs">combined</p>
        </div>
        <div>
          <p className="text-gray-600 text-[10px] font-semibold uppercase tracking-[0.15em] mb-1">
            Total Idle Hrs
          </p>
          <p className="text-gray-900 dark:text-white font-black text-3xl tabular-nums leading-none mb-0.5">
            {totalIdleHrs}h
          </p>
          <p className="text-gray-600 text-xs">all reasons</p>
        </div>
        <div>
          <p className="text-gray-600 text-[10px] font-semibold uppercase tracking-[0.15em] mb-1">
            Plants Running
          </p>
          <p className="text-gray-900 dark:text-white font-black text-3xl tabular-nums leading-none mb-0.5">
            {runningCount} / {PLANTS.length}
          </p>
          <p className="text-gray-600 text-xs">right now</p>
        </div>
      </div>

      {/* ── Plant cards — 6 per row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
        {plantList.map((p, i) => (
          <PlantCard
            key={p.plant_id}
            plant={p}
            plantIdx={i}
            dayElapsedSecs={dayElapsedSecs}
            delay={0.05 + i * 0.05}
          />
        ))}
      </div>

      {/* ── Footer legend ── */}
      <div className={`fixed bottom-0 right-0 z-30 bg-gray-100/90 dark:bg-[#0d0d0d]/90 backdrop-blur-sm
        border-t border-gray-200 dark:border-[#1f1f1f] px-5 py-2 flex items-center justify-between
        ${sidebarHidden ? 'left-0' : collapsed ? 'left-18' : 'left-58'}`}>
        <div className="flex items-center gap-4 flex-wrap">
          {[
            { color: '#22C55E', label: 'Active' },
            { color: '#3B82F6', label: 'Idle — color match' },
            { color: '#F59E0B', label: 'Idle — wash' },
            { color: '#4B5563', label: 'Idle — unaccounted' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-gray-500 text-xs">{label}</span>
            </div>
          ))}
        </div>
        <span className="text-gray-500 text-xs flex-shrink-0">Refreshes every 5s</span>
      </div>

    </div>
  );
}
