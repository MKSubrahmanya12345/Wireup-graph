import { deviceSpec } from '../lib/deviceSpec';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export interface LivePayload {
  ts: string;
  [key: string]: unknown;
}

export interface Reading {
  metric: string;
  value: unknown;
  unit?: string;
  createdAt: string;
}

export const api = {
  health: () => request<{ ok: boolean }>('/health'),

  live: () => request<LivePayload>('/telemetry/live'),

  history: (metric?: string, limit = 200) =>
    request<{ metric: string | null; readings: Reading[] }>(
      `/telemetry/history?limit=${limit}${metric ? `&metric=${encodeURIComponent(metric)}` : ''}`,
    ),

  capabilities: () =>
    request<{ reads: unknown[]; controls: unknown[] }>('/capabilities'),

  control: (endpoint: string, payload: unknown) =>
    request<{ ok: boolean; result: unknown }>('/telemetry/control', {
      method: 'POST',
      body: JSON.stringify({ endpoint, payload }),
    }),

  deviceInfo: () => request<Record<string, unknown>>('/device/info'),
};

export function metricValue(live: LivePayload, path: string): unknown {
  let current: unknown = live;
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export { deviceSpec };
