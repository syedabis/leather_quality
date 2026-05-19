// ── Domain types shared across the dashboard ─────────────────────────────────

export type PlantId = 'SP-01' | 'SP-02' | 'SP-03' | 'SP-04' | 'SP-05' | 'SP-06';

export type Role = 'admin' | 'supervisor';

export interface Plant {
  id: PlantId;
  name: string;
}

export interface SessionData {
  num: number;
  start: number | null;
  end: number | null;
  duration: number | null;
  pieces: number;
  color: string | null;
  active?: boolean;
}

export interface PlantState {
  plant_id: PlantId;
  plant_name: string;
  online: boolean;
  belt_active: boolean;
  total_count: number;
  session_num: number;
  session_count: number;
  active_tracks: number;
  proc_fps: number;
  utilization: number;
  runtime_s: number;
  idle_s: number;
  thumbnail: string | null;
  sessions: SessionData[];
  last_updated: number;
  mock?: boolean;
}

export interface CrossingEvent {
  plant_id: PlantId;
  plant_name: string;
  total_count: number;
  timestamp: number;
}

export type LotDecisionType =
  | 'SAME_LOT'
  | 'FLAGGED_PROBABLE'
  | 'NEW_LOT_OPENED'
  | 'PENDING';

export interface LotDecision {
  id: number;
  plant_id: PlantId;
  plant_name: string;
  session_num: number;
  decision: LotDecisionType;
  confidence: number;
  gap_s: number;
  color_rgb: [number, number, number];
  confirmed_by: string | null;
  timestamp: number;
}

// ── WebSocket message discriminated union ─────────────────────────────────────

export type WsFrameMessage = {
  type: 'frame';
} & Partial<PlantState> & {
  plant_id: PlantId;
  thumbnail: string | null;
};

export interface WsCrossingMessage {
  type: 'crossing';
  plant_id: PlantId;
  total_count: number;
  timestamp?: number;
}

export interface WsPlantOfflineMessage {
  type: 'plant_offline';
  plant_id: PlantId;
}

export interface WsPlantsBatchMessage {
  type: 'plants_batch';
  plants: PlantState[];
}

export type WsMessage = WsFrameMessage | WsCrossingMessage | WsPlantOfflineMessage | WsPlantsBatchMessage;

