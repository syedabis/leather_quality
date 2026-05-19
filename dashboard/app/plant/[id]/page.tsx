"use client";
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { FiArrowLeft } from 'react-icons/fi';
import Link from 'next/link';
import LiveThumbnail from '../../../components/LiveThumbnail';
import BeltStatusBadge from '../../../components/BeltStatusBadge';
import CounterBadge from '../../../components/CounterBadge';
import { usePlantsData } from '../../../hooks/usePlantsData';
import { PLANTS, fmtDuration } from '../../../lib/constants';
import { StaggerContainer, StaggerItem } from '../../../components/ui/AnimateIn';
import type { PlantId } from '../../../types';

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="glass-card p-4 gradient-border-top">
      <p className="text-[10px] text-gray-500 uppercase tracking-widest font-medium mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white font-[family-name:var(--font-inter-tight)]">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function PlantDetail() {
  const { id } = useParams() as { id: PlantId };
  const { plants } = usePlantsData();
  const plant = plants[id];
  const meta  = PLANTS.find(p => p.id === id);

  if (!meta) return (
    <div className="p-6 text-gray-400 text-sm">Unknown plant: {id}</div>
  );

  return (
    <div className="p-6 text-gray-900 dark:text-white relative">
      {/* Back + header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/monitoring" className="text-gray-400 hover:text-gray-700 transition-colors">
          <FiArrowLeft className="w-5 h-5" />
        </Link>
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
          <div className="flex items-center gap-3">
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-widest">{id}</p>
              <h1 className="text-2xl font-bold font-[family-name:var(--font-inter-tight)] tracking-tight text-gray-900 dark:text-white">
                {meta.name}
              </h1>
            </div>
            <BeltStatusBadge online={plant?.online ?? false} beltActive={plant?.belt_active ?? false} />
          </div>
        </motion.div>
      </div>

      <StaggerContainer stagger={0.08} className="grid grid-cols-12 gap-4">

        {/* Live feed */}
        <StaggerItem className="col-span-12 lg:col-span-8">
          <div className="glass-card overflow-hidden">
            <LiveThumbnail plantId={id} className="aspect-video w-full" />
          </div>
        </StaggerItem>

        {/* Right column stats */}
        <StaggerItem className="col-span-12 lg:col-span-4 flex flex-col gap-3">
          <StatCard
            label="Total Pieces"
            value={<CounterBadge value={plant?.total_count ?? 0} className="text-2xl text-gray-900 dark:text-white" />}
            sub="today"
          />
          <StatCard
            label="Utilisation"
            value={`${Math.round(plant?.utilization ?? 0)}%`}
            sub={`Runtime ${(((plant?.runtime_s ?? 0) / 3600)).toFixed(2)}h`}
          />
          <StatCard
            label="Active Time"
            value={`${((plant?.runtime_s ?? 0) / 3600).toFixed(2)}h`}
            sub="belt running today"
          />
          <StatCard
            label="Idle Time"
            value={`${((plant?.idle_s ?? 0) / 3600).toFixed(2)}h`}
            sub={`${plant?.session_count ?? 0} idle session${(plant?.session_count ?? 0) !== 1 ? 's' : ''}`}
          />
        </StaggerItem>

        {/* Sessions table */}
        <StaggerItem className="col-span-12">
          <div className="glass-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">Sessions Today</p>
            </div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    {['#', 'Start', 'Duration', 'Pieces', 'Avg Colour', 'Status'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(!plant?.sessions || plant.sessions.length === 0) ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-xs text-gray-400">
                        No sessions yet
                      </td>
                    </tr>
                  ) : plant.sessions.map(s => {
                    const [r, g, b] = [
                      parseInt(s.color?.match(/\d+/g)?.[0] ?? '120'),
                      parseInt(s.color?.match(/\d+/g)?.[1] ?? '80'),
                      parseInt(s.color?.match(/\d+/g)?.[2] ?? '60'),
                    ];
                    return (
                      <tr key={s.num} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 text-sm text-gray-700 font-medium">#{s.num}</td>
                        <td className="px-5 py-3 text-sm text-gray-500 tabular-nums">{fmtDuration(s.start)}</td>
                        <td className="px-5 py-3 text-sm text-gray-500 tabular-nums">{fmtDuration(s.duration)}</td>
                        <td className="px-5 py-3 text-sm font-semibold text-gray-900 tabular-nums">{s.pieces?.toLocaleString()}</td>
                        <td className="px-5 py-3">
                          {s.color && (
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-full border border-gray-200"
                                style={{ background: `rgb(${r},${g},${b})` }} />
                              <span className="text-xs text-gray-400">{s.color}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {s.active ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold
                              bg-[#2AAA8A]/10 border border-[#2AAA8A]/20 text-[#2AAA8A]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#2AAA8A] pulse-dot" />
                              Active
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">Done</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </StaggerItem>

      </StaggerContainer>
    </div>
  );
}
