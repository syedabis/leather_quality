"use client";
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiFilter, FiSearch } from 'react-icons/fi';
import { PLANTS, fmtDuration, API_URL } from '../../lib/constants';
import { getSessions } from '../../lib/api';

interface SessionRow {
  key: string;
  plant_id: string;
  session_num: number;
  start_time_s: number | null;
  duration_s: number | null;
  piece_count: number;
  is_active: boolean;
}

interface ApiSessionResponse {
  id: number;
  unit: string;
  session_num: number;
  start_time_s: number | null;
  end_time_s: number | null;
  duration_s: number | null;
  piece_count: number;
  is_active: boolean;
}

// Fallback demo data if API is unreachable
const DEMO_SESSIONS: SessionRow[] = [
  { key: 'SP-01-1', plant_id: 'SP-01', session_num: 1,  start_time_s: 0,      duration_s: 3_600, piece_count: 1_050, is_active: false },
  { key: 'SP-01-2', plant_id: 'SP-01', session_num: 2,  start_time_s: 3_720,  duration_s: 3_540, piece_count: 1_080, is_active: false },
  { key: 'SP-01-3', plant_id: 'SP-01', session_num: 3,  start_time_s: 7_380,  duration_s: null,  piece_count: 920,   is_active: true  },
  { key: 'SP-02-1', plant_id: 'SP-02', session_num: 1,  start_time_s: 120,    duration_s: 3_480, piece_count: 940,   is_active: false },
  { key: 'SP-02-2', plant_id: 'SP-02', session_num: 2,  start_time_s: 3_720,  duration_s: 3_600, piece_count: 970,   is_active: false },
  { key: 'SP-02-3', plant_id: 'SP-02', session_num: 3,  start_time_s: 7_440,  duration_s: null,  piece_count: 860,   is_active: true  },
  { key: 'SP-03-1', plant_id: 'SP-03', session_num: 1,  start_time_s: 60,     duration_s: 3_540, piece_count: 1_120, is_active: false },
  { key: 'SP-03-2', plant_id: 'SP-03', session_num: 2,  start_time_s: 3_720,  duration_s: 3_600, piece_count: 1_100, is_active: false },
  { key: 'SP-03-3', plant_id: 'SP-03', session_num: 3,  start_time_s: 7_440,  duration_s: null,  piece_count: 1_030, is_active: true  },
  { key: 'SP-04-1', plant_id: 'SP-04', session_num: 1,  start_time_s: 240,    duration_s: 3_420, piece_count: 880,   is_active: false },
  { key: 'SP-04-2', plant_id: 'SP-04', session_num: 2,  start_time_s: 3_780,  duration_s: 3_480, piece_count: 860,   is_active: false },
  { key: 'SP-04-3', plant_id: 'SP-04', session_num: 3,  start_time_s: 7_380,  duration_s: null,  piece_count: 790,   is_active: true  },
  { key: 'SP-05-1', plant_id: 'SP-05', session_num: 1,  start_time_s: 0,      duration_s: 3_600, piece_count: 1_030, is_active: false },
  { key: 'SP-05-2', plant_id: 'SP-05', session_num: 2,  start_time_s: 3_720,  duration_s: 3_540, piece_count: 1_010, is_active: false },
  { key: 'SP-05-3', plant_id: 'SP-05', session_num: 3,  start_time_s: 7_380,  duration_s: null,  piece_count: 950,   is_active: true  },
  { key: 'SP-06-1', plant_id: 'SP-06', session_num: 1,  start_time_s: 180,    duration_s: 3_480, piece_count: 920,   is_active: false },
  { key: 'SP-06-2', plant_id: 'SP-06', session_num: 2,  start_time_s: 3_780,  duration_s: 3_540, piece_count: 900,   is_active: false },
  { key: 'SP-06-3', plant_id: 'SP-06', session_num: 3,  start_time_s: 7_440,  duration_s: null,  piece_count: 840,   is_active: true  },
];

function mapApiSession(row: ApiSessionResponse): SessionRow {
  return {
    key: String(row.id),
    plant_id: row.unit,
    session_num: row.session_num,
    start_time_s: row.start_time_s,
    duration_s: row.duration_s,
    piece_count: row.piece_count,
    is_active: row.is_active,
  };
}

function plantName(unit: string): string {
  return PLANTS.find(p => p.id === unit)?.name ?? unit;
}

export default function Sessions() {
  const [filterPlant, setFilterPlant] = useState('all');
  const [search,      setSearch]      = useState('');
  const [sessions, setSessions] = useState<SessionRow[]>(DEMO_SESSIONS);
  const [loading, setLoading] = useState(true);

  // Fetch sessions from API on mount
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const data = await getSessions();
        const mapped = (Array.isArray(data) ? data : []).map(mapApiSession);
        setSessions(mapped.length > 0 ? mapped : DEMO_SESSIONS);
      } catch (error) {
        console.warn('Failed to fetch sessions, using demo data:', error);
        setSessions(DEMO_SESSIONS);
      } finally {
        setLoading(false);
      }
    };

    fetchSessions();
  }, []);

  const filtered = sessions.filter(r => {
    const matchPlant = filterPlant === 'all' || r.plant_id === filterPlant;
    if (!matchPlant) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      r.plant_id.toLowerCase().includes(q) ||
      plantName(r.plant_id).toLowerCase().includes(q) ||
      String(r.session_num).includes(q)
    );
  });

  return (
    <div className="p-6 text-gray-900 dark:text-white relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold font-[family-name:var(--font-inter-tight)] tracking-tight text-gray-900 dark:text-white">Sessions</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {filtered.length} session{filtered.length !== 1 ? 's' : ''}
          </p>
        </motion.div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="flex items-center gap-1.5 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2c2c2c] rounded-xl px-3 py-2 shadow-sm">
            <FiSearch className="text-gray-400 w-3.5 h-3.5 flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search plant or session…"
              className="bg-transparent text-xs text-gray-700 dark:text-gray-300 focus:outline-none w-44 placeholder-gray-400"
            />
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
          <table className="w-full min-w-[700px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 dark:bg-[#111111] border-b border-gray-200 dark:border-[#2c2c2c]">
                {['Plant', 'Session', 'Start (s)', 'Duration', 'Pieces', 'Status'].map(h => (
                  <th key={h} className="px-5 py-3.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#2c2c2c]">
              <AnimatePresence initial={false}>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-400">
                      No sessions found — run a plant worker to start logging
                    </td>
                  </tr>
                ) : filtered.map(row => (
                  <motion.tr
                    key={row.key ?? `${row.plant_id}-${row.session_num}`}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="hover:bg-gray-50 dark:hover:bg-[#111111] transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <div>
                        <p className="text-xs font-semibold text-gray-900 dark:text-white">{row.plant_id}</p>
                        <p className="text-[10px] text-gray-400">{plantName(row.plant_id)}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-gray-700 dark:text-gray-300 font-medium tabular-nums">#{row.session_num}</span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-500 tabular-nums">
                      {row.start_time_s != null ? `${row.start_time_s.toFixed(1)}s` : '--'}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-500 tabular-nums">
                      {fmtDuration(row.duration_s)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                        {row.piece_count?.toLocaleString() ?? '--'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {row.is_active ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold
                          bg-[#2AAA8A]/10 border border-[#2AAA8A]/20 text-[#2AAA8A]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#2AAA8A] pulse-dot" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold
                          bg-gray-100 dark:bg-[#252525] border border-gray-200 dark:border-[#2c2c2c] text-gray-400">
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
