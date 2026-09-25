import type { Plant, PlantId, PlantState } from '../types';

/** Role constants — safe to import in both client and server components */
export const ROLES = {
  ADMIN:      'admin',
  SUPERVISOR: 'supervisor',
} as const;

export const PLANTS: Plant[] = [
  { id: 'SP-01', name: 'SP-01 (Wet Blue Line 1)' },
  { id: 'SP-02', name: 'SP-02 (Wet Blue Line 2)' },
  { id: 'SP-03', name: 'SP-03 (Inspection Line 3)' },
  { id: 'SP-04', name: 'SP-04 (Inspection Line 4)' },
  { id: 'SP-05', name: 'SP-05 (Finishing Line 5)' },
  { id: 'SP-06', name: 'SP-06 (Finishing Line 6)' },
];

/** Preview video paths keyed by PlantId — used on both the monitoring grid and the plant detail page */
export const PREVIEW_VIDEOS: Record<PlantId, string> = {
  'SP-01': '/videos/SP-01.mp4',
  'SP-02': '/videos/SP-02.mp4',
  'SP-03': '/videos/SP-01.mp4',
  'SP-04': '/videos/SP-02.mp4',
  'SP-05': '/videos/SP-01.mp4',
  'SP-06': '/videos/SP-02.mp4',
};

// Derive the backend host from the page's hostname at runtime so the dashboard
// works from any machine on the same network — not just localhost.
function _backendBase(scheme: 'http' | 'ws'): string {
  if (typeof window !== 'undefined') {
    const proto = scheme === 'ws'
      ? (window.location.protocol === 'https:' ? 'wss:' : 'ws:')
      : window.location.protocol;
    return `${proto}//${window.location.hostname}:8001`;
  }
  return scheme === 'ws'
    ? (process.env.NEXT_PUBLIC_WS_URL  ?? 'ws://localhost:8001')
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001');
}

export const WS_URL  = _backendBase('ws');
export const API_URL = _backendBase('http');

// Belt utilization colour thresholds
export const UTIL_HIGH = 80; // green
export const UTIL_MED  = 50; // amber

/** Returns a colour hex string based on utilization 0-100 */
export function utilColor(pct: number): string {
  if (pct >= UTIL_HIGH) return '#22C55E';
  if (pct >= UTIL_MED)  return '#F59E0B';
  return '#EF4444';
}

/** Format seconds as H:MM:SS */
export function fmtDuration(s: number | null | undefined): string {
  if (s == null) return '--';
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`;
  return `${sec}s`;
}

/** Initial plant state with high-quality mock defaults for instant standalone frontend viewing */
export function emptyPlantState(plantId: PlantId, plantName: string): PlantState {
  const seed = parseInt(plantId.replace(/\D/g, ''), 10) || 1;
  const initialCounts: Record<string, number> = {
    'SP-01': 1420,
    'SP-02': 1280,
    'SP-03': 1150,
    'SP-04': 980,
    'SP-05': 840,
    'SP-06': 1360,
  };
  const initialUtil: Record<string, number> = {
    'SP-01': 92,
    'SP-02': 86,
    'SP-03': 78,
    'SP-04': 64,
    'SP-05': 88,
    'SP-06': 95,
  };

  return {
    plant_id:      plantId,
    plant_name:    plantName,
    online:        true,
    belt_active:   true,
    total_count:   initialCounts[plantId] ?? (1000 + seed * 120),
    session_num:   4 + (seed % 3),
    session_count: 310 + seed * 45,
    active_tracks: 2 + (seed % 2),
    proc_fps:      29.8,
    utilization:   initialUtil[plantId] ?? 85,
    runtime_s:     21600 + seed * 1800,
    idle_s:        1200 + seed * 300,
    thumbnail:     null,
    sessions:      [],
    last_updated:  Date.now(),
    mock:          true,
  };
}

