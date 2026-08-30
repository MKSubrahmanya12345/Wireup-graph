/**
 * [AI-GENERATED] Device definition the dashboard renders from.
 *
 * The Agentic Build fills this file in for your specific device. The UI is
 * fully data-driven: add a sensor here and a live card appears; add a control
 * and a button appears. No component edits required.
 */

export interface DeviceMetric {
  id: string; // matches backend readEndpoint id
  label: string;
  unit: string;
  /** How to read the numeric value off the device payload. */
  path: string; // e.g. "temperature.celsius" or "temperature"
  /** Chart-friendly numeric? */
  numeric: boolean;
  /** Optional min/max for chart scaling. */
  min?: number;
  max?: number;
}

export interface DeviceControl {
  id: string; // matches backend controlEndpoint id
  label: string;
  kind: 'toggle' | 'select' | 'button';
  options?: { value: string; label: string }[];
  /** What to send as the command payload. */
  command: Record<string, unknown>;
}

export interface DeviceSpec {
  name: string;
  tagline: string;
  metrics: DeviceMetric[];
  controls: DeviceControl[];
  /** Refresh interval for live readings (ms). */
  refreshMs: number;
  /** Header badges derived from status. */
  statusPath: string; // e.g. "status" or "status.state"
}

export const deviceSpec: DeviceSpec = {
  name: 'wireup-device',
  tagline: 'Generated device dashboard',
  metrics: [],
  controls: [],
  refreshMs: 3000,
  statusPath: 'status',
};
