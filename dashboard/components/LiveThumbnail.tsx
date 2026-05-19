"use client";
import { useEffect, useRef, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { WS_URL } from '../lib/constants';
import { FiVideo, FiVideoOff } from 'react-icons/fi';
import type { WsFrameMessage, WsMessage } from '../types';

interface LiveThumbnailProps {
  plantId: string;
  previewVideo?: string;
  className?: string;
  onUpdate?: (state: WsFrameMessage) => void;
}

/**
 * LiveThumbnail — streams annotated JPEG frames from /ws/plant/{plantId}.
 * Falls back to a placeholder when disconnected or no thumbnail yet.
 */
export default function LiveThumbnail({ plantId, previewVideo, className = "", onUpdate }: LiveThumbnailProps) {
  const [src,      setSrc]      = useState<string | null>(null);
  const [frameAge, setFrameAge] = useState<number | null>(null);
  const ageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { lastMessage, connected } = useWebSocket<WsMessage>(`${WS_URL}/ws/plant/${plantId}`);

  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === 'frame') {
      if (lastMessage.thumbnail) {
        setSrc(`data:image/jpeg;base64,${lastMessage.thumbnail}`);
        setFrameAge(0);
        if (ageTimerRef.current) clearInterval(ageTimerRef.current);
        ageTimerRef.current = setInterval(
          () => setFrameAge(a => (a ?? 0) + 1),
          1000,
        );
      }
      onUpdate?.(lastMessage);
    }
  }, [lastMessage, onUpdate]);

  useEffect(() => () => {
    if (ageTimerRef.current) clearInterval(ageTimerRef.current);
  }, []);

  const previewSrc = previewVideo ?? null;

  return (
    <div className={`relative bg-[#0a0a0a] overflow-hidden ${className}`}>
      {src ? (
        /* Live JPEG frame */
        <img
          src={src}
          alt={`${plantId} live feed`}
          className="w-full h-full object-cover"
        />
      ) : previewSrc ? (
        /* Preview video until live feed arrives */
        <>
          <video
            key={previewSrc}
            src={previewSrc}
            autoPlay
            muted
            loop
            playsInline
            className="w-full h-full object-cover"
          />
        </>
      ) : (
        /* Fallback icon for unknown plant IDs */
        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
          {connected
            ? <FiVideo className="w-8 h-8 text-gray-700" />
            : <FiVideoOff className="w-8 h-8 text-gray-700" />
          }
          <span className="text-xs text-gray-600">
            {connected ? 'Waiting for feed…' : 'Connecting…'}
          </span>
        </div>
      )}

      {/* Connection status dot */}
      <div className={`absolute top-3 right-3 w-2 h-2 rounded-full ${
        connected ? 'bg-[#2AAA8A] pulse-dot' : 'bg-gray-600'
      }`} />

      {/* Frame age */}
      {frameAge !== null && frameAge > 5 && (
        <div className="absolute bottom-2 right-2 text-[10px] text-gray-500 bg-black/60 px-1.5 py-0.5 rounded">
          {frameAge}s ago
        </div>
      )}
    </div>
  );
}
