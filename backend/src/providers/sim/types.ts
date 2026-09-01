/**
 * HardwareSimProvider — one interface, two implementations.
 *
 *   MockHardwareSimProvider — deterministic canned pass/fail log derived from
 *     the resolved build plan. No network, no credentials, always available.
 *   VelxioSimProvider       — thin real adapter against a Velxio pipeline
 *     (github.com/davidmonterocrespo24/velxio), selected with SIM_MODE=velxio
 *     + VELXIO_URL.
 *
 * The pipeline only ever sees this interface, so swapping in the real
 * simulator is an env-var change.
 */

import type { DeviceBuildPlan } from '../../agentic/types.js';

export type SimMode = 'mock' | 'velxio';

export interface SimCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SimResult {
  provider: SimMode;
  /** True only when the simulated hardware actually behaved. */
  ok: boolean;
  /** Set when the provider itself failed (network, auth, crash). Never
   *  conflated with a legitimate "the circuit is wrong" failure. */
  errored: boolean;
  checks: SimCheck[];
  /** Raw simulator log, surfaced verbatim in the build terminal. */
  log: string[];
  durationMs: number;
  /** Optional link to a hosted run (Velxio). */
  runUrl?: string;
}

export interface HardwareSimProvider {
  readonly mode: SimMode;
  describe(): string;
  runSim(plan: DeviceBuildPlan): Promise<SimResult>;
}
