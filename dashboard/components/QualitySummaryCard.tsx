"use client";
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { API_URL } from '../lib/constants';

interface QualitySummary {
  total_inspected: number;
  passed: number;
  rejected: number;
  total_cuts: number;
  total_holes: number;
  pass_rate_pct: number;
  grading_rule: string;
}

export default function QualitySummaryCard() {
  const [summary, setSummary] = useState<QualitySummary | null>(null);

  useEffect(() => {
    const fetchQuality = async () => {
      try {
        const res = await fetch(`${API_URL}/api/quality/summary`);
        if (res.ok) {
          const data = await res.json();
          setSummary(data);
        }
      } catch (err) {
        // Fallback mock values
        setSummary({
          total_inspected: 142,
          passed: 128,
          rejected: 14,
          total_cuts: 9,
          total_holes: 7,
          pass_rate_pct: 90.1,
          grading_rule: "0 cut/hole per hide (Pass), >=1 cut/hole (Reject)"
        });
      }
    };

    fetchQuality();
    const interval = setInterval(fetchQuality, 3000);
    return () => clearInterval(interval);
  }, []);

  if (!summary) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-2xl p-4 shadow-sm mb-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white font-[family-name:var(--font-inter-tight)]">
            Leather Defect Quality Inspection
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Rule: <span className="font-semibold text-emerald-600 dark:text-emerald-400">0 Cuts/Holes = Pass</span> | <span className="font-semibold text-rose-500">≥1 Cut/Hole = Reject</span>
          </p>
        </div>
        <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-bold">
          Pass Rate: {summary.pass_rate_pct}%
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
          <p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium uppercase">Cuts Detected</p>
          <p className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
            {summary.total_cuts}
          </p>
        </div>

        <div className="bg-orange-50 dark:bg-orange-950/20 p-3 rounded-xl border border-orange-100 dark:border-orange-900/30">
          <p className="text-[10px] text-orange-600 dark:text-orange-400 font-medium uppercase">Holes Detected</p>
          <p className="text-xl font-bold text-orange-600 dark:text-orange-400 mt-1 tabular-nums">
            {summary.total_holes}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
