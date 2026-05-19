"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiDownload, FiFileText } from 'react-icons/fi';
import { PLANTS } from '../../lib/constants';
import { getSummary, getSessions } from '../../lib/api';

interface SummaryData {
  unit: string;
  from: string;
  to: string;
  session_count: number;
  avg_utilization: number | null;
  total_count: number;
}

interface SessionRow {
  unit: string;
  session_num: number;
  piece_count: number;
  is_active: boolean;
}

export default function Reports() {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [unitData, setUnitData] = useState<Record<string, { sessions: number; pieces: number }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch overall summary
        const summaryData = await getSummary();
        if (summaryData) setSummary(summaryData as SummaryData);

        // Fetch all sessions to derive per-unit stats
        const sessionsData = await getSessions();
        if (Array.isArray(sessionsData)) {
          const byUnit: Record<string, { sessions: number; pieces: number }> = {};
          sessionsData.forEach((s: any) => {
            const unit = s.unit || 'Unknown';
            if (!byUnit[unit]) {
              byUnit[unit] = { sessions: 0, pieces: 0 };
            }
            byUnit[unit].sessions += 1;
            byUnit[unit].pieces += s.piece_count || 0;
          });
          setUnitData(byUnit);
        }
      } catch (error) {
        console.warn('Failed to fetch report data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const totalPieces = summary?.total_count || 0;
  const totalSessions = summary?.session_count || 0;
  const avgUtilization = summary?.avg_utilization ?? 0;

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0a0a0a] p-4 md:p-8 font-[family-name:var(--font-inter-tight)]">
      <motion.div
        className="max-w-7xl mx-auto space-y-8"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Header */}
        <div className="pb-6 border-b border-gray-200 dark:border-white/10">
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 tracking-tight">
            Spray Plant Daily Report
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            {loading ? 'Loading data…' : 'Today\'s production summary across all plants'}
          </p>
        </div>

        {/* Summary KPIs */}
        {!loading && totalPieces > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"
          >
            <div className="bg-white dark:bg-[#111] border border-gray-200 dark:border-white/10 rounded-lg p-6">
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Total Pieces</p>
              <p className="text-4xl font-bold text-gray-900 dark:text-white">{totalPieces.toLocaleString()}</p>
            </div>
            <div className="bg-white dark:bg-[#111] border border-gray-200 dark:border-white/10 rounded-lg p-6">
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Sessions</p>
              <p className="text-4xl font-bold text-gray-900 dark:text-white">{totalSessions}</p>
            </div>
            <div className="bg-white dark:bg-[#111] border border-gray-200 dark:border-white/10 rounded-lg p-6">
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Avg Utilization</p>
              <p className="text-4xl font-bold text-gray-900 dark:text-white">{(avgUtilization ?? 0).toFixed(1)}%</p>
            </div>
          </motion.div>
        )}

        {/* Per-Unit Table */}
        {!loading && Object.keys(unitData).length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="bg-white dark:bg-[#111] border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden"
          >
            <div className="p-6 border-b border-gray-200 dark:border-white/10">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Production by Plant</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-[#1a1a1a]">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Plant</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Pieces</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Sessions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-white/10">
                  {PLANTS.map(plant => {
                    const data = unitData[plant.id];
                    return (
                      <tr key={plant.id} className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-semibold text-gray-900 dark:text-white">{plant.id}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{plant.name}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-white">
                          {data?.pieces.toLocaleString() ?? '—'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                          {data?.sessions ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* Download card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6
                     rounded-2xl border border-gray-200 dark:border-white/10
                     bg-white dark:bg-[#111] shadow-sm p-6"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shrink-0">
              <FiFileText className="w-6 h-6" />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-900 dark:text-white">
                Spray Plant Daily Report Template
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                Excel · Spray_Plant_Daily_Report_Template.xlsx
              </p>
            </div>
          </div>

          <a
            href="/Spray_Plant_Daily_Report_Template.xlsx"
            download
            className="inline-flex items-center gap-2 px-5 py-2.5
                       bg-black dark:bg-white text-white dark:text-black
                       rounded-xl font-medium text-sm shadow-lg shadow-black/10 dark:shadow-white/10
                       hover:scale-[1.02] active:scale-95 transition-transform whitespace-nowrap"
          >
            <FiDownload className="w-4 h-4" />
            Download
          </a>
        </motion.div>

        {/* Footer */}
        <div className="pt-4 pb-4 text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Auto-generated by Spray Plant Monitoring System · Dada Enterprises, Kasur
          </p>
        </div>
      </motion.div>
    </div>
  );
}
