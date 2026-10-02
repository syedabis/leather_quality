"use client";
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { API_URL } from '../lib/constants';

interface QualitySummary {
  total_inspected: number;
  passed: number;
  rejected: number;
  total_flaws: number;
  pass_rate_pct: number;
  no_of_desks: number;
}

interface QualitySummaryCardProps {
  selectedDesk?: string;
}

const DESK_DATA_MAP: Record<string, QualitySummary> = {
  all: { total_inspected: 142, passed: 128, rejected: 14, total_flaws: 198, pass_rate_pct: 90.1, no_of_desks: 6 },
  'desk-1': { total_inspected: 28, passed: 26, rejected: 2, total_flaws: 34, pass_rate_pct: 92.8, no_of_desks: 1 },
  'desk-2': { total_inspected: 24, passed: 21, rejected: 3, total_flaws: 38, pass_rate_pct: 87.5, no_of_desks: 1 },
  'desk-3': { total_inspected: 26, passed: 24, rejected: 2, total_flaws: 31, pass_rate_pct: 92.3, no_of_desks: 1 },
  'desk-4': { total_inspected: 22, passed: 19, rejected: 3, total_flaws: 36, pass_rate_pct: 86.4, no_of_desks: 1 },
  'desk-5': { total_inspected: 21, passed: 19, rejected: 2, total_flaws: 29, pass_rate_pct: 90.5, no_of_desks: 1 },
  'desk-6': { total_inspected: 21, passed: 19, rejected: 2, total_flaws: 30, pass_rate_pct: 90.5, no_of_desks: 1 },
};

export default function QualitySummaryCard({ selectedDesk = 'all' }: QualitySummaryCardProps) {
  const [summary, setSummary] = useState<QualitySummary | null>(null);

  useEffect(() => {
    const fetchQuality = async () => {
      try {
        const res = await fetch(`${API_URL}/api/quality/summary?desk=${selectedDesk}`);
        if (res.ok) {
          const data = await res.json();
          setSummary(data);
        } else {
          setSummary(DESK_DATA_MAP[selectedDesk] || DESK_DATA_MAP.all);
        }
      } catch (err) {
        // Fallback mock values per desk
        setSummary(DESK_DATA_MAP[selectedDesk] || DESK_DATA_MAP.all);
      }
    };

    fetchQuality();
    const interval = setInterval(fetchQuality, 3000);
    return () => clearInterval(interval);
  }, [selectedDesk]);

  if (!summary) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-4 shadow-sm mb-5"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-gray-50 dark:bg-[#111111] p-3 rounded-xl border border-gray-100 dark:border-[#2a2a2a]">
          <p className="text-[10px] text-gray-500 font-medium uppercase">Total Inspected</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">
            {summary.total_inspected}
          </p>
        </div>

        <div className="bg-emerald-50 dark:bg-emerald-950/20 p-3 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium uppercase">Passed Hides</p>
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">
            {summary.passed}
          </p>
        </div>

        <div className="bg-rose-50 dark:bg-rose-950/20 p-3 rounded-xl border border-rose-100 dark:border-rose-900/30">
          <p className="text-[10px] text-rose-600 dark:text-rose-400 font-medium uppercase">Rejected Hides</p>
          <p className="text-xl font-bold text-rose-600 dark:text-rose-400 mt-1 tabular-nums">
            {summary.rejected}
          </p>
        </div>

        <div className="bg-amber-50 dark:bg-amber-950/20 p-3 rounded-xl border border-amber-100 dark:border-amber-900/30">
          <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium uppercase">Total Flaws Scanned</p>
          <p className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
            {summary.total_flaws}
          </p>
        </div>

        <div className="bg-sky-50 dark:bg-sky-950/20 p-3 rounded-xl border border-sky-100 dark:border-sky-900/30">
          <p className="text-[10px] text-sky-600 dark:text-sky-400 font-medium uppercase">Passing %</p>
          <p className="text-xl font-bold text-sky-600 dark:text-sky-400 mt-1 tabular-nums">
            {summary.pass_rate_pct}%
          </p>
        </div>

        <div className="bg-purple-50 dark:bg-purple-950/20 p-3 rounded-xl border border-purple-100 dark:border-purple-900/30">
          <p className="text-[10px] text-purple-600 dark:text-purple-400 font-medium uppercase">Target View</p>
          <p className="text-xl font-bold text-purple-600 dark:text-purple-400 mt-1 tabular-nums">
            {selectedDesk === 'all' ? '6 Desks' : selectedDesk.replace('desk-', 'Desk 0')}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
