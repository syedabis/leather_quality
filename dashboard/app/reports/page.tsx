"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { API_URL as API } from '../../lib/constants';

const PLANTS = ['SP-01', 'SP-02', 'SP-03', 'SP-04', 'SP-05', 'SP-06'];
const today  = () => new Date().toISOString().slice(0, 10);

// ── Types ──────────────────────────────────────────────────────────────────

interface PlantRow {
  unit: string; available_hours: number; shift_run_hrs: number;
  idle_time_hrs: number; utilization_pct: number; util_status: string;
  pieces: number; daily_target: number; achievement_pct: number; piece_status: string;
}
interface SummaryData {
  date: string; shift_start: string; shift_end: string;
  available_hours: number; plants: PlantRow[];
}
interface DetailRow {
  row_type: 'session' | 'idle';
  lot_no?: string; order_no?: string; party_name?: string;
  article_name?: string; colour_name?: string; pieces?: number; plant?: string;
  start_time: string; end_time: string; duration_label: string; label?: string;
}
interface DetailPlant {
  plant: string;
  rows: DetailRow[];
  totals: { run_label: string; idle_label: string; pieces: number; utilization_pct: number; };
}
interface DetailData  { date: string; plants: DetailPlant[]; }

interface PlantWiseRow {
  date: string; plant: string; run_time_label: string; idle_time_label: string;
  pieces: number; utilization_pct: number;
}
interface PlantWiseData { from: string; to: string; available_hours: number; rows: PlantWiseRow[]; }

// ── Small shared components ────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const ok = status === 'On Target';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
      ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
         : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'}`}>
      {ok ? '✓' : '△'} {status}
    </span>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="bg-[#1e3a5f] dark:bg-[#0f2035] px-6 py-3">
      <h2 className="text-sm font-bold text-white uppercase tracking-wider text-center">{title}</h2>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-[#111] border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden">
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-4 py-3 text-center text-sm ${className}`}>{children}</td>
  );
}

function DateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
      {label && <span className="whitespace-nowrap">{label}</span>}
      <input type="date" value={value} onChange={e => onChange(e.target.value)}
        className="border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm
                   bg-white dark:bg-[#111] text-gray-900 dark:text-white
                   focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </label>
  );
}

function PlantSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm
                 bg-white dark:bg-[#111] text-gray-900 dark:text-white
                 focus:outline-none focus:ring-2 focus:ring-blue-500">
      <option value="">All Plants</option>
      {PLANTS.map(p => <option key={p} value={p}>{p}</option>)}
    </select>
  );
}

function DownloadButton({ href, disabled }: { href: string; disabled: boolean }) {
  return (
    <a href={disabled ? undefined : href}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold
                  bg-blue-600 text-white transition-colors
                  ${disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : 'hover:bg-blue-700'}`}>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Download Excel
    </a>
  );
}

function Loader() {
  return <div className="text-center py-16 text-gray-400 dark:text-gray-500 text-sm">Loading…</div>;
}

function Empty() {
  return <div className="text-center py-16 text-gray-400 dark:text-gray-500 text-sm">No data for selected filters.</div>;
}

function Err({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4 text-sm text-red-600 dark:text-red-400">
      Failed to load: {msg}
    </div>
  );
}

// ── Tab 1: Daily Summary ───────────────────────────────────────────────────

