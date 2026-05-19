import { API_URL } from './constants';

async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

/* ── Analytics ───────────────────────────────────────────────── */
export const getAnalyticsByHour = (date: string, unit?: string) =>
  apiFetch(`/api/analytics/by-hour?date=${date}${unit ? `&unit=${unit}` : ''}`);

export const getAnalyticsByDay = (from?: string, to?: string, unit?: string) => {
  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to) params.append('to', to);
  if (unit) params.append('unit', unit);
  const qs = params.toString();
  return apiFetch(`/api/analytics/by-day${qs ? `?${qs}` : ''}`);
};

export const getAnalyticsByShift = (from?: string, to?: string, unit?: string) => {
  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to) params.append('to', to);
  if (unit) params.append('unit', unit);
  const qs = params.toString();
  return apiFetch(`/api/analytics/by-shift${qs ? `?${qs}` : ''}`);
};

/* ── Sessions ────────────────────────────────────────────────── */
export const getSessions = (params: Record<string, string> = {}) => {
  const qs = new URLSearchParams(params).toString();
  return apiFetch(`/api/sessions${qs ? `?${qs}` : ''}`);
};

export const getSession = (id: string | number) => apiFetch(`/api/sessions/${id}`);

export const getPlantSessions = (plantId: string, from: string, to: string) => {
  const qs = new URLSearchParams({ unit: plantId, from, to }).toString();
  return apiFetch(`/api/sessions?${qs}`);
};

/* ── Lots ────────────────────────────────────────────────────── */
export const getLots = (params: Record<string, string> = {}) => {
  const qs = new URLSearchParams(params).toString();
  return apiFetch(`/api/v1/lots${qs ? `?${qs}` : ''}`);
};

export const confirmLot = (lotId: string | number, decision: string) =>
  apiFetch(`/api/v1/lots/${lotId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });

/* ── Idle periods ────────────────────────────────────────────── */
export const getIdlePeriods = (from: string, to: string, plantId?: string) => {
  const qs = new URLSearchParams({ from, to, ...(plantId ? { unit: plantId } : {}) }).toString();
  return apiFetch(`/api/idle-periods?${qs}`);
};

/* ── Summary (for daily/period aggregates) ──────────────────────── */
export const getSummary = (unit?: string, from?: string, to?: string) => {
  const params = new URLSearchParams();
  if (unit) params.append('unit', unit);
  if (from) params.append('from', from);
  if (to) params.append('to', to);
  const qs = params.toString();
  return apiFetch(`/api/summary${qs ? `?${qs}` : ''}`);
};

/* ── Reports ─────────────────────────────────────────────────── */
export const generateReport = (date: string, plantId: string) =>
  apiFetch('/api/v1/reports/generate', {
    method: 'POST',
    body: JSON.stringify({ date, plant_id: plantId }),
  });
