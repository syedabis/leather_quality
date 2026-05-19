"use client";

interface BeltStatusBadgeProps {
  online: boolean;
  beltActive: boolean;
  size?: 'sm' | 'md';
}

/**
 * BeltStatusBadge — shows ACTIVE / IDLE / OFFLINE with appropriate pulse dot.
 */
export default function BeltStatusBadge({ online, beltActive, size = "md" }: BeltStatusBadgeProps) {
  const sm = size === "sm";

  if (!online) {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 ${sm ? 'py-0.5' : 'py-1'} rounded-full
        bg-red-500/10 border border-red-500/20`}>
        <span className={`${sm ? 'w-1.5 h-1.5' : 'w-2 h-2'} rounded-full bg-red-400 flex-shrink-0`} />
        <span className={`${sm ? 'text-[10px]' : 'text-xs'} font-semibold text-red-400 uppercase tracking-wider`}>
          Offline
        </span>
      </span>
    );
  }

  if (beltActive) {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 ${sm ? 'py-0.5' : 'py-1'} rounded-full
        bg-[#2AAA8A]/10 border border-[#2AAA8A]/20`}>
        <span className={`${sm ? 'w-1.5 h-1.5' : 'w-2 h-2'} rounded-full bg-[#2AAA8A] flex-shrink-0 pulse-dot`} />
        <span className={`${sm ? 'text-[10px]' : 'text-xs'} font-semibold text-[#2AAA8A] uppercase tracking-wider`}>
          Active
        </span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 ${sm ? 'py-0.5' : 'py-1'} rounded-full
      bg-[#E8A838]/10 border border-[#E8A838]/20`}>
      <span className={`${sm ? 'w-1.5 h-1.5' : 'w-2 h-2'} rounded-full bg-[#E8A838] flex-shrink-0 pulse-amber`} />
      <span className={`${sm ? 'text-[10px]' : 'text-xs'} font-semibold text-[#E8A838] uppercase tracking-wider`}>
        Idle
      </span>
    </span>
  );
}
