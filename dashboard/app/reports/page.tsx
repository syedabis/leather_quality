"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { API_URL as API } from '../../lib/constants';

interface PlantRow {
  unit: string;
  available_hours: number;
  shift_run_hrs: number;
  idle_time_hrs: number;
  utilization_pct: number;
  util_status: string;
  pieces: number;
  daily_target: number;
  achievement_pct: number;
  piece_status: string;
}

interface SummaryData {
  date: string;
  shift_start: string;
  shift_end: string;
  available_hours: number;
  plants: PlantRow[];
}

function StatusBadge({ status }: { status: string }) {
  const onTarget = status === 'On Target';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
      onTarget
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
        : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
    }`}>
      {onTarget ? '✓' : '△'} {status}
    </span>
  );
}

export default function Reports() {
  const [data, setData]       = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [date, setDate]       = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API}/api/reports/daily-summary?date=${date}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [date]);

  const plants = data?.plants ?? [];

  function downloadReport() {
    if (!data || plants.length === 0) return;
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push(esc(`Spray Plant Daily Report — ${data.date}`));
    lines.push(esc(`Shift: ${data.shift_start} – ${data.shift_end} | Available: ${data.available_hours} hrs`));
    lines.push('');
    lines.push('Section 1 — Plant Utilisation');
    lines.push(['Plant', 'Available Hours', 'Shift Run (hrs)', 'Idle Time (hrs)', 'Utilisation %', 'Status'].map(esc).join(','));
    plants.forEach(p => lines.push(
      [p.unit, p.available_hours, p.shift_run_hrs, p.idle_time_hrs, p.utilization_pct, p.util_status].map(esc).join(',')
    ));
    lines.push('');
    lines.push('Section 2 — Pieces Passed Per Plant');
    lines.push(['Plant', 'Pieces', 'Daily Target', 'Achievement %', 'vs Target', 'Status'].map(esc).join(','));
    plants.forEach(p => lines.push(
      [p.unit, p.pieces, p.daily_target, p.achievement_pct, p.pieces - p.daily_target, p.piece_status].map(esc).join(',')
    ));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `SprayPlant_Report_${data.date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] p-4 md:p-8 font-[family-name:var(--font-inter-tight)]">
      <motion.div
        className="max-w-7xl mx-auto space-y-8"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-gray-200 dark:border-white/10">
          <div>
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 tracking-tight">
              Spray Plant Daily Report
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
              {data ? `Shift: ${data.shift_start} – ${data.shift_end}  |  Available: ${data.available_hours} hrs` : 'Loading…'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm
                         bg-white dark:bg-[#111] text-gray-900 dark:text-white
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={downloadReport}
              disabled={loading || plants.length === 0}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold
                         bg-blue-600 text-white hover:bg-blue-700 transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4 text-sm text-red-600 dark:text-red-400">
            Failed to load report: {error}
          </div>
        )}

        {loading && (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500 text-sm">Loading…</div>
        )}

        {!loading && !error && plants.length === 0 && (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500 text-sm">No data for this date.</div>
        )}

        {!loading && plants.length > 0 && (
          <>
            {/* Section 1 — Plant Utilisation */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="bg-white dark:bg-[#111] border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden"
            >
              <div className="bg-[#1e3a5f] dark:bg-[#0f2035] px-6 py-3">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider text-center">
                  Section 1 — Plant Utilisation (%)
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-[#1a1a1a]">
                    <tr>
                      {['Plant', 'Available Hours', 'Shift Run (hrs)', 'Idle Time (hrs)', 'Utilisation %', 'Status'].map(h => (
                        <th key={h} className="px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                    {plants.map(p => (
                      <tr key={p.unit} className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
                        <td className="px-4 py-3 text-center font-semibold text-gray-900 dark:text-white">{p.unit}</td>
                        <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{p.available_hours}</td>
                        <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{p.shift_run_hrs}</td>
                        <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{p.idle_time_hrs}</td>
                        <td className="px-4 py-3 text-center font-semibold text-gray-900 dark:text-white">{p.utilization_pct}%</td>
                        <td className="px-4 py-3 text-center"><StatusBadge status={p.util_status} /></td>
                      </tr>
                    ))}
                    {/* Average row */}
                    <tr className="bg-gray-50 dark:bg-[#1a1a1a] font-semibold">
                      <td colSpan={4} className="px-4 py-3 text-center text-xs uppercase text-gray-500 dark:text-gray-400">
                        Average Utilisation (All Plants)
                      </td>
                      <td className="px-4 py-3 text-center text-gray-900 dark:text-white">
                        {(plants.reduce((s, p) => s + p.utilization_pct, 0) / plants.length).toFixed(1)}%
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </motion.div>

            {/* Section 2 — Pieces Per Plant */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="bg-white dark:bg-[#111] border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden"
            >
              <div className="bg-[#1e3a5f] dark:bg-[#0f2035] px-6 py-3">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider text-center">
                  Section 2 — Pieces Passed Per Plant
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-[#1a1a1a]">
                    <tr>
                      {['Plant', 'Pieces', 'Daily Target', 'Achievement %', 'vs Target', 'Status'].map(h => (
                        <th key={h} className="px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                    {plants.map(p => {
                      const diff = p.pieces - p.daily_target;
                      return (
                        <tr key={p.unit} className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
                          <td className="px-4 py-3 text-center font-semibold text-gray-900 dark:text-white">{p.unit}</td>
                          <td className="px-4 py-3 text-center font-semibold text-gray-900 dark:text-white">{p.pieces.toLocaleString()}</td>
                          <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{p.daily_target.toLocaleString()}</td>
                          <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{p.achievement_pct}%</td>
                          <td className={`px-4 py-3 text-center font-semibold ${diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                            {diff >= 0 ? '+' : ''}{diff.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-center"><StatusBadge status={p.piece_status} /></td>
                        </tr>
                      );
                    })}
                    {/* Total row */}
                    <tr className="bg-gray-50 dark:bg-[#1a1a1a] font-semibold">
                      <td className="px-4 py-3 text-center text-xs uppercase text-gray-500 dark:text-gray-400">Total (All Plants)</td>
                      <td className="px-4 py-3 text-center text-gray-900 dark:text-white">
                        {plants.reduce((s, p) => s + p.pieces, 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-900 dark:text-white">
                        {plants.reduce((s, p) => s + p.daily_target, 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-900 dark:text-white">
                        {(plants.reduce((s, p) => s + p.pieces, 0) / plants.reduce((s, p) => s + p.daily_target, 0) * 100).toFixed(1)}%
                      </td>
                      <td className={`px-4 py-3 text-center font-semibold ${
                        plants.reduce((s, p) => s + p.pieces - p.daily_target, 0) >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-500 dark:text-red-400'
                      }`}>
                        {(() => { const d = plants.reduce((s, p) => s + p.pieces - p.daily_target, 0); return (d >= 0 ? '+' : '') + d.toLocaleString(); })()}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </motion.div>
          </>
        )}

        {/* Footer */}
        <div className="pt-2 pb-4 text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Auto-generated by Spray Plant Monitoring System · Dada Enterprises, Kasur
          </p>
        </div>
      </motion.div>
    </div>
  );
}
