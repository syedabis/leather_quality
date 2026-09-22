"use client";
import { useEffect, useRef } from 'react';
import { PREVIEW_VIDEOS } from '../lib/constants';
import type { PlantId } from '../types';

interface ConveyorVideoPlayerProps {
  plantId: PlantId;
  className?: string;
  showOverlay?: boolean;
}

export default function ConveyorVideoPlayer({
  plantId,
  className = '',
  showOverlay = true,
}: ConveyorVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoSrc = PREVIEW_VIDEOS[plantId] || `/videos/${plantId}.mp4`;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    el.muted = true;
    el.defaultMuted = true;
    
    const tryPlay = () => {
      if (el.paused) {
        el.play().catch(() => {});
      }
    };

    tryPlay();
    const interval = setInterval(tryPlay, 1000);
    return () => clearInterval(interval);
  }, [videoSrc]);

  return (
    <div className={`relative w-full h-full overflow-hidden bg-black ${className}`}>
      <video
        ref={videoRef}
        src={videoSrc}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-cover"
        onCanPlay={(e) => {
          e.currentTarget.muted = true;
          e.currentTarget.play().catch(() => {});
        }}
      />

      {/* Synthetic Defect Inspection Overlay */}
      {showOverlay && (
        <div className="absolute inset-0 pointer-events-none p-3 flex flex-col justify-between z-10">
          <div className="flex justify-between items-start">
            <span className="bg-black/75 backdrop-blur-md border border-emerald-500/50 text-emerald-400 text-[10px] font-mono px-2 py-0.5 rounded font-semibold flex items-center gap-1.5 shadow">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" /> AI CONVEYOR INSPECTION
            </span>
            <span className="bg-emerald-500 text-black text-[10px] font-black px-2.5 py-0.5 rounded shadow">
              PASS RULE: 0 DEFECTS
            </span>
          </div>

          {/* Simulated Detection Box on Leather Hide */}
          <div className="absolute top-[30%] left-[20%] w-[55%] h-[42%] border-2 border-dashed border-amber-400/90 rounded bg-amber-500/10 flex items-start p-1.5">
            <span className="bg-amber-500 text-black font-extrabold text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider shadow">
              Hide ID: {plantId}-BATCH-104
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