function DailySummaryTab() {
  const [data, setData]       = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [date, setDate]       = useState(today);

  useEffect(() => {
    setLoading(true); setError(null);
    fetch(`${API}/api/reports/daily-summary?date=${date}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setData).catch(e => setError(String(e))).finally(() => setLoading(false));
  }, [date]);

  const plants = data?.plants ?? [];
  const dlUrl  = `${API}/api/reports/download?type=daily_summary&date=${date}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <DateInput value={date} onChange={setDate} />
        <DownloadButton href={dlUrl} disabled={loading || plants.length === 0} />
      </div>

      {error && <Err msg={error} />}
      {loading && <Loader />}
      {!loading && !error && plants.length === 0 && <Empty />}

      {!loading && plants.length > 0 && (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Shift: {data!.shift_start} – {data!.shift_end} · Available: {data!.available_hours} hrs
          </p>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Card>
              <SectionHeader title="Section 1 — Plant Utilisation (%)" />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-[#1a1a1a]">
                    <tr>{['Plant','Available Hours','Shift Run (hrs)','Idle Time (hrs)','Utilisation %','Status'].map(h => <Th key={h}>{h}</Th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                    {plants.map(p => (
                      <tr key={p.unit} className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
                        <Td className="font-semibold text-gray-900 dark:text-white">{p.unit}</Td>
                        <Td className="text-gray-700 dark:text-gray-300">{p.available_hours}</Td>
                        <Td className="text-gray-700 dark:text-gray-300">{p.shift_run_hrs}</Td>
                        <Td className="text-gray-700 dark:text-gray-300">{p.idle_time_hrs}</Td>
                        <Td className="font-semibold text-gray-900 dark:text-white">{p.utilization_pct}%</Td>
                        <Td><StatusBadge status={p.util_status} /></Td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 dark:bg-[#1a1a1a] font-semibold">
                      <Td colSpan={4} className="text-xs uppercase text-gray-500 dark:text-gray-400">Average Utilisation (All Plants)</Td>
                      <Td className="text-gray-900 dark:text-white">{(plants.reduce((s,p)=>s+p.utilization_pct,0)/plants.length).toFixed(1)}%</Td>
                      <Td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card>
              <SectionHeader title="Section 2 — Pieces Passed Per Plant" />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-[#1a1a1a]">
                    <tr>{['Plant','Pieces','Daily Target','Achievement %','vs Target','Status'].map(h => <Th key={h}>{h}</Th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                    {plants.map(p => {
                      const diff = p.pieces - p.daily_target;
                      return (
                        <tr key={p.unit} className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
                          <Td className="font-semibold text-gray-900 dark:text-white">{p.unit}</Td>
                          <Td className="font-semibold text-gray-900 dark:text-white">{p.pieces.toLocaleString()}</Td>
                          <Td className="text-gray-700 dark:text-gray-300">{p.daily_target.toLocaleString()}</Td>
                          <Td className="text-gray-700 dark:text-gray-300">{p.achievement_pct}%</Td>
                          <Td className={`font-semibold ${diff>=0?'text-emerald-600 dark:text-emerald-400':'text-red-500 dark:text-red-400'}`}>
                            {diff>=0?'+':''}{diff.toLocaleString()}
                          </Td>
                          <Td><StatusBadge status={p.piece_status} /></Td>
                        </tr>
                      );
                    })}
                    <tr className="bg-gray-50 dark:bg-[#1a1a1a] font-semibold">
                      <Td className="text-xs uppercase text-gray-500 dark:text-gray-400">Total (All Plants)</Td>
                      <Td className="text-gray-900 dark:text-white">{plants.reduce((s,p)=>s+p.pieces,0).toLocaleString()}</Td>
                      <Td className="text-gray-900 dark:text-white">{plants.reduce((s,p)=>s+p.daily_target,0).toLocaleString()}</Td>
                      <Td className="text-gray-900 dark:text-white">
                        {(plants.reduce((s,p)=>s+p.pieces,0)/plants.reduce((s,p)=>s+p.daily_target,0)*100).toFixed(1)}%
                      </Td>
                      <Td className={`font-semibold ${plants.reduce((s,p)=>s+p.pieces-p.daily_target,0)>=0?'text-emerald-600 dark:text-emerald-400':'text-red-500 dark:text-red-400'}`}>
                        {(()=>{const d=plants.reduce((s,p)=>s+p.pieces-p.daily_target,0);return(d>=0?'+':'')+d.toLocaleString();})()}
                      </Td>
                      <Td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </motion.div>
        </>
      )}
    </div>
  );
}

// ── Tab 2: Daily Detail ────────────────────────────────────────────────────

function DailyDetailTab() {
  const [data, setData]       = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [date, setDate]       = useState(today);
  const [plant, setPlant]     = useState('');

  const load = useCallback(() => {
    setLoading(true); setError(null);
    const qs = new URLSearchParams({ date });
    if (plant) qs.set('plant', plant);
    fetch(`${API}/api/reports/daily-detail?${qs}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setData).catch(e => setError(String(e))).finally(() => setLoading(false));
  }, [date, plant]);

  useEffect(() => { load(); }, [load]);

  const plants = data?.plants ?? [];
  const dlQs   = new URLSearchParams({ type: 'daily_detail', date, ...(plant ? { plant } : {}) });
  const dlUrl  = `${API}/api/reports/download?${dlQs}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <DateInput value={date} onChange={setDate} />
        <PlantSelect value={plant} onChange={setPlant} />
        <DownloadButton href={dlUrl} disabled={loading || plants.length === 0} />
      </div>

      {error && <Err msg={error} />}
      {loading && <Loader />}
      {!loading && !error && plants.length === 0 && <Empty />}

      {!loading && plants.map((pd, pi) => (
        <motion.div key={pd.plant} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: pi * 0.05 }}>
          <Card>
            <SectionHeader title={`${pd.plant} — Session Timeline`} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-[#1a1a1a]">
                  <tr>
                    {['Lot No','Order No','Party Name','Article','Colour','PCS','Plant','Start','End','Duration'].map(h=><Th key={h}>{h}</Th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {pd.rows.map((row, ri) =>
                    row.row_type === 'session' ? (
                      <tr key={ri} className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
                        <Td className="font-semibold text-gray-900 dark:text-white">{row.lot_no}</Td>
                        <Td className="text-gray-600 dark:text-gray-400">{row.order_no}</Td>
                        <Td className="text-gray-700 dark:text-gray-300">{row.party_name}</Td>
                        <Td className="text-gray-700 dark:text-gray-300">{row.article_name}</Td>
                        <Td className="text-gray-700 dark:text-gray-300">{row.colour_name}</Td>
                        <Td className="font-semibold text-gray-900 dark:text-white">{row.pieces?.toLocaleString()}</Td>
                        <Td className="text-gray-500 dark:text-gray-400">{row.plant}</Td>
                        <Td className="text-gray-700 dark:text-gray-300">{row.start_time}</Td>
                        <Td className="text-gray-700 dark:text-gray-300">{row.end_time}</Td>
                        <Td className="text-gray-700 dark:text-gray-300">{row.duration_label}</Td>
                      </tr>
                    ) : (
                      <tr key={ri} className="bg-amber-50 dark:bg-amber-900/10">
                        <Td colSpan={6} className="font-semibold text-amber-700 dark:text-amber-400 text-left pl-4">{row.label}</Td>
                        <Td className="text-amber-600 dark:text-amber-500" />
                        <Td className="text-amber-700 dark:text-amber-400">{row.start_time}</Td>
                        <Td className="text-amber-700 dark:text-amber-400">{row.end_time}</Td>
                        <Td className="text-amber-700 dark:text-amber-400">{row.duration_label}</Td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
            {/* Totals */}
            <div className="bg-gray-50 dark:bg-[#1a1a1a] border-t border-gray-200 dark:border-white/10 px-6 py-3 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              {[
                { label: 'Total Run Time',  value: pd.totals.run_label },
                { label: 'Total Idle Time', value: pd.totals.idle_label },
                { label: 'Pieces Processed',value: pd.totals.pieces.toLocaleString() },
                { label: 'Utilisation',     value: `${pd.totals.utilization_pct}%` },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
                  <p className="font-semibold text-gray-900 dark:text-white mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

// ── Tab 3: Plant Wise ──────────────────────────────────────────────────────

function PlantWiseTab() {
  const [data, setData]         = useState<PlantWiseData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate]     = useState(today);
  const [plant, setPlant]       = useState('');

  const load = useCallback(() => {
    setLoading(true); setError(null);
    const qs = new URLSearchParams({ from: fromDate, to: toDate });
    if (plant) qs.set('plant', plant);
    fetch(`${API}/api/reports/plant-wise?${qs}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setData).catch(e => setError(String(e))).finally(() => setLoading(false));
  }, [fromDate, toDate, plant]);

  useEffect(() => { load(); }, [load]);

  const rows   = data?.rows ?? [];
  const dlQs   = new URLSearchParams({ type: 'plant_wise', date: fromDate, from: fromDate, to: toDate, ...(plant ? { plant } : {}) });
  const dlUrl  = `${API}/api/reports/download?${dlQs}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <DateInput value={fromDate} onChange={setFromDate} label="From" />
        <DateInput value={toDate}   onChange={setToDate}   label="To" />
        <PlantSelect value={plant} onChange={setPlant} />
        <DownloadButton href={dlUrl} disabled={loading || rows.length === 0} />
      </div>

      {error && <Err msg={error} />}
      {loading && <Loader />}
      {!loading && !error && rows.length === 0 && <Empty />}

      {!loading && rows.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <SectionHeader title="Plant Wise Report" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-[#1a1a1a]">
                  <tr>{['Date','Plant','Total Run Time','Total Idle Time','Pieces Processed','Utilisation %'].map(h=><Th key={h}>{h}</Th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {rows.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
                      <Td className="text-gray-700 dark:text-gray-300">{r.date}</Td>
                      <Td className="font-semibold text-gray-900 dark:text-white">{r.plant}</Td>
                      <Td className="text-gray-700 dark:text-gray-300">{r.run_time_label}</Td>
                      <Td className="text-gray-700 dark:text-gray-300">{r.idle_time_label}</Td>
                      <Td className="font-semibold text-gray-900 dark:text-white">{r.pieces.toLocaleString()}</Td>
                      <Td className={`font-semibold ${r.utilization_pct>=70?'text-emerald-600 dark:text-emerald-400':r.utilization_pct>=40?'text-amber-600 dark:text-amber-400':'text-red-500 dark:text-red-400'}`}>
                        {r.utilization_pct}%
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

// ── Page shell ─────────────────────────────────────────────────────────────

const TABS = [
  { key: 'daily_summary', label: 'Daily Summary' },
  { key: 'daily_detail',  label: 'Daily Detail'  },
  { key: 'plant_wise',    label: 'Plant Wise'     },
] as const;
type TabKey = typeof TABS[number]['key'];

export default function Reports() {
  const [tab, setTab] = useState<TabKey>('daily_summary');

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] p-4 md:p-8 font-(family-name:--font-inter-tight)">
      <motion.div className="max-w-7xl mx-auto space-y-6"
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>

        {/* Header */}
        <div className="pb-4 border-b border-gray-200 dark:border-white/10">
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 tracking-tight">
            Spray Plant Reports
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">Dada Enterprises — Kasur</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 dark:bg-[#1a1a1a] rounded-lg p-1 w-fit">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all
                ${tab === t.key
                  ? 'bg-white dark:bg-[#111] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'daily_summary' && <DailySummaryTab />}
        {tab === 'daily_detail'  && <DailyDetailTab  />}
        {tab === 'plant_wise'    && <PlantWiseTab     />}

        <div className="pt-2 pb-4 text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Auto-generated by Spray Plant Monitoring System · Dada Enterprises, Kasur
          </p>
        </div>
      </motion.div>
    </div>
  );
}
