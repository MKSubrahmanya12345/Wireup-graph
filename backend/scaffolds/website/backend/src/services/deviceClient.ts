import { env } from '../config/env.js';
import {
  controlEndpoints,
  deviceBaseUrl,
  deviceInfo,
  readEndpoints,
  type DeviceEndpoint,
} from '../config/deviceEndpoints.js';
import { getPath, safeJson } from '../lib/safeJson.js';

/**
 * Thin, safe HTTP proxy to the physical device.
 *
 * All outbound calls are time-boxed so a dead or slow device can never hang
 * the API. Live data is fetched on demand — the backend holds no stale copy.
 */

async function fetchDevice(
  endpoint: DeviceEndpoint,
  body?: unknown,
): Promise<unknown> {
  const base = deviceBaseUrl();
  const url = /^https?:\/\//i.test(endpoint.path)
    ? endpoint.path
    : `${base}${endpoint.path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.DEVICE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: endpoint.method,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw new Error(`Device returned ${response.status}`);
    }
    const text = await response.text();
    return safeJson(text);
  } finally {
    clearTimeout(timer);
  }
}

/** All live readings, one field per read endpoint. */
export async function getLiveReadings(): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    readEndpoints().map(async (endpoint) => {
      const value = await fetchDevice(endpoint);
      return [endpoint.id, value] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** Send a command to a control endpoint. */
export async function sendControl(
  endpointId: string,
  payload: unknown,
): Promise<{ ok: boolean; result: unknown }> {
  const endpoint = controlEndpoints().find((entry) => entry.id === endpointId);
  if (!endpoint) {
    throw new Error(`Unknown control endpoint: ${endpointId}`);
  }
  const result = await fetchDevice(endpoint, payload);
  return { ok: true, result };
}

/** The device identity + capability manifest. */
export async function getDeviceInfo(): Promise<Record<string, unknown>> {
  const info = deviceInfo();
  const status = await fetchDevice({
    id: 'status',
    label: 'Status',
    path: '/api/status',
    method: 'GET',
    kind: 'json',
  });
  const uptime = getPath(status, 'uptime');
  return { ...info, uptime: uptime ?? null };
}
