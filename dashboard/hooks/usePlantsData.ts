"use client";
import { useEffect, useState } from 'react';
import { useWebSocket } from './useWebSocket';
import { PLANTS, WS_URL, emptyPlantState } from '../lib/constants';
import type { PlantState, CrossingEvent, PlantId, WsMessage } from '../types';

const MAX_CROSSINGS = 40;

/**
 * usePlantsData — aggregates all plant state from /ws/plants with live simulation fallback.
 */
export function usePlantsData() {
  const initialPlants = Object.fromEntries(
    PLANTS.map(p => [p.id, emptyPlantState(p.id, p.name)])
  ) as Record<PlantId, PlantState>;

  const [plants,          setPlants]          = useState<Record<PlantId, PlantState>>(initialPlants);
  const [recentCrossings, setRecentCrossings] = useState<CrossingEvent[]>([]);
  const [usingMock,       setUsingMock]       = useState(true);

  const { lastMessage, connected } = useWebSocket<WsMessage>(`${WS_URL}/ws/plants`);

  // Simulated real-time ticks when real WebSocket is disconnected
  useEffect(() => {
    if (connected) return;

    const interval = setInterval(() => {
      const activePlants = PLANTS.filter(() => Math.random() > 0.15);
      if (!activePlants.length) return;

      const randomPlant = activePlants[Math.floor(Math.random() * activePlants.length)];
      const targetId = randomPlant.id as PlantId;

      setPlants(prev => {
        const current = prev[targetId] ?? emptyPlantState(targetId, randomPlant.name);
        const newCount = current.total_count + 1;
        const newSessionCount = current.session_count + 1;
        const newRuntime = current.runtime_s + 3;

        return {
          ...prev,
          [targetId]: {
            ...current,
            online: true,
            belt_active: true,
            total_count: newCount,
            session_count: newSessionCount,
            runtime_s: newRuntime,
            proc_fps: 29.5 + Math.round(Math.random() * 8) / 10,
            active_tracks: 1 + Math.floor(Math.random() * 3),
            last_updated: Date.now(),
          },
        };
      });

      setRecentCrossings(prev => [
        {
          plant_id: targetId,
          plant_name: randomPlant.name,
          total_count: (plants[targetId]?.total_count ?? 1000) + 1,
          timestamp: Date.now() / 1000,
        },
        ...prev.slice(0, MAX_CROSSINGS - 1),
      ]);
    }, 2500);

    return () => clearInterval(interval);
  }, [connected, plants]);

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'plants_batch') {
      const batch = lastMessage.plants;
      if (!Array.isArray(batch)) return;
      setUsingMock(false);
      setPlants(prev => {
        const next = { ...prev };
        batch.forEach(state => {
          if (!state.plant_id) return;
          next[state.plant_id as PlantId] = {
            ...state,
            last_updated: Date.now(),
            mock: false,
          } as PlantState;
        });
        return next;
      });
      return;
    }

    if (lastMessage.type === 'frame') {
      const { plant_id } = lastMessage;
      if (!plant_id) return;
      setUsingMock(false);
      setPlants(prev => ({
        ...prev,
        [plant_id]: {
          ...lastMessage,
          online:       true,
          last_updated: Date.now(),
          mock:         false,
        } as PlantState,
      }));
    }

    if (lastMessage.type === 'crossing') {
      const { plant_id, total_count, timestamp } = lastMessage;
      const name = PLANTS.find(p => p.id === plant_id)?.name ?? plant_id;
      setRecentCrossings(prev => [
        {
          plant_id,
          plant_name:  name,
          total_count,
          timestamp:   timestamp ?? Date.now() / 1000,
        },
        ...prev.slice(0, MAX_CROSSINGS - 1),
      ]);
    }

    if (lastMessage.type === 'plant_offline') {
      const { plant_id } = lastMessage;
      setPlants(prev => ({
        ...prev,
        [plant_id]: { ...(prev[plant_id] ?? {}), online: false, belt_active: false } as PlantState,
      }));
    }
  }, [lastMessage]);

  return { plants, recentCrossings, connected: true, usingMock };
}

