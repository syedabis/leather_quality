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
import QualitySummaryCard from '../../components/QualitySummaryCard';

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
const PLANT_COLORS = [
  { id: 'sp-01', color: '#22C55E', label: 'SP-01' },
  { id: 'sp-02', color: '#F59E0B', label: 'SP-02' },
];
const PLANT_SERIES         = PLANT_COLORS.map(p => ({ key: p.id,                  color: p.color, label: p.label }));
const PLANT_SERIES_UPTIME  = PLANT_COLORS.map(p => ({ key: `${p.id}-uptime`,      color: p.color, label: p.label }));
const PLANT_SERIES_IDLE_S  = PLANT_COLORS.map(p => ({ key: `${p.id}-idle_sess`,   color: p.color, label: p.label }));
const PLANT_SERIES_IDLE_T  = PLANT_COLORS.map(p => ({ key: `${p.id}-idle_time`,   color: p.color, label: p.label }));

const PLANT_NAME: Record<string, string> = Object.fromEntries(PLANTS.map(p => [p.id, p.name]));

// ── Main page ─────────────────────────────────────────────────────────────────

// ── Desk Selection Constants & Data ─────────────────────────────────────────
const GRADING_DESKS = [
  { id: 'all', label: 'All Desks' },
  { id: 'desk-1', label: 'Desk 01' },
  { id: 'desk-2', label: 'Desk 02' },
  { id: 'desk-3', label: 'Desk 03' },
  { id: 'desk-4', label: 'Desk 04' },
  { id: 'desk-5', label: 'Desk 05' },
  { id: 'desk-6', label: 'Desk 06' },
];

