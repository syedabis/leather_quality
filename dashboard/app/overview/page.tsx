"use client";
import { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';

import { useTheme } from 'next-themes';
import { usePlantsData } from '../../hooks/usePlantsData';
import { useAlerts } from '../../hooks/useAlerts';
import { PLANTS, fmtDuration, utilColor, API_URL } from '../../lib/constants';
import type { PlantId } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────
type ChartRow = { label: string;[key: string]: string | number };
type FilterRange = 'hour' | 'day' | 'week';


// ── Sub-components ────────────────────────────────────────────────────────────

function ChartTooltip({ payload, label }: TooltipProps<ValueType, NameType>) {
  if (!payload?.length) return null;
  return (
    <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: String(entry.color) }} className="font-medium">
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  iconSrc: string;
  delay?: number;
}

function KpiCard({ label, value, iconSrc, delay = 0 }: KpiCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-3 py-2 shadow-sm flex items-center justify-between gap-2"
    >
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-500 font-medium tracking-wide mb-1 uppercase">{label}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-white leading-tight font-[family-name:var(--font-inter-tight)] truncate">
          {value}
        </p>
      </div>
      <img src={iconSrc} alt="" className="w-12 h-12 object-contain flex-shrink-0 select-none" />
    </motion.div>
  );
}

interface SeriesItem { key: string; color: string; label: string }
interface MiniChartProps {
  title: string;
  data: ChartRow[];
  series: SeriesItem[];
  type?: 'line' | 'bar';
  delay?: number;
}

function MiniChart({ title, data, series, type = 'line', delay = 0 }: MiniChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const gridColor = isDark ? '#2c2c2c' : '#F3F4F6';
  const axisColor = isDark ? '#6B7280' : '#9CA3AF';
  const cursorStroke = isDark ? '#3a3a3a' : '#E5E7EB';
  const cursorFill = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-3 py-2 shadow-sm"
    >
      <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide mb-2">{title}</p>
      <ResponsiveContainer width="100%" height={170}>
        {type === 'bar' ? (
          <BarChart data={data} margin={{ top: 4, right: 8, left: -36, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: cursorFill }} />
            {series.map(s => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color}
                radius={[3, 3, 0, 0]} maxBarSize={8} animationDuration={700} />
            ))}
          </BarChart>
        ) : (
          <LineChart data={data} margin={{ top: 4, right: 8, left: -36, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: cursorStroke, strokeWidth: 1 }} />
            {series.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color}
                strokeWidth={2} dot={{ r: 3, fill: s.color, strokeWidth: 0 }}
                activeDot={{ r: 5 }} animationDuration={700} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </motion.div>
  );
}

type ChartView = 'cumulative' | 'per-plant';

// ── Per-plant color palette (consistent across all charts) ───────────────────
const PLANT_SERIES = [
  { key: 'sp-01', color: '#22C55E', label: 'SP-01' },
  { key: 'sp-02', color: '#F59E0B', label: 'SP-02' },
  { key: 'sp-03', color: '#8B5CF6', label: 'SP-03' },
  { key: 'sp-04', color: '#EF4444', label: 'SP-04' },
  { key: 'sp-05', color: '#3B82F6', label: 'SP-05' },
  { key: 'sp-06', color: '#EC4899', label: 'SP-06' },
];

