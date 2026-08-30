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
    // Commands are form-encoded: the ESP32 WebServer parses server.arg() from
    // query strings and form bodies — it does NOT parse JSON bodies. Sending
    // JSON here made every control endpoint 400 with "missing state".
    const init: RequestInit =
      body === undefined
        ? { method: endpoint.method }
        : {
            method: endpoint.method,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(
              Object.fromEntries(
                Object.entries(body as Record<string, unknown>).map(([key, value]) => [
                  key,
                  String(value),
                ]),
              ),
            ).toString(),
          };

    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Device returned ${response.status}`);
    }
    const text = await response.text();
    return safeJson(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * All live readings, one FULL payload per read endpoint.
 *
 * The live payload must stay nested (`live.temperature.temperature_c`): the
 * dashboard's metric paths resolve through the endpoint id first. Extracting
 * the number here would flatten `live.temperature` to a primitive and break
 * every live card. History extraction happens at the telemetry layer via
 * `endpoint.field` — see routes/telemetry.ts.
 */
export async function getLiveReadings(): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    readEndpoints().map(async (endpoint) => {
      const payload = await fetchDevice(endpoint);
      return [endpoint.id, payload] as const;
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
  // The firmware's /api/status publishes `uptime_s` (seconds).
  const uptime = getPath(status, 'uptime_s') ?? getPath(status, 'uptime');
  return { ...info, uptime: uptime ?? null };
}
