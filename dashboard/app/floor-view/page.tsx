"use client";
import { useMemo, useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { FiDownload } from 'react-icons/fi';

import { usePlantsData } from '../../hooks/usePlantsData';
import { PLANTS, fmtDuration } from '../../lib/constants';
import { useSidebar } from '../../contexts/SidebarContext';
import type { PlantId, PlantState, ActiveSession } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────────────────

function elapsedSince(isoString: string, now: Date): string {
  const start = new Date(isoString);
  const diffS = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 1000));
  return fmtDuration(diffS);
}

const NA = 'Not Available';

// ── Plant card ─────────────────────────────────────────────────────────────────
interface PlantCardProps {
  plant:          PlantState;
  dayElapsedSecs: number;
  now:            Date;
  delay?:         number;
}

function PlantCard({ plant, dayElapsedSecs, now, delay = 0 }: PlantCardProps) {
  const sess = plant.active_session ?? null;

  // Belt status badges (independent of session state)
  const isBreak   = plant.online && !!plant.in_break;
  const isRunning = plant.online && plant.belt_active && !isBreak;
  const isIdle    = plant.online && !plant.belt_active && !isBreak;

  const activeHrs = fmtDuration(plant.runtime_s);
  const idleHrs   = fmtDuration(plant.idle_s);

  const total      = dayElapsedSecs || 1;
  const activeFrac = Math.min(plant.runtime_s / total, 1) * 100;
  const idleFrac   = Math.min(plant.idle_s    / total, 1) * 100;

  // ── Session badge ──────────────────────────────────────────────────────
  type SessionBadge = { label: string; cls: string; pulse: boolean };
  const sessionBadge: SessionBadge = sess == null
    ? { label: 'NO SESSION',  cls: 'bg-gray-600 text-gray-200',              pulse: false }
    : sess.type === 'accounted'
      ? { label: 'INPROCESS',   cls: 'bg-[#22C55E] text-black',               pulse: true  }
      : { label: 'UNACCOUNTED', cls: 'bg-[#F59E0B] text-black',               pulse: true  };

  // ── Lot info fields ────────────────────────────────────────────────────
  const lotLabel    = sess?.lot_no       ?? NA;
  const partyLabel  = sess?.party_name   ?? NA;
  const orderLabel  = sess?.order_no     ?? NA;
  const colorLabel  = sess?.colour_name  ?? NA;
  const articleLabel = sess?.article_name ?? NA;

  const currentPieces  = sess?.current_pieces  ?? null;
  const expectedPieces = sess?.expected_pieces ?? null;
  const sessionActive  = sess ? elapsedSince(sess.start_time, now) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl overflow-hidden flex flex-col"
    >
      {/* Header: plant ID + session badge */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="text-gray-900 dark:text-white font-black text-lg tracking-tight">
          {plant.plant_id}
        </span>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md flex-shrink-0 ${sessionBadge.cls} ${sessionBadge.pulse ? 'animate-pulse' : ''}`}>
          {sessionBadge.label}
        </span>
      </div>

      {/* Belt status badge */}
      <div className="px-3 pb-2">
        {isBreak && (
          <span className="bg-[#8B5CF6] text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full">Break</span>
        )}
        {isRunning && (
          <span className="bg-[#22C55E] text-black text-[10px] font-bold px-2.5 py-0.5 rounded-full">Running</span>
        )}
        {isIdle && (
          <span className="bg-[#F59E0B] text-black text-[10px] font-bold px-2.5 py-0.5 rounded-full">Idle</span>
        )}
        {!plant.online && plant.is_holiday && (
          <span className="bg-[#3B82F6] text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full">Offline · Holiday</span>
        )}
        {!plant.online && !plant.is_holiday && plant.is_weekly_off && (
          <span className="bg-[#6366F1] text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full">Offline · Day Off</span>
        )}
        {!plant.online && !plant.is_holiday && !plant.is_weekly_off && (
          <span className="bg-gray-700 text-gray-300 text-[10px] font-bold px-2.5 py-0.5 rounded-full">Offline</span>
        )}
      </div>

      {/* Lot info grid */}
      <div className="px-3 pb-3 grid grid-cols-2 gap-x-2 gap-y-1.5">
        <div className="col-span-2">
          <p className="text-gray-500 text-[9px] font-semibold uppercase tracking-wider leading-none mb-0.5">LOT</p>
          <p className={`text-[11px] font-bold truncate leading-tight ${sess?.lot_no ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-600 italic'}`}>
            {lotLabel}
          </p>
        </div>
        <div className="col-span-2">
          <p className="text-gray-500 text-[9px] font-semibold uppercase tracking-wider leading-none mb-0.5">Party</p>
          <p className={`text-[12px] font-bold truncate leading-tight ${sess?.party_name ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-600 italic'}`}>
            {partyLabel}
          </p>
        </div>
        <div>
          <p className="text-gray-500 text-[9px] font-semibold uppercase tracking-wider leading-none mb-0.5">Order</p>
          <p className={`text-[11px] font-semibold truncate tabular-nums ${sess?.order_no ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600 italic'}`}>
            {orderLabel}
          </p>
        </div>
        <div>
          <p className="text-gray-500 text-[9px] font-semibold uppercase tracking-wider leading-none mb-0.5">Color</p>
          <p className={`text-[11px] font-semibold truncate ${sess?.colour_name ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600 italic'}`}>
            {colorLabel}
          </p>
        </div>
        <div className="col-span-2">
          <p className="text-gray-500 text-[9px] font-semibold uppercase tracking-wider leading-none mb-0.5">Article</p>
          <p className={`text-[11px] font-semibold truncate ${sess?.article_name ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600 italic'}`}>
            {articleLabel}
          </p>
        </div>
      </div>

      {/* Session piece counts (shown only when a session is active) */}
      {sess && (
        <div className="mx-3 mb-2 bg-gray-50 dark:bg-[#111111] rounded-xl p-2.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <p className="text-gray-500 text-[10px] font-medium leading-tight mb-1.5">Current Pieces</p>
              <p className="text-gray-900 dark:text-white font-black text-2xl leading-none tabular-nums">
                {(currentPieces ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="flex flex-col">
              <p className="text-gray-500 text-[10px] font-medium leading-tight mb-1.5">Expected</p>
              <p className="text-gray-900 dark:text-white font-black text-2xl leading-none tabular-nums">
                {expectedPieces != null ? expectedPieces.toLocaleString() : <span className="text-base italic text-gray-400">N/A</span>}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Pieces today + Active time */}
      <div className="mx-3 mb-2 bg-gray-50 dark:bg-[#111111] rounded-xl p-2.5">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <p className="text-gray-500 text-[10px] font-medium leading-tight mb-1.5 h-[28px] flex items-end">
              Pieces today
            </p>
            <p className="text-gray-900 dark:text-white font-black text-2xl leading-none tabular-nums">
              {(plant.total_count ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-col">
            <p className="text-gray-500 text-[10px] font-medium leading-tight mb-1.5 h-[28px] flex items-end">
              {sess ? 'Session time' : 'Active'}
            </p>
            <p className="text-green-600 dark:text-green-400 font-black text-lg leading-none tabular-nums truncate">
              {sess ? (sessionActive ?? '--') : activeHrs}
            </p>
          </div>
        </div>
      </div>

      {/* Total Idle */}
      <div className="mx-3 mb-2 bg-amber-50 dark:bg-[#1c1400] rounded-xl px-3 py-2 flex items-center justify-between">
        <span className="text-amber-700 text-[10px] font-black uppercase tracking-widest leading-tight">
          TOTAL<br />IDLE
        </span>
        <span className="text-orange-500 dark:text-orange-400 font-black text-lg tabular-nums leading-none">
          {idleHrs}
        </span>
      </div>

      {/* % of idle time — static proportional display */}
      <div className="px-3 pb-2 flex-1">
        <p className="text-gray-600 text-[9px] font-semibold uppercase tracking-widest mb-2">% of idle time</p>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { label: 'Color\nmatch', bg: 'bg-blue-50 dark:bg-[#0a2040]',   text: 'text-blue-600 dark:text-blue-300'   },
            { label: 'Wash',        bg: 'bg-amber-50 dark:bg-[#221500]',   text: 'text-amber-600 dark:text-amber-300' },
            { label: 'Idle',        bg: 'bg-gray-100 dark:bg-[#252525]',   text: 'text-gray-600 dark:text-gray-400'  },
          ].map(({ label, bg, text }) => (
            <div key={label} className="flex flex-col items-center gap-1.5">
              <span className={`${bg} ${text} text-[9px] font-semibold rounded w-full text-center leading-tight h-[32px] flex items-center justify-center whitespace-pre-line`}>
                {label}
              </span>
              <span className="text-gray-400 dark:text-gray-600 font-bold text-base tabular-nums">—</span>
            </div>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex h-1.5">
        <div className="bg-[#22C55E]" style={{ width: `${activeFrac}%` }} />
        <div className="bg-[#4B5563] flex-1" style={{ width: `${idleFrac}%` }} />
        <div className="bg-[#1f1f1f] flex-1" />
      </div>
    </motion.div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function FloorView() {
  const { plants, connected } = usePlantsData();
  const { collapsed, hidden: sidebarHidden } = useSidebar();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  const plantList = PLANTS.map(p => plants[p.id] ?? null).filter(Boolean) as PlantState[];

  const dayElapsedSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const clockStr       = format(now, 'HH:mm:ss');

  const { totalPieces, totalActiveStr, totalIdleStr, runningCount } = useMemo(() => {
    const activeS = plantList.reduce((s, p) => s + (p.runtime_s ?? 0), 0);
    const idleS   = plantList.reduce((s, p) => s + (p.idle_s   ?? 0), 0);
    return {
      totalPieces:    plantList.reduce((s, p) => s + (p.total_count ?? 0), 0),
      totalActiveStr: fmtDuration(activeS),
      totalIdleStr:   fmtDuration(idleS),
      runningCount:   plantList.filter(p => p.online && p.belt_active).length,
    };
  }, [plantList]);

  const exportPDF = useCallback(() => {
    const dateStr = format(now, 'MMMM d, yyyy');
    const pdfRows = plantList.map(p => {
      const sess = p.active_session;
      const sessionInfo = sess
        ? `${sess.type === 'accounted' ? `LOT ${sess.lot_no}` : 'Unaccounted'} · ${sess.current_pieces} pcs`
        : 'No Session';
      return `
        <tr>
          <td>${p.plant_name}</td>
          <td>${p.online ? (p.belt_active ? '<span class="running">Running</span>' : '<span class="idle">Idle</span>') : '<span class="offline">Offline</span>'}</td>
          <td>${sessionInfo}</td>
          <td>${(p.total_count ?? 0).toLocaleString()}</td>
          <td>${fmtDuration(p.runtime_s)}</td>
          <td>${fmtDuration(p.idle_s)}</td>
        </tr>`;
    }).join('');
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
        <thead><tr><th>Plant</th><th>Status</th><th>Session</th><th>Pieces</th><th>Active</th><th>Idle</th></tr></thead>
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
          <p className="text-gray-600 text-[10px] font-semibold uppercase tracking-[0.15em] mb-2">Total Pieces Today</p>
          <p className="text-gray-900 dark:text-white font-black text-3xl tabular-nums leading-none mb-0.5">{totalPieces.toLocaleString()}</p>
          <p className="text-gray-600 text-xs">all 6 plants</p>
        </div>
        <div>
          <p className="text-gray-600 text-[10px] font-semibold uppercase tracking-[0.15em] mb-1">Total Active Hrs</p>
          <p className="text-gray-900 dark:text-white font-black text-3xl tabular-nums leading-none mb-0.5">{totalActiveStr}</p>
          <p className="text-gray-600 text-xs">combined</p>
        </div>
        <div>
          <p className="text-gray-600 text-[10px] font-semibold uppercase tracking-[0.15em] mb-1">Total Idle Hrs</p>
          <p className="text-gray-900 dark:text-white font-black text-3xl tabular-nums leading-none mb-0.5">{totalIdleStr}</p>
          <p className="text-gray-600 text-xs">all reasons</p>
        </div>
        <div>
          <p className="text-gray-600 text-[10px] font-semibold uppercase tracking-[0.15em] mb-1">Plants Running</p>
          <p className="text-gray-900 dark:text-white font-black text-3xl tabular-nums leading-none mb-0.5">{runningCount} / {PLANTS.length}</p>
          <p className="text-gray-600 text-xs">right now</p>
        </div>
      </div>

      {/* ── Plant cards — 6 per row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
        {plantList.map((p, i) => (
          <PlantCard
            key={p.plant_id}
            plant={p}
            dayElapsedSecs={dayElapsedSecs}
            now={now}
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
            { color: '#22C55E', label: 'INPROCESS (accounted)' },
            { color: '#F59E0B', label: 'UNACCOUNTED session'   },
            { color: '#6B7280', label: 'No session'            },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-gray-500 text-xs">{label}</span>
            </div>
          ))}
        </div>
        <span className="text-gray-500 text-xs flex-shrink-0">Session data refreshes every 15s</span>
      </div>

    </div>
  );
}
