"use client";
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { FiAlertCircle, FiAlertTriangle, FiInfo, FiCheck } from 'react-icons/fi';
import { API_URL } from '../../lib/constants';
import { useNotifications, type NotificationItem } from '../../contexts/NotificationsContext';

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}  ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch { return iso; }
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === 'error') return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
      <FiAlertCircle className="w-3 h-3" /> Error
    </span>
  );
  if (severity === 'warning') return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
      <FiAlertTriangle className="w-3 h-3" /> Warning
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
      <FiInfo className="w-3 h-3" /> Info
    </span>
  );
}

export default function Notifications() {
  const [items, setItems]   = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { unread, markAllRead, refreshUnread } = useNotifications();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/notifications?limit=300`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data?.data) ? data.data : []);
    } catch (err) {
      console.warn('Failed to fetch notifications:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch on mount, on the live unread count changing, and every 15s.
  useEffect(() => { load(); }, [load, unread]);
  useEffect(() => {
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const onMarkRead = async () => {
    await markAllRead();
    await load();
    await refreshUnread();
  };

  return (
    <div className="p-6 text-gray-900 dark:text-white relative">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold font-[family-name:var(--font-inter-tight)] tracking-tight">
            Notifications
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {loading ? 'Loading…' : `${items.length} alert${items.length !== 1 ? 's' : ''} · kept for 7 days`}
          </p>
        </motion.div>
        <button
          onClick={onMarkRead}
          disabled={unread === 0}
          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium
            bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] shadow-sm
            hover:border-[#2AAA8A]/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <FiCheck className="w-4 h-4" /> Mark all read{unread > 0 ? ` (${unread})` : ''}
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="glass-card"
      >
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-200px)] custom-scrollbar">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 dark:bg-[#111111] border-b border-gray-200 dark:border-[#2c2c2c]">
                {['Time', 'Severity', 'Source', 'Message'].map(h => (
                  <th key={h} className="px-4 py-3.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#2c2c2c]">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-12 text-center text-sm text-gray-400">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-12 text-center text-sm text-gray-400">No notifications</td></tr>
              ) : items.map(n => (
                <tr key={n.id} className={`hover:bg-gray-50 dark:hover:bg-[#111111] transition-colors ${!n.read ? 'bg-[#2AAA8A]/[0.04]' : ''}`}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs text-gray-500 tabular-nums">{fmtTime(n.ts)}</span>
                  </td>
                  <td className="px-4 py-3"><SeverityBadge severity={n.severity} /></td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs font-bold text-gray-900 dark:text-white">{n.source}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-700 dark:text-gray-300">{n.message}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
