"use client";
import { useEffect, useState } from 'react';
import { useWebSocket } from './useWebSocket';
import { PLANTS, WS_URL, emptyPlantState } from '../lib/constants';
import type { PlantState, CrossingEvent, PlantId, WsMessage } from '../types';

const MAX_CROSSINGS = 40;

/**
 * usePlantsData — aggregates all plant state from /ws/plants.
 *
 * Returns:
 *   plants          – { [plant_id]: PlantState }
 *   recentCrossings – last N crossing events
 *   connected       – boolean
 *   usingMock       – true while no real WS data has arrived
 */
export function usePlantsData() {
  const initialPlants = Object.fromEntries(
    PLANTS.map(p => [p.id, emptyPlantState(p.id, p.name)])
  ) as Record<PlantId, PlantState>;

  const [plants,          setPlants]          = useState<Record<PlantId, PlantState>>(initialPlants);
  const [recentCrossings, setRecentCrossings] = useState<CrossingEvent[]>([]);
  const [usingMock,       setUsingMock]       = useState(true);

  const { lastMessage, connected } = useWebSocket<WsMessage>(`${WS_URL}/ws/plants`);

  useEffect(() => {
    if (!lastMessage) return;

    // Batch update — all plants arrive in one message (prevents React from
    // dropping all-but-last when N messages fire in rapid succession)
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

    // Legacy single-frame messages (kept for backward compat)
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

  return { plants, recentCrossings, connected, usingMock };
}
