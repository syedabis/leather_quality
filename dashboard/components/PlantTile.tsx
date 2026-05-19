"use client";
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import BeltStatusBadge from './BeltStatusBadge';
import CounterBadge from './CounterBadge';
import { utilColor, fmtDuration } from '../lib/constants';
import type { PlantState } from '../types';

interface PlantTileProps {
  plant: PlantState | undefined;
}

/**
 * PlantTile — compact plant card for the overview grid.
 */
export default function PlantTile({ plant }: PlantTileProps) {
  const router = useRouter();
  const {
    plant_id, plant_name, online = false,
    belt_active = false, total_count = 0,
    session_num = 0, session_count = 0,
    utilization = 0, runtime_s = 0,
    mock = false,
  } = plant ?? {} as Partial<PlantState>;

  const util = Math.round(utilization ?? 0);
  const barColor = utilColor(util);

  return (
    <motion.div
      whileHover={{ y: -3, borderColor: 'rgba(42,170,138,0.3)' }}
      onClick={() => plant_id && router.push(`/plant/${plant_id}`)}
      className="glass-card p-4 cursor-pointer gradient-border-top select-none"
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-widest font-medium mb-0.5">
            {plant_id}
          </p>
          <h3 className="text-sm font-semibold text-white font-[family-name:var(--font-inter-tight)] leading-tight">
            {plant_name}
          </h3>
        </div>
        <BeltStatusBadge online={online ?? false} beltActive={belt_active ?? false} size="sm" />
      </div>

      {/* Count */}
      <div className="mb-3">
        <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">Total Today</p>
        <div className="flex items-baseline gap-2">
          <CounterBadge value={total_count ?? 0} className="text-3xl text-white" />
          <span className="text-xs text-gray-600">pieces</span>
        </div>
      </div>

      {/* Session info */}
      {(session_num ?? 0) > 0 && (
        <div className="flex items-center justify-between mb-3 text-xs text-gray-500">
          <span>Session {session_num}</span>
          <span className="text-gray-400">
            {(session_count ?? 0) > 0 ? `${session_count} this session` : 'No pieces yet'}
          </span>
        </div>
      )}

      {/* Utilisation bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-gray-600 uppercase tracking-wider">Utilisation</span>
          <span className="text-[10px] font-semibold" style={{ color: barColor }}>
            {online ? `${util}%` : '--'}
          </span>
        </div>
        <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: barColor }}
            initial={{ width: 0 }}
            animate={{ width: online ? `${Math.min(util, 100)}%` : 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Runtime */}
      {online && (runtime_s ?? 0) > 0 && (
        <p className="text-[10px] text-gray-700 mt-2 text-right">
          Runtime {fmtDuration(runtime_s)}
        </p>
      )}

      {mock && (
        <p className="text-[10px] text-gray-700 mt-1">demo data</p>
      )}
    </motion.div>
  );
}
