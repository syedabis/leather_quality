"use client";
import { useEffect, useRef, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { WS_URL } from '../lib/constants';
import type { WsFrameMessage, WsMessage, PlantId } from '../types';
import ConveyorVideoPlayer from './ConveyorVideoPlayer';

interface LiveThumbnailProps {
  plantId: string;
  className?: string;
  onUpdate?: (state: WsFrameMessage) => void;
}

/**
 * LiveThumbnail — streams annotated JPEG frames from /ws/plant/{plantId}.
 * Falls back to local MP4 video loop when no live WS stream is broadcasting.
 */
export default function LiveThumbnail({ plantId, className = "", onUpdate }: LiveThumbnailProps) {
  const [src, setSrc] = useState<string | null>(null);
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

  return (
    <div className={`relative bg-[#0a0a0a] overflow-hidden ${className}`}>
      {src ? (
        /* Live JPEG frame from WebSocket */
        <img
          src={src}
          alt={`${plantId} live feed`}
          className="w-full h-full object-cover"
        />
      ) : (
        /* Video stream loop fallback */
        <ConveyorVideoPlayer plantId={plantId as PlantId} showOverlay={false} className="w-full h-full" />
      )}

      {/* Connection status dot */}
      <div className={`absolute top-3 right-3 w-2 h-2 rounded-full z-20 ${
        connected ? 'bg-[#2AAA8A] pulse-dot' : 'bg-gray-600'
      }`} />

      {/* Frame age */}
      {frameAge !== null && frameAge > 5 && (
        <div className="absolute bottom-2 right-2 text-[10px] text-gray-500 bg-black/60 px-1.5 py-0.5 rounded z-20">
          {frameAge}s ago
        </div>
      )}
    </div>
  );
}
