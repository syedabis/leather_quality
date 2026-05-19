"use client";
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiX, FiAlertTriangle, FiCheck, FiPlus } from 'react-icons/fi';
import type { LotDecision, LotDecisionType } from '../types';

type ConfirmableDecision = Extract<LotDecisionType, 'SAME_LOT' | 'NEW_LOT_OPENED'>;

interface SupervisorModalProps {
  lot: LotDecision | null;
  onConfirm: (decision: ConfirmableDecision) => Promise<void> | void;
  onClose: () => void;
}

const TIMEOUT_S = 120;

/**
 * SupervisorModal — lot confirmation dialog for FLAGGED_PROBABLE decisions.
 */
export default function SupervisorModal({ lot, onConfirm, onClose }: SupervisorModalProps) {
  const [remaining,  setRemaining]  = useState(TIMEOUT_S);
  const [confirming, setConfirming] = useState(false);

  // Countdown timer — auto-resolves as SAME_LOT on timeout
  useEffect(() => {
    if (!lot) return;
    setRemaining(TIMEOUT_S);
    const interval = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          onConfirm('SAME_LOT');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lot, onConfirm]);

  const handle = async (decision: ConfirmableDecision) => {
    setConfirming(true);
    await onConfirm(decision);
    setConfirming(false);
  };

  const progress = (remaining / TIMEOUT_S) * 100;
  const [r, g, b] = lot?.color_rgb ?? [120, 80, 60];

  return (
    <AnimatePresence>
      {lot && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="relative w-full max-w-md bg-[#111] border border-[#1a1a1a] rounded-2xl shadow-2xl overflow-hidden"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          >
            {/* Gradient top accent */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#E8A838]/50 to-transparent" />

            {/* Timeout progress bar */}
            <div className="absolute top-0 left-0 h-0.5 bg-[#E8A838]/40 transition-all duration-1000"
              style={{ width: `${progress}%` }} />

            <div className="p-6">
              {/* Header */}
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#E8A838]/10 border border-[#E8A838]/20 flex items-center justify-center">
                    <FiAlertTriangle className="text-[#E8A838] w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold font-[family-name:var(--font-inter-tight)]">
                      Lot Boundary Detected
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {lot.plant_name} — Session {lot.session_num}
                    </p>
                  </div>
                </div>
                <button onClick={onClose}
                  className="text-gray-600 hover:text-gray-400 transition-colors p-1">
                  <FiX className="w-4 h-4" />
                </button>
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-3">
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Confidence</p>
                  <p className="text-lg font-bold text-white font-[family-name:var(--font-inter-tight)]">
                    {Math.round((lot.confidence ?? 0.55) * 100)}%
                  </p>
                </div>
                <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-3">
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Gap</p>
                  <p className="text-lg font-bold text-white font-[family-name:var(--font-inter-tight)]">
                    {lot.gap_s ?? '--'}s
                  </p>
                </div>
                <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-3">
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Colour</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-5 h-5 rounded-full border border-white/10 flex-shrink-0"
                      style={{ backgroundColor: `rgb(${r},${g},${b})` }} />
                    <span className="text-xs text-gray-400">
                      #{r.toString(16).padStart(2, '0')}{g.toString(16).padStart(2, '0')}{b.toString(16).padStart(2, '0')}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-gray-500 mb-5">
                The system detected a <span className="text-[#E8A838]">probable lot boundary</span> based on
                gap duration and colour delta. Please confirm whether this is the same lot or a new lot.
                Auto-resolves as <strong className="text-gray-400">Same Lot</strong> in{' '}
                <span className="text-white font-semibold tabular-nums">{remaining}s</span>.
              </p>

              {/* Action buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => handle('SAME_LOT')}
                  disabled={confirming}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                    bg-[#2AAA8A]/10 border border-[#2AAA8A]/20 text-[#2AAA8A] text-sm font-semibold
                    hover:bg-[#2AAA8A]/20 transition-all disabled:opacity-50"
                >
                  <FiCheck className="w-4 h-4" />
                  Same Lot
                </button>
                <button
                  onClick={() => handle('NEW_LOT_OPENED')}
                  disabled={confirming}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                    bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm font-semibold
                    hover:bg-purple-500/20 transition-all disabled:opacity-50"
                >
                  <FiPlus className="w-4 h-4" />
                  New Lot
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