const PLANT_NAME: Record<string, string> = Object.fromEntries(PLANTS.map(p => [p.id, p.name]));

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Overview() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const gridColor = isDark ? '#2c2c2c' : '#F3F4F6';
  const axisColor = isDark ? '#6B7280' : '#9CA3AF';
  const cursorStroke = isDark ? '#3a3a3a' : '#E5E7EB';
  const cursorFill = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';

  const { plants, connected } = usePlantsData();
  const alerts = useAlerts(plants);
  const [range, setRange] = useState<FilterRange>('hour');
  const [pieceView, setPieceView] = useState<ChartView>('cumulative');
  const [uptimeView, setUptimeView] = useState<ChartView>('cumulative');
  const [idleSessView, setIdleSessView] = useState<ChartView>('cumulative');
  const [idleDurView, setIdleDurView] = useState<ChartView>('cumulative');
  const plantList = PLANTS.map(p => {
    const base = plants[p.id];
    return base || null;
  }).filter(Boolean) as typeof plants[PlantId][];

  // Live (rolling current hour) — aggregated from WS frames
  const { lastHourPieces, avgUtil, totalRuns, maxIdleSecs, avgIdleSecs } = useMemo(() => {
    const idle = plantList.map(p => p.idle_s ?? 0);
    // Average utilization over plants that have ever reported data (util > 0),
    // so the KPI retains the last-known value after inference stops.
    const withData = plantList.filter(p => (p.utilization ?? 0) > 0);
    return {
      lastHourPieces: plantList.reduce((s, p) => s + (p.total_count ?? 0), 0),
      avgUtil: withData.length
        ? Math.round(withData.reduce((s, p) => s + (p.utilization ?? 0), 0) / withData.length)
        : 0,
      totalRuns: plantList.reduce((s, p) => s + (p.session_num ?? 0), 0),
      maxIdleSecs: idle.length ? Math.max(...idle) : 0,
      avgIdleSecs: idle.length ? Math.round(idle.reduce((a, b) => a + b, 0) / idle.length) : 0,
    };
  }, [plantList]);

  // Today's total — fetched from /api/analytics/by-day (refreshed every 60s)
  const [todayTotal, setTodayTotal] = useState(0);
  useEffect(() => {
    const fetchToday = async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const res = await fetch(`${API_URL}/api/analytics/by-day?from=${today}&to=${today}`);
        if (!res.ok) return;
        const data = await res.json();
        const total = (data as Array<{ pieces?: number }>).reduce(
          (s, row) => s + (row.pieces ?? 0), 0,
        );
        setTodayTotal(total);
      } catch (e) {
        console.error('Failed to fetch today total:', e);
      }
    };
    fetchToday();
    const id = setInterval(fetchToday, 5_000);
    return () => clearInterval(id);
  }, []);

  // Chart data state
  const [pieceData, setPieceData] = useState<ChartRow[]>([]);
  const [uptimeData, setUptimeData] = useState<ChartRow[]>([]);
  const [idleSessionsData, setIdleSessionsData] = useState<ChartRow[]>([]);
  const [idleDurationData, setIdleDurationData] = useState<ChartRow[]>([]);

  // Fetch chart data from analytics API based on selected range
  useEffect(() => {
    type Bucket = {
      label: string; total: number; uptime: number; downtime: number; avg: number;
      idle_sessions: number; idle_time_s: number;
      'sp-01': number; 'sp-02': number; 'sp-03': number; 'sp-04': number; 'sp-05': number; 'sp-06': number;
      count: number;
    };
    const newBucket = (label: string): Bucket => ({
      label, total: 0, uptime: 0, downtime: 0, avg: 0,
      idle_sessions: 0, idle_time_s: 0,
      'sp-01': 0, 'sp-02': 0, 'sp-03': 0, 'sp-04': 0, 'sp-05': 0, 'sp-06': 0, count: 0,
    });
    const finalize = (b: Bucket): ChartRow => ({
      label: b.label,
      total: b.total,
      uptime:       b.count ? Math.round((b.uptime   / b.count) * 10) / 10 : 0,
      downtime:     b.count ? Math.round((b.downtime / b.count) * 10) / 10 : 0,
      avg:          b.count ? Math.round((b.avg      / b.count) * 10) / 10 : 0,
      idle_sessions: b.idle_sessions,
      idle_time_s:   Math.round(b.idle_time_s / 60 * 10) / 10,  // convert s → min for display
      'sp-01': b['sp-01'], 'sp-02': b['sp-02'], 'sp-03': b['sp-03'], 'sp-04': b['sp-04'], 'sp-05': b['sp-05'], 'sp-06': b['sp-06'],
    });

    // AbortController so stale in-flight fetches don't overwrite fresh data
    // when the user switches range or the component unmounts.
    const controller = new AbortController();

    const fetchWithAbort = async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        let chartData: ChartRow[] = [];

        if (range === 'hour') {
          const currentHour = new Date().getHours();
          // Pre-fill every hour from 00:00 to current hour so the line is always continuous
          const buckets: Record<number, Bucket> = {};
          for (let h = 0; h <= currentHour; h++) {
            buckets[h] = newBucket(`${String(h).padStart(2, '0')}:00`);
          }

          const all = await Promise.all(
            PLANTS.map(p =>
              fetch(`${API_URL}/api/analytics/by-hour?date=${today}&unit=${p.id}`, { signal: controller.signal })
                .then(r => r.ok ? r.json() : [])
                .catch(() => []),
            ),
          );
          if (controller.signal.aborted) return;
          all.forEach((rows, i) => {
            const unitKey = PLANTS[i].id.toLowerCase() as 'sp-01' | 'sp-02' | 'sp-03' | 'sp-04' | 'sp-05' | 'sp-06';
            (rows as Array<{ hour: number; pieces?: number; uptime_pct?: number; downtime_pct?: number; avg_utilization_pct?: number; idle_sessions?: number; idle_time_s?: number }>).forEach(row => {
              const h = row.hour;
              if (!buckets[h]) buckets[h] = newBucket(`${String(h).padStart(2, '0')}:00`);
              buckets[h].total         += row.pieces ?? 0;
              buckets[h].uptime        += row.uptime_pct ?? 0;
              buckets[h].downtime      += row.downtime_pct ?? 0;
              buckets[h].avg           += row.avg_utilization_pct ?? 0;
              buckets[h].idle_sessions += row.idle_sessions ?? 0;
              buckets[h].idle_time_s   += row.idle_time_s ?? 0;
              buckets[h][unitKey]       = row.pieces ?? 0;
              buckets[h].count++;
            });
          });
          chartData = Object.entries(buckets)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([, b]) => finalize(b));
        } else {
          // 'day' = last 7 days, 'week' = last 30 days
          const days = range === 'week' ? 30 : 7;
          const fromDate = new Date(Date.now() - (days - 1) * 86_400_000);
          const from = fromDate.toISOString().split('T')[0];

          // Pre-fill every date in the range so missing days show as 0 instead of gaps
          const buckets: Record<string, Bucket> = {};
          for (let i = 0; i < days; i++) {
            const d = new Date(fromDate.getTime() + i * 86_400_000).toISOString().split('T')[0];
            buckets[d] = newBucket(d);
          }

          const res = await fetch(`${API_URL}/api/analytics/by-day?from=${from}&to=${today}`, { signal: controller.signal });
          if (!res.ok || controller.signal.aborted) return;
          const data = await res.json() as Array<{ date: string; unit?: string; pieces?: number; uptime_pct?: number; downtime_pct?: number; avg_utilization_pct?: number; idle_sessions?: number; idle_time_s?: number }>;
          if (controller.signal.aborted) return;
          data.forEach(row => {
            const key = row.date;
            if (!buckets[key]) buckets[key] = newBucket(row.date);
            buckets[key].total         += row.pieces ?? 0;
            buckets[key].uptime        += row.uptime_pct ?? 0;
            buckets[key].downtime      += row.downtime_pct ?? 0;
            buckets[key].avg           += row.avg_utilization_pct ?? 0;
            buckets[key].idle_sessions += row.idle_sessions ?? 0;
            buckets[key].idle_time_s   += row.idle_time_s ?? 0;
            if (row.unit) {
              const k = row.unit.toLowerCase() as 'sp-01' | 'sp-02' | 'sp-03' | 'sp-04' | 'sp-05' | 'sp-06';
              buckets[key][k] = (buckets[key][k] || 0) + (row.pieces ?? 0);
            }
            buckets[key].count++;
          });
          chartData = Object.entries(buckets)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, b]) => finalize(b));
        }

        const padded = chartData;

        setPieceData(padded);
        setUptimeData(padded);
        setIdleSessionsData(padded);
        setIdleDurationData(padded);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Failed to fetch analytics:', error);
        }
      }
    };

    fetchWithAbort();
    // Poll every 5 s so charts stay fresh in near-real-time
    const id = setInterval(fetchWithAbort, 5_000);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [range]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0d0d0d] overflow-y-auto p-5 font-[family-name:var(--font-roboto)]">

      {/* ── Page header ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-6 py-4 shadow-sm mb-5 flex items-center justify-between"
      >
        <div className="flex flex-col leading-tight select-none">
          <span className="text-2xl font-black tracking-[0.15em] text-[#8B4513] uppercase" style={{ fontFamily: 'Georgia, serif' }}>
            DADA
          </span>
          <span className="text-[9px] text-[#A0522D] tracking-[0.3em] uppercase font-semibold">
            BESPOKE CONCEPTS
          </span>
        </div>

        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white font-[family-name:var(--font-inter-tight)] tracking-tight">
            Spray Plant Operations Dashboard
          </h1>
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-[#2c2c2c] rounded-lg p-0.5">
            {(['hour', 'day', 'week'] as FilterRange[]).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-all ${range === r
                  ? 'bg-white dark:bg-[#1a1a1a] text-[#2AAA8A] shadow-sm border border-gray-200 dark:border-[#444]'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
              >
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
          <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
            {format(new Date(), 'dd MMM yy')}
          </p>
        </div>
      </motion.div>

      {/* ── KPI row ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <KpiCard label="Today's Pieces" value={todayTotal.toLocaleString()} iconSrc="/icons/3.png" delay={0.05} />
        <KpiCard label="Last Hour Pieces" value={lastHourPieces.toLocaleString()} iconSrc="/icons/4.png" delay={0.10} />
        <KpiCard label="Uptime %" value={`${avgUtil}%`} iconSrc="/icons/5.png" delay={0.15} />
        <KpiCard label="No. of Runs" value={totalRuns.toString()} iconSrc="/icons/6.png" delay={0.20} />
        <KpiCard label="Max Idle Time" value={fmtDuration(maxIdleSecs)} iconSrc="/icons/8.png" delay={0.25} />
        <KpiCard label="Avg Idle Time" value={fmtDuration(avgIdleSecs)} iconSrc="/icons/7.png" delay={0.30} />
      </div>

      {/* ── 2-chart row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">

        {/* Piece Count with toggle */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-3 py-2 shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">Piece Count</p>
            <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-[#2c2c2c] rounded-lg p-0.5">
              {(['cumulative', 'per-plant'] as ChartView[]).map(v => (
                <button key={v} onClick={() => setPieceView(v)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all 
                  ${pieceView === v ? 'bg-white dark:bg-[#1a1a1a] text-[#2AAA8A] shadow-sm border border-gray-200 dark:border-[#444]'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                  {v === 'cumulative' ? 'Cumulative' : 'All Plants'}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart
              data={pieceData}
              margin={{ top: 4, right: 8, left: -36, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: cursorStroke, strokeWidth: 1 }} />
              {pieceView === 'cumulative' ? (
                <Line type="monotone" dataKey="total" name="Total" stroke="#2AAA8A"
                  strokeWidth={2} dot={{ r: 3, fill: '#2AAA8A', strokeWidth: 0 }}
                  activeDot={{ r: 5 }} animationDuration={700} />
              ) : PLANT_SERIES.map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color}
                  strokeWidth={2} dot={{ r: 3, fill: s.color, strokeWidth: 0 }}
                  activeDot={{ r: 5 }} animationDuration={700} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Uptime vs Downtime with toggle */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.40 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-3 py-2 shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">Uptime vs Downtime</p>
            <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-[#2c2c2c] rounded-lg p-0.5">
              {(['cumulative', 'per-plant'] as ChartView[]).map(v => (
                <button
                  key={v}
                  onClick={() => setUptimeView(v)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all 
                  ${uptimeView === v ? 'bg-white dark:bg-[#1a1a1a] text-[#2AAA8A] shadow-sm border border-gray-200 dark:border-[#444]'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                  {v === 'cumulative' ? 'Cumulative' : 'All Plants'}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart
              data={uptimeData}
              margin={{ top: 4, right: 8, left: -36, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: cursorStroke, strokeWidth: 1 }} />
              {uptimeView === 'cumulative' ? (
                <Line type="monotone" dataKey="uptime" name="Uptime %" stroke="#2AAA8A"
                  strokeWidth={2} dot={{ r: 3, fill: '#2AAA8A', strokeWidth: 0 }}
                  activeDot={{ r: 5 }} animationDuration={700} />
              ) : PLANT_SERIES.map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color}
                  strokeWidth={2} dot={{ r: 3, fill: s.color, strokeWidth: 0 }}
                  activeDot={{ r: 5 }} animationDuration={700} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

      </div>

      {/* ── Bottom 4-panel row ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-5" >

        {/* Plants Status — live */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-3 py-2 shadow-sm"
        >
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">Plants Status</p>
          <div className="space-y-1.5">
            {plantList.map(p => (
              <div
                key={p.plant_id}
                className="flex items-center justify-between bg-gray-50 dark:bg-[#111111] border border-gray-100 dark:border-[#2c2c2c] rounded-xl px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-1.5 font-medium text-gray-700 min-w-0">
                  <span className="font-bold text-gray-900 dark:text-white">{PLANT_NAME[p.plant_id] ?? p.plant_id}</span>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${!p.online ? 'bg-gray-400'
                      : p.belt_active ? 'bg-green-500 animate-pulse'
                        : 'bg-amber-400'
                    }`} />
                  <span className={!p.online ? 'text-gray-400' : p.belt_active ? 'text-green-600' : 'text-amber-500'}>
                    {!p.online ? 'Offline' : p.belt_active ? 'Running' : 'Idle'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-gray-500 flex-shrink-0 ml-2">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">{(p.total_count ?? 0).toLocaleString()} pcs</span>
                  <span>{fmtDuration(p.runtime_s ?? 0)}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Idle Sessions chart */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.55 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-3 py-2 shadow-sm flex flex-col"
        >
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">Idle Sessions</p>
            <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-[#2c2c2c] rounded-lg p-0.5">
              {(['cumulative', 'per-plant'] as ChartView[]).map(v => (
                <button key={v} onClick={() => setIdleSessView(v)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all ${idleSessView === v ? 'bg-white dark:bg-[#1a1a1a] text-[#2AAA8A] shadow-sm border border-gray-200 dark:border-[#444]' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                  {v === 'cumulative' ? 'Cumulative' : 'All Plants'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-h-0 relative">
          <div className="absolute inset-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={idleSessionsData} margin={{ top: 4, right: 8, left: -36, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: cursorStroke, strokeWidth: 1 }} />
              {idleSessView === 'cumulative' ? (
                <Line type="monotone" dataKey="idle_sessions" name="Idle Sessions" stroke="#2AAA8A"
                  strokeWidth={2} dot={{ r: 3, fill: '#2AAA8A', strokeWidth: 0 }} activeDot={{ r: 5 }} animationDuration={700} />
              ) : PLANT_SERIES.map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color}
                  strokeWidth={2} dot={{ r: 3, fill: s.color, strokeWidth: 0 }} activeDot={{ r: 5 }} animationDuration={700} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          </div>
          </div>
        </motion.div>

        {/* Idle Sessions Duration chart */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.6 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-3 py-2 shadow-sm flex flex-col"
        >
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">Idle Sessions Duration</p>
            <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-[#2c2c2c] rounded-lg p-0.5">
              {(['cumulative', 'per-plant'] as ChartView[]).map(v => (
                <button key={v} onClick={() => setIdleDurView(v)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all ${idleDurView === v ? 'bg-white dark:bg-[#1a1a1a] text-[#2AAA8A] shadow-sm border border-gray-200 dark:border-[#444]' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                  {v === 'cumulative' ? 'Cumulative' : 'All Plants'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-h-0 relative">
          <div className="absolute inset-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={idleDurationData} margin={{ top: 4, right: 8, left: -36, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: cursorStroke, strokeWidth: 1 }} />
              {idleDurView === 'cumulative' ? (
                <Line type="monotone" dataKey="idle_time_s" name="Idle Time (min)" stroke="#2AAA8A"
                  strokeWidth={2} dot={{ r: 3, fill: '#2AAA8A', strokeWidth: 0 }}
                  activeDot={{ r: 5 }} animationDuration={700} />
              ) : PLANT_SERIES.map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color}
                  strokeWidth={2} dot={{ r: 3, fill: s.color, strokeWidth: 0 }} activeDot={{ r: 5 }} animationDuration={700} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          </div>
          </div>
        </motion.div>

        {/* Alerts — live state-change feed */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.65 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-3 py-2 shadow-sm flex flex-col h-[280px] min-h-[260px]"
        >
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Notifications</p>
            {alerts.length > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500">
                {alerts.filter(a => a.severity === 'critical').length > 0
                  ? `${alerts.filter(a => a.severity === 'critical').length} critical`
                  : `${alerts.length} new`}
              </span>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
            {alerts.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-xs text-gray-400 text-center">No alerts — all plants nominal</p>
              </div>
            ) : (
              alerts.map((alert, i) => {
                const borderColor =
                  alert.severity === 'critical' ? 'border-l-red-500' :
                  alert.severity === 'warning'  ? 'border-l-amber-400' :
                                                  'border-l-emerald-500';
                const dotColor =
                  alert.severity === 'critical' ? 'bg-red-500' :
                  alert.severity === 'warning'  ? 'bg-amber-400' :
                                                  'bg-emerald-500';
                const ts = new Date(alert.timestamp);
                const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                return (
                  <motion.div
                    key={alert.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: i === 0 ? 0 : 0 }}
                    className={`flex items-start gap-2 bg-gray-50 dark:bg-[#111] border border-gray-100 dark:border-[#2c2c2c] border-l-2 ${borderColor} rounded-lg px-2.5 py-1.5`}
                  >
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-gray-800 dark:text-gray-200 leading-snug truncate">
                        {alert.message}
                      </p>
                      <p className="text-[10px] text-gray-400 tabular-nums mt-0.5">{timeStr}</p>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </motion.div>

      </div>

      {/* ── New bottom row: Utilisation by Plant + Pieces by Shift ───── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" >

        {/* Utilisation by Plant */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.7 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-3 shadow-sm flex flex-col"
        >
          <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide mb-2 flex-shrink-0">Utilisation by Plant</p>
          <div className="flex-1 min-h-0 relative">
          <div className="absolute inset-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={plantList.map(p => ({
                plant: PLANT_NAME[p.plant_id] ?? p.plant_id,
                utilization: p.utilization ?? 0
              }))}
              margin={{ top: 4, right: 8, left: -30, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke="#F3F4F6" />
              <XAxis dataKey="plant" tick={{ fill: axisColor, fontSize: 11 }}
                axisLine={{ stroke: gridColor }} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: axisColor, fontSize: 10 }}
                axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                cursor={{ fill: cursorFill }}
                content={({ payload, label }: TooltipProps<ValueType, NameType>) => {
                  if (!payload?.length) return null;
                  return (
                    <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-xl px-3 py-2 shadow-lg text-xs">
                      <span className="text-gray-500 dark:text-gray-400">{label}: </span>
                      <span className="text-gray-900 dark:text-white font-semibold">{payload[0].value}%</span>
                    </div>
                  );
                }}
              />
              <Bar dataKey="utilization" radius={[6, 6, 0, 0]} barSize={32} minPointSize={4} animationDuration={800}>
                {plantList.map(p => (
                  <Cell key={p.plant_id} fill={utilColor(p.utilization ?? 0)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          </div>
          </div>
        </motion.div>

        {/* Pieces by Plant — live */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.75 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-3 shadow-sm"
        >
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">Pieces by Plant</p>
          <div className="space-y-3">
            {plantList.map((p, i) => {
              const pieces = p.total_count ?? 0;
              const max = Math.max(...plantList.map(x => x.total_count ?? 0), 1);
              const pct = Math.round((pieces / max) * 100);
              const color = pieces > 1000 ? '#22C55E' : pieces >= 800 ? '#F59E0B' : '#EF4444';
              const label = PLANT_NAME[p.plant_id] ?? p.plant_id;
              return (
                <div key={p.plant_id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                      {pieces.toLocaleString()} pcs
                    </span>
                  </div>
                  <div className="h-3 bg-gray-100 dark:bg-[#252525] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, delay: 0.75 + i * 0.08, ease: 'easeOut' }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {p.online ? (p.belt_active ? 'Running' : 'Idle') : 'Offline'}
                  </p>
                </div>
              );
            })}
          </div>
        </motion.div>

      </div>
    </div>
  );
}
