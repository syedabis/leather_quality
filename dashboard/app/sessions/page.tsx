"use client";
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiFilter, FiSearch } from 'react-icons/fi';
import { PLANTS, API_URL } from '../../lib/constants';

interface AppSession {
  session_id:       number;
  lot_no:           string | null;
  plant:            string;
  start_time:       string | null;
  end_time:         string | null;
  expected_pieces:  number | null;
  processed_pieces: number;
  status:           string;
  type:             'accounted' | 'unaccounted';
  session_type:     string;   // PRODUCTION | WASHING | COLOR_MATCHING | MAINTENANCE
  order_no:         string | null;
  article_name:     string | null;
  colour_name:      string | null;
  party_name:       string | null;
  pk_code:          string | null;
}

function fmtDatetime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return iso; }
}

function fmtDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso) return '—';
  const start = new Date(startIso).getTime();
  const end   = endIso ? new Date(endIso).getTime() : Date.now();
  const s     = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

export default function Sessions() {
  const [filterPlant, setFilterPlant] = useState('all');
  const [filterType,  setFilterType]  = useState<'all' | 'accounted' | 'unaccounted' | 'WASHING' | 'COLOR_MATCHING' | 'MAINTENANCE'>('all');
  const [search,      setSearch]      = useState('');
  const [sessions,    setSessions]    = useState<AppSession[]>([]);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const url = `${API_URL}/api/sessions?limit=300`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSessions(Array.isArray(data) ? data : []);
      } catch (err) {
        console.warn('Failed to fetch sessions:', err);
        setSessions([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = sessions.filter(r => {
    if (filterPlant !== 'all' && r.plant !== filterPlant) return false;
    if (filterType !== 'all') {
      if (filterType === 'accounted' || filterType === 'unaccounted') {
        if (r.type !== filterType) return false;
      } else {
        if (r.session_type !== filterType) return false;
      }
    }
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [r.plant, r.lot_no, r.party_name, r.order_no, r.colour_name, r.article_name]
      .some(v => v?.toLowerCase().includes(q));
  });

  return (
    <div className="p-6 text-gray-900 dark:text-white relative">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold font-[family-name:var(--font-inter-tight)] tracking-tight text-gray-900 dark:text-white">
            Sessions
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {loading ? 'Loading…' : `${filtered.length} session${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </motion.div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="flex items-center gap-1.5 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-xl px-3 py-2 shadow-sm">
            <FiSearch className="text-gray-400 w-3.5 h-3.5 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="LOT, party, order…"
              className="bg-transparent text-xs text-gray-700 dark:text-gray-300 focus:outline-none w-36 placeholder-gray-400"
            />
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-1.5 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-xl px-3 py-2 shadow-sm">
            <FiFilter className="text-gray-400 w-3.5 h-3.5" />
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value as typeof filterType)}
              className="bg-transparent text-xs text-gray-700 dark:text-gray-300 focus:outline-none cursor-pointer"
            >
              <option value="all">All Types</option>
              <option value="accounted">Accounted</option>
              <option value="unaccounted">Unaccounted</option>
              <option value="WASHING">Washing</option>
              <option value="COLOR_MATCHING">Color Matching</option>
              <option value="MAINTENANCE">Maintenance</option>
            </select>
          </div>

          {/* Plant filter */}
          <div className="flex items-center gap-1.5 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-xl px-3 py-2 shadow-sm">
            <FiFilter className="text-gray-400 w-3.5 h-3.5" />
            <select
              value={filterPlant}
              onChange={e => setFilterPlant(e.target.value)}
              className="bg-transparent text-xs text-gray-700 dark:text-gray-300 focus:outline-none cursor-pointer"
            >
              <option value="all">All Plants</option>
              {PLANTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="glass-card overflow-hidden"
      >
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-200px)] custom-scrollbar">
          <table className="w-full min-w-[1200px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 dark:bg-[#111111] border-b border-gray-200 dark:border-[#2c2c2c]">
                {['Plant', 'Type', 'LOT', 'Party', 'Order', 'Color', 'Article', 'Expected', 'Processed', 'Duration', 'Start', 'End', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#2c2c2c]">
              <AnimatePresence initial={false}>
                {loading ? (
                  <tr>
                    <td colSpan={13} className="px-4 py-12 text-center text-sm text-gray-400">
                      Loading sessions…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-4 py-12 text-center text-sm text-gray-400">
                      No sessions found
                    </td>
                  </tr>
                ) : filtered.map(row => (
                  <motion.tr
                    key={row.session_id}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="hover:bg-gray-50 dark:hover:bg-[#111111] transition-colors"
                  >
                    {/* Plant */}
                    <td className="px-4 py-3.5">
                      <span className="text-xs font-bold text-gray-900 dark:text-white">{row.plant}</span>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3.5">
                      {row.session_type === 'WASHING' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                          Washing
                        </span>
                      ) : row.session_type === 'COLOR_MATCHING' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
                          Color Matching
                        </span>
                      ) : row.session_type === 'MAINTENANCE' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                          Maintenance
                        </span>
                      ) : row.type === 'accounted' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                          Accounted
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                          Unaccounted
                        </span>
                      )}
                    </td>

                    {/* LOT */}
                    <td className="px-4 py-3.5">
                      <span className="text-xs text-gray-700 dark:text-gray-300 font-medium tabular-nums">
                        {row.lot_no ?? <span className="text-gray-400 italic">—</span>}
                      </span>
                    </td>

                    {/* Party */}
                    <td className="px-4 py-3.5 max-w-[130px]">
                      <span className="text-xs text-gray-700 dark:text-gray-300 truncate block">
                        {row.party_name ?? <span className="text-gray-400">—</span>}
                      </span>
                    </td>

                    {/* Order */}
                    <td className="px-4 py-3.5">
                      <span className="text-xs text-gray-500 tabular-nums">{row.order_no ?? '—'}</span>
                    </td>

                    {/* Color */}
                    <td className="px-4 py-3.5 max-w-[100px]">
                      <span className="text-xs text-gray-500 truncate block">{row.colour_name ?? '—'}</span>
                    </td>

                    {/* Article */}
                    <td className="px-4 py-3.5 max-w-[130px]">
                      <span className="text-xs text-gray-500 truncate block">{row.article_name ?? '—'}</span>
                    </td>

                    {/* Expected */}
                    <td className="px-4 py-3.5 text-right">
                      <span className="text-xs text-gray-500 tabular-nums">
                        {row.expected_pieces != null ? row.expected_pieces.toLocaleString() : '—'}
                      </span>
                    </td>

                    {/* Processed */}
                    <td className="px-4 py-3.5 text-right">
                      <span className="text-xs font-semibold text-gray-900 dark:text-white tabular-nums">
                        {row.processed_pieces.toLocaleString()}
                      </span>
                    </td>

                    {/* Duration */}
                    <td className="px-4 py-3.5">
                      <span className="text-xs text-gray-500 tabular-nums">
                        {fmtDuration(row.start_time, row.end_time)}
                      </span>
                    </td>

                    {/* Start */}
                    <td className="px-4 py-3.5">
                      <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                        {fmtDatetime(row.start_time)}
                      </span>
                    </td>

                    {/* End */}
                    <td className="px-4 py-3.5">
                      <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                        {row.end_time ? fmtDatetime(row.end_time) : <span className="text-[#2AAA8A] italic">Active</span>}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5">
                      {row.status === 'INPROCESS' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#2AAA8A]/10 border border-[#2AAA8A]/20 text-[#2AAA8A]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#2AAA8A] animate-pulse" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-[#2c2c2c] text-gray-400">
                          Completed
                        </span>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
