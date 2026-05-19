"use client";
import type { LotDecisionType } from '../types';

interface BadgeConfig {
  label: string;
  bg: string;
  border: string;
  text: string;
}

const CONFIG: Record<LotDecisionType, BadgeConfig> = {
  SAME_LOT:         { label: 'Same Lot',  bg: 'bg-[#2AAA8A]/10',  border: 'border-[#2AAA8A]/20',  text: 'text-[#2AAA8A]'  },
  FLAGGED_PROBABLE: { label: 'Flagged',   bg: 'bg-[#E8A838]/10',  border: 'border-[#E8A838]/20',  text: 'text-[#E8A838]'  },
  NEW_LOT_OPENED:   { label: 'New Lot',   bg: 'bg-purple-500/10', border: 'border-purple-500/20', text: 'text-purple-400' },
  PENDING:          { label: 'Pending',   bg: 'bg-gray-700/10',   border: 'border-gray-700/20',   text: 'text-gray-400'   },
};

interface LotDecisionBadgeProps {
  decision: string;
}

export default function LotDecisionBadge({ decision }: LotDecisionBadgeProps) {
  const cfg = CONFIG[decision as LotDecisionType] ?? CONFIG.PENDING;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider
      ${cfg.bg} ${cfg.border} ${cfg.text} border`}>
      {cfg.label}
    </span>
  );
}
