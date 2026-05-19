import type { Plant, PlantId, PlantState } from '../types';

/** Role constants — safe to import in both client and server components */
export const ROLES = {
  ADMIN:      'admin',
  SUPERVISOR: 'supervisor',
} as const;

export const PLANTS: Plant[] = [
  { id: 'SP-01', name: 'SP-01' },
  { id: 'SP-02', name: 'SP-02' },
  { id: 'SP-03', name: 'SP-03' },
  { id: 'SP-04', name: 'SP-04' },
  { id: 'SP-05', name: 'SP-05' },
  { id: 'SP-06', name: 'SP-06' },
];

/** Preview video paths keyed by PlantId — used on both the monitoring grid and the plant detail page */
export const PREVIEW_VIDEOS: Record<PlantId, string> = {
  'SP-01': '/monitoring/Applying-Surface-Spray-Finish-To-A-Leather-Animal-2026-01-22-23-47-27-Utc.mp4',
  'SP-02': '/monitoring/Closeup-Shot-Of-Leather-Being-Sprayed-During-Manuf-2026-01-23-00-17-03-Utc.mp4',
  'SP-03': '/monitoring/Hands-Placing-Leather-Hides-Onto-A-Conveyor-Belt-D-2026-01-22-19-47-49-Utc.mp4',
  'SP-04': '/monitoring/Industrial-Conveyor-Belt-Moving-Leather-Hides-In-A-2026-01-20-19-21-09-Utc.mp4',
  'SP-05': '/monitoring/Machine-Spray-Coating-Leather-Hides-In-A-Productio-2026-01-20-17-58-57-Utc.mp4',
  'SP-06': '/monitoring/Worker-Drops-Hides-Onto-A-Conveyor-Belt-Leather-M-2026-01-22-13-32-14-Utc.mp4',
};

export const WS_URL  = process.env.NEXT_PUBLIC_WS_URL  ?? 'ws://localhost:8001';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001';

// Belt utilization colour thresholds
export const UTIL_HIGH = 80; // green
export const UTIL_MED  = 50; // amber
// below UTIL_MED → red

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

/** Empty placeholder plant state — used only until the first WS frame arrives.
 *  All values are zero / offline so the dashboard never renders fake numbers. */
export function emptyPlantState(plantId: PlantId, plantName: string): PlantState {
  return {
    plant_id:      plantId,
    plant_name:    plantName,
    online:        false,
    belt_active:   false,
    total_count:   0,
    session_num:   0,
    session_count: 0,
    active_tracks: 0,
    proc_fps:      0,
    utilization:   0,
    runtime_s:     0,
    idle_s:        0,
    thumbnail:     null,
    sessions:      [],
    last_updated:  0,
    mock:          true,
  };
}