const DESK_KPIS: Record<string, { gradeA: string; gradeBC: string; reject: string; area: string; thickness: string; density: string }> = {
  all:     { gradeA: '48.5%', gradeBC: '41.2%', reject: '10.3%', area: '684.2 m²', thickness: '1.88 mm', density: '1.4 / hide' },
  'desk-1': { gradeA: '52.4%', gradeBC: '40.4%', reject: '7.2%',  area: '124.5 m²', thickness: '1.92 mm', density: '1.2 / hide' },
  'desk-2': { gradeA: '44.0%', gradeBC: '43.5%', reject: '12.5%', area: '110.8 m²', thickness: '1.84 mm', density: '1.6 / hide' },
  'desk-3': { gradeA: '50.1%', gradeBC: '39.9%', reject: '10.0%', area: '115.0 m²', thickness: '1.89 mm', density: '1.3 / hide' },
  'desk-4': { gradeA: '46.8%', gradeBC: '42.1%', reject: '11.1%', area: '108.4 m²', thickness: '1.86 mm', density: '1.5 / hide' },
  'desk-5': { gradeA: '49.2%', gradeBC: '41.0%', reject: '9.8%',  area: '112.5 m²', thickness: '1.90 mm', density: '1.3 / hide' },
  'desk-6': { gradeA: '47.5%', gradeBC: '41.5%', reject: '11.0%', area: '113.0 m²', thickness: '1.87 mm', density: '1.4 / hide' },
};

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
  const [selectedDesk, setSelectedDesk] = useState<string>('all');
  const [pieceView, setPieceView] = useState<ChartView>('cumulative');
  const [uptimeView, setUptimeView] = useState<ChartView>('cumulative');
  const [idleSessView, setIdleSessView] = useState<ChartView>('cumulative');
  const [idleDurView, setIdleDurView] = useState<ChartView>('cumulative');
  const plantList = PLANTS.map(p => {
    const base = plants[p.id];
    return base || null;
  }).filter(Boolean) as typeof plants[PlantId][];

  // Live KPIs — aggregated from WS frames
  const { avgUtil, totalRuns, maxIdleSecs, avgIdleSecs } = useMemo(() => {
    const idle = plantList.map(p => p.idle_s ?? 0);
    const withData = plantList.filter(p => (p.utilization ?? 0) > 0);
    return {
      avgUtil: withData.length
        ? Math.round(withData.reduce((s, p) => s + (p.utilization ?? 0), 0) / withData.length)
        : 0,
      totalRuns: plantList.reduce((s, p) => s + (p.session_num ?? 0), 0),
      maxIdleSecs: idle.length ? Math.max(...idle) : 0,
      avgIdleSecs: idle.length ? Math.round(idle.reduce((a, b) => a + b, 0) / idle.length) : 0,
    };
  }, [plantList]);

  // Last hour pieces — sum of all plants for the previous completed hour
  const [lastHourPieces, setLastHourPieces] = useState(0);
  useEffect(() => {
    const fetchLastHour = async () => {
      try {
        // Use local date/hour for "one hour ago" so the lookup stays correct
        // across midnight (hour 0 -> hour 23 of the previous day) and doesn't
        // mix the browser's UTC date with its local hour.
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const today = `${oneHourAgo.getFullYear()}-${String(oneHourAgo.getMonth() + 1).padStart(2, '0')}-${String(oneHourAgo.getDate()).padStart(2, '0')}`;
        const targetHour = oneHourAgo.getHours();
        const results = await Promise.all(
          PLANTS.map(p =>
            fetch(`${API_URL}/api/analytics/by-hour?date=${today}&unit=${p.id}`)
              .then(r => r.ok ? r.json() : [])
              .catch(() => [])
          )
        );
        const total = results.reduce((sum, rows) => {
          const row = (rows as Array<{ hour: number; pieces?: number }>)
            .find(r => r.hour === targetHour);
          return sum + (row?.pieces ?? 0);
        }, 0);
        setLastHourPieces(total);
      } catch {
        // keep previous value on error
      }
    };
    fetchLastHour();
    const id = setInterval(fetchLastHour, 60_000);
    return () => clearInterval(id);
  }, []);

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
      'sp-01-uptime': number; 'sp-02-uptime': number; 'sp-03-uptime': number; 'sp-04-uptime': number; 'sp-05-uptime': number; 'sp-06-uptime': number;
      'sp-01-idle_sess': number; 'sp-02-idle_sess': number; 'sp-03-idle_sess': number; 'sp-04-idle_sess': number; 'sp-05-idle_sess': number; 'sp-06-idle_sess': number;
      'sp-01-idle_time': number; 'sp-02-idle_time': number; 'sp-03-idle_time': number; 'sp-04-idle_time': number; 'sp-05-idle_time': number; 'sp-06-idle_time': number;
      count: number;
    };
    const newBucket = (label: string): Bucket => ({
      label, total: 0, uptime: 0, downtime: 0, avg: 0,
      idle_sessions: 0, idle_time_s: 0,
      'sp-01': 0, 'sp-02': 0, 'sp-03': 0, 'sp-04': 0, 'sp-05': 0, 'sp-06': 0,
      'sp-01-uptime': 0, 'sp-02-uptime': 0, 'sp-03-uptime': 0, 'sp-04-uptime': 0, 'sp-05-uptime': 0, 'sp-06-uptime': 0,
      'sp-01-idle_sess': 0, 'sp-02-idle_sess': 0, 'sp-03-idle_sess': 0, 'sp-04-idle_sess': 0, 'sp-05-idle_sess': 0, 'sp-06-idle_sess': 0,
      'sp-01-idle_time': 0, 'sp-02-idle_time': 0, 'sp-03-idle_time': 0, 'sp-04-idle_time': 0, 'sp-05-idle_time': 0, 'sp-06-idle_time': 0,
      count: 0,
    });
    const finalize = (b: Bucket): ChartRow => ({
      label: b.label,
      total: b.total,
      uptime:       b.count ? Math.round((b.uptime   / b.count) * 10) / 10 : 0,
      downtime:     b.count ? Math.round((b.downtime / b.count) * 10) / 10 : 0,
      avg:          b.count ? Math.round((b.avg      / b.count) * 10) / 10 : 0,
      idle_sessions: b.idle_sessions,
      idle_time_s:   Math.round(b.idle_time_s / 60 * 10) / 10,
      'sp-01': b['sp-01'], 'sp-02': b['sp-02'], 'sp-03': b['sp-03'], 'sp-04': b['sp-04'], 'sp-05': b['sp-05'], 'sp-06': b['sp-06'],
      'sp-01-uptime': b['sp-01-uptime'], 'sp-02-uptime': b['sp-02-uptime'], 'sp-03-uptime': b['sp-03-uptime'], 'sp-04-uptime': b['sp-04-uptime'], 'sp-05-uptime': b['sp-05-uptime'], 'sp-06-uptime': b['sp-06-uptime'],
      'sp-01-idle_sess': b['sp-01-idle_sess'], 'sp-02-idle_sess': b['sp-02-idle_sess'], 'sp-03-idle_sess': b['sp-03-idle_sess'], 'sp-04-idle_sess': b['sp-04-idle_sess'], 'sp-05-idle_sess': b['sp-05-idle_sess'], 'sp-06-idle_sess': b['sp-06-idle_sess'],
      'sp-01-idle_time': b['sp-01-idle_time'], 'sp-02-idle_time': b['sp-02-idle_time'], 'sp-03-idle_time': b['sp-03-idle_time'], 'sp-04-idle_time': b['sp-04-idle_time'], 'sp-05-idle_time': b['sp-05-idle_time'], 'sp-06-idle_time': b['sp-06-idle_time'],
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
              const bh = buckets[h] as unknown as Record<string, number>;
              bh[unitKey]                   = row.pieces ?? 0;
              bh[`${unitKey}-uptime`]       = row.uptime_pct ?? 0;
              bh[`${unitKey}-idle_sess`]    = row.idle_sessions ?? 0;
              bh[`${unitKey}-idle_time`]    = row.idle_time_s ? Math.round((row.idle_time_s / 60) * 10) / 10 : 0;
              buckets[h].count++;
            });
          });
          chartData = Object.entries(buckets)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([, b]) => finalize(b));

          // Convert idle metrics to running totals so the line rises through the day
          // instead of falling (per-hour idle is high overnight, low when plants run).
          let runIdleSess = 0;
          let runIdleTime = 0;
          const runIdleSessP: Record<string, number> = {};
          const runIdleTimeP: Record<string, number> = {};
          chartData = chartData.map(row => {
            runIdleSess += (row.idle_sessions as number) ?? 0;
            runIdleTime += (row.idle_time_s as number) ?? 0;
            const updated: ChartRow = { ...row, idle_sessions: runIdleSess, idle_time_s: Math.round(runIdleTime * 10) / 10 };
            for (const p of PLANTS) {
              const k = p.id.toLowerCase();
              const sk = `${k}-idle_sess`;
              const tk = `${k}-idle_time`;
              runIdleSessP[sk] = (runIdleSessP[sk] ?? 0) + ((row[sk] as number) ?? 0);
              runIdleTimeP[tk] = (runIdleTimeP[tk] ?? 0) + ((row[tk] as number) ?? 0);
              updated[sk] = runIdleSessP[sk];
              updated[tk] = Math.round(runIdleTimeP[tk] * 10) / 10;
            }
            return updated;
          });
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
              const bk = buckets[key] as unknown as Record<string, number>;
              bk[k]               = (bk[k] || 0) + (row.pieces ?? 0);
              bk[`${k}-uptime`]   = row.uptime_pct ?? 0;
              bk[`${k}-idle_sess`]= (bk[`${k}-idle_sess`] || 0) + (row.idle_sessions ?? 0);
              bk[`${k}-idle_time`]= (bk[`${k}-idle_time`] || 0) + (row.idle_time_s ? Math.round((row.idle_time_s / 60) * 10) / 10 : 0);
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
            Leather Quality Inspection Operations Dashboard
          </h1>
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
        </div>

        <div className="flex items-center gap-3">
          {/* Desk Selector Dropdown */}
          <div className="relative">
            <select
              value={selectedDesk}
              onChange={(e) => setSelectedDesk(e.target.value)}
              className="bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-[#2c2c2c] text-gray-900 dark:text-gray-100 text-xs font-semibold rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer shadow-sm transition-all hover:border-gray-300 dark:hover:border-[#444]"
            >
              {GRADING_DESKS.map(desk => (
                <option key={desk.id} value={desk.id} className="bg-white dark:bg-[#1a1a1a] text-xs py-1">
                  🖥️ {desk.label}
                </option>
              ))}
            </select>
          </div>

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

      {/* ── Leather Quality Inspection Card ──────────────────────────── */}
      <QualitySummaryCard selectedDesk={selectedDesk} />

      {/* ── KPI row: Leather Grading Desk Telemetry ───────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <KpiCard label="Grade A Yield" value={DESK_KPIS[selectedDesk]?.gradeA ?? '48.5%'} iconSrc="/grading_desk (Icons)/Grade A Yield.png" delay={0.05} />
        <KpiCard label="Grade B/C Yield" value={DESK_KPIS[selectedDesk]?.gradeBC ?? '41.2%'} iconSrc="/grading_desk (Icons)/Grade B_C Yield.png" delay={0.10} />
        <KpiCard label="Rejection Rate" value={DESK_KPIS[selectedDesk]?.reject ?? '10.3%'} iconSrc="/grading_desk (Icons)/Rejection Rate.png" delay={0.15} />
        <KpiCard label="Scanned Area" value={DESK_KPIS[selectedDesk]?.area ?? '684.2 m²'} iconSrc="/grading_desk (Icons)/Scanned Area.png" delay={0.20} />
        <KpiCard label="Avg Thickness" value={DESK_KPIS[selectedDesk]?.thickness ?? '1.88 mm'} iconSrc="/grading_desk (Icons)/Avg Thickness.png" delay={0.25} />
        <KpiCard label="Defect Density" value={DESK_KPIS[selectedDesk]?.density ?? '1.4 / hide'} iconSrc="/grading_desk (Icons)/Defect Density.png" delay={0.30} />
      </div>

      {/* ── 2-chart row: Grade Distribution & Vertical Defect Frequency Histogram ────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">

        {/* Grade Distribution Over Time */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-4 shadow-sm"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wide">Grade Yield Distribution</p>
              <div className="flex items-center gap-2.5 text-[10px] font-semibold mt-1">
                <span className="flex items-center gap-1 text-emerald-500"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"/>Grade A</span>
                <span className="flex items-center gap-1 text-blue-500"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"/>Grade B</span>
                <span className="flex items-center gap-1 text-amber-500"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block"/>Grade C</span>
                <span className="flex items-center gap-1 text-rose-500"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block"/>Reject</span>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Live Grading Feed
            </span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={[
                { time: '08:00', gradeA: 28, gradeB: 18, gradeC: 8, reject: 4 },
                { time: '09:00', gradeA: 34, gradeB: 22, gradeC: 10, reject: 5 },
                { time: '10:00', gradeA: 42, gradeB: 26, gradeC: 12, reject: 6 },
                { time: '11:00', gradeA: 38, gradeB: 24, gradeC: 9, reject: 3 },
                { time: '12:00', gradeA: 45, gradeB: 30, gradeC: 14, reject: 7 },
                { time: '13:00', gradeA: 50, gradeB: 32, gradeC: 11, reject: 4 },
                { time: '14:00', gradeA: 44, gradeB: 28, gradeC: 10, reject: 5 },
              ]}
              margin={{ top: 4, right: 8, left: -25, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="time" tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: cursorFill }} />
              <Bar dataKey="gradeA" name="Grade A (Premium)" fill="#22c55e" radius={[3, 3, 0, 0]} maxBarSize={12} />
              <Bar dataKey="gradeB" name="Grade B (Standard)" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={12} />
              <Bar dataKey="gradeC" name="Grade C (Commercial)" fill="#eab308" radius={[3, 3, 0, 0]} maxBarSize={12} />
              <Bar dataKey="reject" name="Reject / Reclass" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={12} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Vertical Defect Frequency Histogram with Hover Definition Tooltips */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.40 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-4 shadow-sm"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wide">Top Defect Frequency Histogram</p>
              <p className="text-[10px] text-gray-500">Hover over defect codes for full classification definition</p>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
              FinishSelect Scan
            </span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={[
                { code: 'C', name: 'Cut Mark', category: 'Critical', desc: 'Sharp knife cut or mechanical score mark.', count: 42, color: '#06b6d4' },
                { code: 'H', name: 'Hole', category: 'Critical', desc: 'Complete puncture or void through hide surface.', count: 28, color: '#7c3aed' },
                { code: 'DHS', name: 'Deep Scratch', category: 'Critical', desc: 'Deep scratch below grain layer.', count: 24, color: '#d946ef' },
                { code: 'IB', name: 'Insect Bite', category: 'Surface', desc: 'Raised spots or scars from insect bites.', count: 19, color: '#ea580c' },
                { code: 'LG', name: 'Light Grain', category: 'Grain', desc: 'Mild texture or grain pattern irregularity.', count: 15, color: '#84cc16' },
                { code: 'HG', name: 'Heavy Grain', category: 'Grain', desc: 'Coarse or uneven grain structure.', count: 12, color: '#22c55e' },
                { code: 'NW', name: 'Natural Wrinkle', category: 'Natural', desc: 'Natural neck and shoulder growth wrinkles.', count: 11, color: '#0d9488' },
                { code: 'PS', name: 'Pin Spot', category: 'Surface', desc: 'Small pinpoint surface discolouration spot.', count: 8, color: '#0284c7' },
              ]}
              margin={{ top: 12, right: 8, left: -25, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="code" tick={{ fill: axisColor, fontSize: 11, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: cursorFill }}
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <div className="bg-[#121212] border border-[#2c2c2c] rounded-xl p-3 shadow-xl max-w-[220px] text-xs">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-extrabold text-sm px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: data.color }}>
                          {data.code}
                        </span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase bg-white/10 text-gray-300">
                          {data.category}
                        </span>
                      </div>
                      <p className="font-bold text-white text-xs mb-1">{data.name}</p>
                      <p className="text-[10px] text-gray-400 mb-2 leading-tight">{data.desc}</p>
                      <div className="flex justify-between items-center border-t border-white/10 pt-1.5 text-[11px]">
                        <span className="text-gray-400">Occurrences:</span>
                        <span className="font-bold text-emerald-400">{data.count} logged</span>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="count" name="Defect Count" radius={[4, 4, 0, 0]} maxBarSize={22}>
                {[
                  { code: 'C', color: '#06b6d4' },
                  { code: 'H', color: '#7c3aed' },
                  { code: 'DHS', color: '#d946ef' },
                  { code: 'IB', color: '#ea580c' },
                  { code: 'LG', color: '#84cc16' },
                  { code: 'HG', color: '#22c55e' },
                  { code: 'NW', color: '#0d9488' },
                  { code: 'PS', color: '#0284c7' },
                ].map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

      </div>

      {/* ── Bottom 4-panel row: Desk Lots & Quality Audit ────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">

        {/* Desk Inspection Lots */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-3 py-3 shadow-sm"
        >
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">Inspection Desk Lots</p>
          <div className="space-y-2">
            {[
              { lot: 'LOT-2026-0922', article: 'Cow Hide Crust', gradeA: '52%', total: 142 },
              { lot: 'LOT-2026-0921', article: 'Buffalo Upper', gradeA: '46%', total: 118 },
              { lot: 'LOT-2026-0920', article: 'Sheep Nappa', gradeA: '61%', total: 95 },
            ].map(item => (
              <div
                key={item.lot}
                className="flex items-center justify-between bg-gray-50 dark:bg-[#111111] border border-gray-100 dark:border-[#2c2c2c] rounded-xl px-3 py-2 text-xs"
              >
                <div>
                  <p className="font-bold text-gray-900 dark:text-white">{item.lot}</p>
                  <p className="text-[10px] text-gray-500">{item.article}</p>
                </div>
                <div className="text-right">
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{item.gradeA} Grade A</span>
                  <p className="text-[10px] text-gray-400">{item.total} hides</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Thickness Caliper Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.55 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-3 py-3 shadow-sm flex flex-col"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">Caliper Thickness Spread</p>
            <span className="text-[10px] font-bold text-emerald-500">Target 1.8 - 2.0 mm</span>
          </div>
          <div className="space-y-2 text-xs">
            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-gray-500">1.8mm - 2.0mm (Uniform Spec)</span>
                <span className="font-bold text-emerald-400">72%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-[#252525] h-2 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full rounded-full" style={{ width: '72%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-gray-500">1.6mm - 1.79mm (Under Target)</span>
                <span className="font-bold text-amber-400">18%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-[#252525] h-2 rounded-full overflow-hidden">
                <div className="bg-amber-500 h-full rounded-full" style={{ width: '18%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-gray-500">&gt; 2.01mm (Over Target)</span>
                <span className="font-bold text-sky-400">10%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-[#252525] h-2 rounded-full overflow-hidden">
                <div className="bg-sky-500 h-full rounded-full" style={{ width: '10%' }} />
              </div>
            </div>
          </div>
        </motion.div>

        {/* Defect Category Breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.6 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-3 py-3 shadow-sm flex flex-col justify-between"
        >
          <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide mb-2">Defect Category Severity</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-rose-500/10 border border-rose-500/20 p-2 rounded-xl">
              <span className="text-[10px] font-bold text-rose-400 uppercase">Critical</span>
              <p className="text-lg font-extrabold text-rose-400 mt-0.5">54%</p>
              <p className="text-[9px] text-gray-400">Cuts, Holes, DHS</p>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 p-2 rounded-xl">
              <span className="text-[10px] font-bold text-amber-400 uppercase">Surface</span>
              <p className="text-lg font-extrabold text-amber-400 mt-0.5">26%</p>
              <p className="text-[9px] text-gray-400">Bites, Pinspots</p>
            </div>
            <div className="bg-lime-500/10 border border-lime-500/20 p-2 rounded-xl">
              <span className="text-[10px] font-bold text-lime-400 uppercase">Grain</span>
              <p className="text-lg font-extrabold text-lime-400 mt-0.5">12%</p>
              <p className="text-[9px] text-gray-400">Light / Heavy</p>
            </div>
            <div className="bg-teal-500/10 border border-teal-500/20 p-2 rounded-xl">
              <span className="text-[10px] font-bold text-teal-400 uppercase">Natural</span>
              <p className="text-lg font-extrabold text-teal-400 mt-0.5">8%</p>
              <p className="text-[9px] text-gray-400">Wrinkles, Veins</p>
            </div>
          </div>
        </motion.div>

        {/* Notifications — live state-change feed */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.65 }}
          className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl px-3 py-2 shadow-sm flex flex-col h-[230px]"
        >
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Quality Notifications</p>
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
                <p className="text-xs text-gray-400 text-center">No alerts — all hides in spec</p>
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
                  <div
                    key={i}
                    className={`p-2 rounded-xl bg-gray-50 dark:bg-[#111111] border border-gray-100 dark:border-[#2c2c2c] border-l-2 ${borderColor} text-xs shadow-sm`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                        <span className="font-bold text-gray-900 dark:text-white text-[11px]">
                          {alert.plant_id}
                        </span>
                      </div>
                      <span className="text-[9px] text-gray-400 font-mono">{timeStr}</span>
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                      {alert.message}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>

      </div>
    </div>
  );
}
