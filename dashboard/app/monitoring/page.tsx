"use client";
import { useState } from 'react';
import { motion } from 'framer-motion';
import { FiMaximize2 } from 'react-icons/fi';
import { useUser } from '@clerk/nextjs';
import { StaggerContainer, StaggerItem } from '../../components/ui/AnimateIn';
import LiveThumbnail from '../../components/LiveThumbnail';
import BeltStatusBadge from '../../components/BeltStatusBadge';
import CounterBadge from '../../components/CounterBadge';
import Unauthorized from '../../components/Unauthorized';
import { usePlantsData } from '../../hooks/usePlantsData';
import { PLANTS } from '../../lib/constants';
import type { PlantId } from '../../types';
import { useRouter } from 'next/navigation';

export default function Monitoring() {
  const { plants, connected } = usePlantsData();
  const [fullscreen, setFullscreen] = useState<PlantId | null>(null);
  const router = useRouter();
  const { user, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#2AAA8A]/30 border-t-[#2AAA8A] rounded-full animate-spin" />
      </div>
    );
  }

  if (user?.publicMetadata?.role !== 'admin') {
    return <Unauthorized />;
  }

  return (
    <div className="p-6 text-gray-900 dark:text-white relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold font-[family-name:var(--font-inter-tight)] tracking-tight text-gray-900 dark:text-white">
            Monitoring
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Live feeds — all 6 plants</p>
        </motion.div>

        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
          connected
            ? 'bg-[#2AAA8A]/10 border-[#2AAA8A]/25 text-[#2AAA8A]'
            : 'bg-gray-100 border-gray-200 text-gray-400'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[#2AAA8A] pulse-dot' : 'bg-gray-400'}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      {/* 3×2 camera grid */}
      <StaggerContainer stagger={0.07} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {PLANTS.map((p) => {
          const plant = plants[p.id];
          return (
            <StaggerItem key={p.id}>
              <motion.div
                whileHover={{ y: -3, borderColor: 'rgba(42,170,138,0.35)' }}
                className="glass-card overflow-hidden"
              >
                {/* Feed area 16:9 */}
                <div className="relative aspect-video bg-gray-900">
                  <LiveThumbnail
                    plantId={p.id}
                    className="absolute inset-0 w-full h-full"
                  />

                  {/* Top-left: name + status */}
                  <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
                    <div className="bg-black/60 backdrop-blur-sm border border-white/10 px-2.5 py-1 rounded-lg">
                      <span className="text-xs font-semibold text-white">{p.name}</span>
                    </div>
                    <BeltStatusBadge
                      online={plant?.online ?? false}
                      beltActive={plant?.belt_active ?? false}
                      size="sm"
                    />
                  </div>

                  {/* Bottom-left: count */}
                  <div className="absolute bottom-3 left-3 z-10">
                    <div className="bg-black/60 backdrop-blur-sm border border-white/10 px-2.5 py-1 rounded-lg
                      flex items-baseline gap-1.5">
                      <CounterBadge value={plant?.total_count ?? 0} className="text-sm text-white" />
                      <span className="text-[10px] text-gray-300">pieces</span>
                    </div>
                  </div>

                  {/* Top-right: fullscreen button */}
                  <div className="absolute top-3 right-3 flex gap-1.5 z-10">
                    <button
                      onClick={() => setFullscreen(p.id)}
                      className="w-7 h-7 bg-black/60 backdrop-blur-sm border border-white/10 rounded-lg
                        flex items-center justify-center text-gray-300 hover:text-white hover:border-[#2AAA8A]/40 transition-all"
                    >
                      <FiMaximize2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Bottom bar */}
                <div className="px-3 py-2 flex items-center justify-between border-t border-gray-100 dark:border-[#2c2c2c]">
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>{p.id}</span>
                    {plant?.utilization != null && (
                      <span className="text-gray-400">
                        {Math.round(plant.utilization)}% util
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => router.push(`/plant/${p.id}`)}
                    className="text-xs text-[#2AAA8A] hover:text-[#249978] transition-colors font-medium"
                  >
                    Details →
                  </button>
                </div>
              </motion.div>
            </StaggerItem>
          );
        })}
      </StaggerContainer>

      {/* Fullscreen overlay */}
      {fullscreen && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="relative w-[90%] max-w-5xl aspect-video">
            <LiveThumbnail
              plantId={fullscreen}
              className="w-full h-full rounded-2xl overflow-hidden"
            />
            <div className="absolute top-4 left-4 flex items-center gap-2">
              <div className="bg-black/60 backdrop-blur-sm border border-white/10 px-2.5 py-1 rounded-lg">
                <span className="text-xs font-semibold text-white font-[family-name:var(--font-inter-tight)]">
                  {PLANTS.find(p => p.id === fullscreen)?.name}
                </span>
              </div>
            </div>
            <div className="absolute bottom-4 left-4">
              <div className="bg-black/60 backdrop-blur-sm border border-white/10 px-2.5 py-1 rounded-lg flex items-baseline gap-1.5">
                <CounterBadge value={plants[fullscreen]?.total_count ?? 0} className="text-sm text-white" />
                <span className="text-[10px] text-gray-300">pieces</span>
              </div>
            </div>
            <button
              onClick={() => setFullscreen(null)}
              className="absolute top-4 right-4 bg-white/10 backdrop-blur-sm border border-white/20 text-white
                px-3 py-1.5 rounded-full text-sm hover:bg-white/20 transition-all"
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
