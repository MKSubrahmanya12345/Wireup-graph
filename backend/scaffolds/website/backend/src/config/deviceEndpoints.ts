import { env } from './env.js';

/**
 * [AI-GENERATED] How the backend reaches the device.
 *
 * This is the one file the Agentic Build fills in. The scaffold never edits it
 * by hand. Every endpoint below maps to a route the device firmware exposes.
 *
 * Paths are resolved against `${DEVICE_PROTOCOL}://${DEVICE_IP}:${DEVICE_PORT}`
 * unless they are absolute URLs.
 */

export interface DeviceEndpoint {
  /** Stable id, e.g. "temperature". */
  id: string;
  /** Human label, e.g. "Temperature". */
  label: string;
  /** Path on the device, e.g. "/api/sensor/temperature". */
  path: string;
  /** HTTP method used to reach it. */
  method: 'GET' | 'POST' | 'PUT';
  /** What the device returns (text/JSON). */
  kind: 'text' | 'json';
  /** Optional unit suffix, e.g. "°C". */
  unit?: string;
  /** Whether this endpoint requires a command body (POST). */
  payload?: boolean;
  /** JSON key inside the payload this metric reads (for history extraction). */
  field?: string;
}

/**
 * The base URL of the device as seen by the backend.
 * Prefers DEVICE_IP, then the mDNS hostname, then a sane default.
 */
export function deviceBaseUrl(): string {
  const host = env.DEVICE_IP || env.DEVICE_HOST || '192.168.1.100';
  return `${env.DEVICE_PROTOCOL}://${host}:${env.DEVICE_PORT}`;
}

/** All endpoints the dashboard reads live / charts. */
export function readEndpoints(): DeviceEndpoint[] {
  return defaultReadEndpoints;
}

/** All endpoints the dashboard can command (actuators). */
export function controlEndpoints(): DeviceEndpoint[] {
  return defaultControlEndpoints;
}

/** The canonical device manifest (identity + capability summary). */
export function deviceInfo(): Record<string, string> {
  return {
    name: 'wireup-device',
    firmware: 'wireup-firmware-1.0.0',
    transport: 'http-lan',
  };
}

// ── Defaults (the builder replaces these for your specific device) ─────────
const defaultReadEndpoints: DeviceEndpoint[] = [
  {
    id: 'status',
    label: 'Status',
    path: '/api/status',
    method: 'GET',
    kind: 'json',
  },
];

const defaultControlEndpoints: DeviceEndpoint[] = [];
