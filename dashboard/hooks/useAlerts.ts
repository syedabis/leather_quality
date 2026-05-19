"use client";

import { useEffect, useRef, useState } from 'react';
import type { PlantId, PlantState } from '../types';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  id: string;
  plant_id: PlantId;
  plant_name: string;
  message: string;
  severity: AlertSeverity;
  timestamp: number; // ms
}

const MAX_ALERTS = 30;

// Idle duration checkpoints — fires a notification at each milestone
const IDLE_THRESHOLDS_S = [
  30 * 60,       // 30 min  → "Idle for 30 min, threshold exceeded"
  60 * 60,       // 1 hr    → "No activity detected for 1 hour"
  2 * 60 * 60,   // 2 hr    → "No activity detected for 2 hours"
  3 * 60 * 60,   // 3 hr    → "No activity detected for 3 hours"
];

const UTIL_HIGH_PCT = 90; // fires once when utilization crosses this

interface TrackedState {
  online: boolean;
  belt_active: boolean;
  session_num: number;
  idle_s: number;
  utilization: number;
  // Highest idle threshold (seconds) that has already fired in the current idle streak
  idleThresholdFired: number | null;
  // Whether the high-utilisation alert has already fired (resets when util drops back)
  utilHighFired: boolean;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function idleNotificationMessage(name: string, thresholdS: number): { message: string; severity: AlertSeverity } {
  if (thresholdS < 60 * 60) {
    const m = Math.round(thresholdS / 60);
    return { message: `${name} – Idle for ${m} min, threshold exceeded`, severity: 'warning' };
  }
  const h = Math.round(thresholdS / 3600);
  return {
    message: `${name} – No activity detected for ${h} hour${h !== 1 ? 's' : ''}`,
    severity: 'warning',
  };
}

/**
 * Watches plant state transitions pushed by usePlantsData and emits notifications:
 *
 *   Online / offline transitions
 *   Belt idle / active transitions  → "Session #N started (HH:MM)"
 *   Idle duration milestones        → "Idle for 30 min" / "No activity for 1 hr"
 *   High utilisation                → "Utilisation above 90%"
 */
export function useAlerts(plants: Record<PlantId, PlantState>): Alert[] {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const prevRef      = useRef<Partial<Record<PlantId, TrackedState>>>({});
  const initialised  = useRef(false);

  useEffect(() => {
    const entries = Object.values(plants);
    if (!entries.length) return;

    // Seed state on first render — don't fire alerts for the initial snapshot
    if (!initialised.current) {
      entries.forEach(p => {
        prevRef.current[p.plant_id] = {
          online:             p.online,
          belt_active:        p.belt_active,
          session_num:        p.session_num,
          idle_s:             p.idle_s,
          utilization:        p.utilization,
          idleThresholdFired: null,
          utilHighFired:      false,
        };
      });
      initialised.current = true;
      return;
    }

    const newAlerts: Alert[] = [];

    entries.forEach(p => {
      const prev = prevRef.current[p.plant_id];
      if (!prev) {
        prevRef.current[p.plant_id] = {
          online:             p.online,
          belt_active:        p.belt_active,
          session_num:        p.session_num,
          idle_s:             p.idle_s,
          utilization:        p.utilization,
          idleThresholdFired: null,
          utilHighFired:      false,
        };
        return;
      }

      const name = p.plant_name || p.plant_id;
      const now  = Date.now();

      // ── Online / offline ────────────────────────────────────────────
      if (prev.online && !p.online) {
        newAlerts.push({
          id: `${p.plant_id}-offline-${now}`,
          plant_id:   p.plant_id,
          plant_name: name,
          message:    `${name} – Went offline`,
          severity:   'critical',
          timestamp:  now,
        });
      } else if (!prev.online && p.online) {
        newAlerts.push({
          id: `${p.plant_id}-online-${now}`,
          plant_id:   p.plant_id,
          plant_name: name,
          message:    `${name} – Back online`,
          severity:   'info',
          timestamp:  now,
        });
      }

      if (p.online) {
        // ── Belt active → idle ────────────────────────────────────────
        if (prev.belt_active && !p.belt_active) {
          newAlerts.push({
            id: `${p.plant_id}-idle-${now}`,
            plant_id:   p.plant_id,
            plant_name: name,
            message:    `${name} – Belt went idle`,
            severity:   'warning',
            timestamp:  now,
          });
          prev.idleThresholdFired = null; // reset for this new idle streak
        }

        // ── Belt idle → active ────────────────────────────────────────
        if (!prev.belt_active && p.belt_active) {
          newAlerts.push({
            id: `${p.plant_id}-active-${now}`,
            plant_id:   p.plant_id,
            plant_name: name,
            message:    `${name} – Session #${p.session_num} started (${fmtTime(now)})`,
            severity:   'info',
            timestamp:  now,
          });
          prev.idleThresholdFired = null; // reset — no longer idle
        }

        // ── Idle duration milestones (while belt is still idle) ────────
        if (!p.belt_active && p.idle_s > 0) {
          // Find the highest threshold that has been crossed but not yet alerted
          const nextThreshold = IDLE_THRESHOLDS_S
            .filter(t => p.idle_s >= t && (prev.idleThresholdFired === null || t > prev.idleThresholdFired))
            .pop(); // take the highest crossed threshold

          if (nextThreshold !== undefined) {
            const { message, severity } = idleNotificationMessage(name, nextThreshold);
            newAlerts.push({
              id: `${p.plant_id}-idle-${nextThreshold}-${now}`,
              plant_id:   p.plant_id,
              plant_name: name,
              message,
              severity,
              timestamp:  now,
            });
            prev.idleThresholdFired = nextThreshold;
          }
        }

        // ── High utilisation ──────────────────────────────────────────
        if (p.utilization >= UTIL_HIGH_PCT && !prev.utilHighFired) {
          newAlerts.push({
            id: `${p.plant_id}-util-high-${now}`,
            plant_id:   p.plant_id,
            plant_name: name,
            message:    `${name} – Utilisation above ${UTIL_HIGH_PCT}%`,
            severity:   'info',
            timestamp:  now,
          });
          prev.utilHighFired = true;
        } else if (p.utilization < UTIL_HIGH_PCT) {
          prev.utilHighFired = false; // reset so it can fire again if util climbs back up
        }
      }

      // Persist updated tracking state
      prevRef.current[p.plant_id] = {
        ...prev,
        online:      p.online,
        belt_active: p.belt_active,
        session_num: p.session_num,
        idle_s:      p.idle_s,
        utilization: p.utilization,
      };
    });

    if (newAlerts.length > 0) {
      setAlerts(prev => [...newAlerts, ...prev].slice(0, MAX_ALERTS));
    }
  }, [plants]);

  return alerts;
}
