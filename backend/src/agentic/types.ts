/**
 * Shared types for the Wireup agentic build pipeline.
 */

import type { ArchitectureGraph } from '../schemas/architecture.js';
import type { BuildFile, FirmwareResult, WebsiteRequirements } from '../schemas/build.js';

/** One structured finding produced by a validator (terminal or static). */
export interface ValidationFinding {
  severity: 'error' | 'warning' | 'notice';
  /** Machine code, e.g. 'GPP-SYNTAX', 'NO-ENTRYPOINT', 'TSC2339'. */
  code: string;
  message: string;
  file?: string;
  line?: number;
  /** What the engine suggests doing about it. */
  hint?: string;
}

export interface ValidationReport {
  target: 'firmware' | 'software' | 'consistency' | 'graph';
  ok: boolean;
  /** The checks that actually ran, in order. */
  checks: { name: string; ok: boolean; detail: string }[];
  findings: ValidationFinding[];
  /** Terminal commands that were executed, verbatim, with exit codes. */
  commands: { cmd: string; exitCode: number | null; output: string; durationMs: number }[];
  durationMs: number;
}

/** Events streamed to the browser as NDJSON while the pipeline runs. */
export type BuildEvent =
  | { type: 'stage'; stage: string; title: string; detail?: string }
  | { type: 'log'; stage: string; line: string; tone?: 'info' | 'ok' | 'warn' | 'error' }
  | { type: 'command'; stage: string; cmd: string; cwd?: string }
  | {
      type: 'command_result';
      stage: string;
      cmd: string;
      exitCode: number | null;
      output: string;
      durationMs: number;
    }
  | { type: 'validation'; stage: string; report: ValidationReport }
  | { type: 'artifact'; stage: string; summary: string; files: string[] }
  | { type: 'result'; result: AgenticBuildResult }
  | { type: 'error'; message: string };

/** What the two independent readiness indicators on page 03 are built from. */
export interface BuildSimulationSummary {
  hardware: {
    provider: string;
    ready: boolean;
    /** True when the SIMULATOR failed, not the circuit. Never silently skipped. */
    errored: boolean;
    checks: { name: string; ok: boolean; detail: string }[];
    log: string[];
    durationMs: number;
    runUrl?: string;
  };
  software: {
    ready: boolean;
    checks: { name: string; ok: boolean; detail: string }[];
    detail: string;
  };
  /** Downloads unlock only when both are true. */
  downloadUnlocked: boolean;
}

/** Where page 04 can serve the dashboard this build produced. */
export interface BuildPreviewSummary {
  id: string;
  url: string;
  apiBase: string;
  publishedAt: string;
  stubbedApi: true;
  note: string;
}

export interface AgenticBuildResult {
  projectName: string;
  slug: string;
  engine: 'deterministic' | 'llm-assisted';
  iterations: { firmware: number; software: number };
  firmware: FirmwareResult;
  websiteRequirements: WebsiteRequirements;
  software: {
    projectName: string;
    files: BuildFile[];
    readme: string;
    envExampleLines: string[];
  };
  validation: {
    firmware: ValidationReport;
    software: ValidationReport;
    consistency: ValidationReport;
  };
  /** Which LLM provider actually ran for this build (after any fallback). */
  llm: { plan: 'free' | 'pro'; requested: string; actual: string; note?: string };
  simulation: BuildSimulationSummary;
  /** Per-build instructions, generated from this build's resolved plan. */
  instructions: { path: string; content: string };
  /** BOM with purchase links for this exact build. */
  bom: import('./bom.js').Bom;
  /** Null when the dashboard build produced nothing servable. */
  preview: BuildPreviewSummary | null;
}

/** The resolved, build-ready device model the generators consume. */
export interface DeviceBuildPlan {
  projectName: string;
  slug: string;
  brief: string;
  board: BoardProfile;
  modules: ResolvedModule[];
  webServer: boolean;
  sampleIntervalMs: number;
  wifi: { ssid: string; password: string; configured: boolean };
}

/**
 * Why a GPIO must not be used (or must be used carefully) for a wiring role.
 * These are the pins a board reads at boot or uses internally — assigning a
 * module to one of them can stop the firmware from booting at all, a class of
 * failure the compiler can never catch.
 */
export type PinRestriction =
  | 'strapping' // sampled at boot; level during power-on decides boot mode/flash voltage
  | 'input-only' // no output driver; digitalWrite/ledc/I2C SDA cannot work
  | 'flash' // bonded to the SPI flash chip; unavailable
  | 'reserved'; // reserved for the USB/JTAG/onboard subsystem

export interface BoardProfile {
  id: string;
  name: string;
  mcu: string;
  platformioEnv: string;
  pioBoard: string;
  voltage: number;
  wifi: boolean;
  /** Preferred GPIOs for each signal role. */
  pinPreferences: Record<string, string[]>;
  /**
   * Per-GPIO engineering constraints for general wiring. Pins absent from
   * this map are free for general use. `safeFor` lets a strapping pin be used
   * by an input-only role (e.g. a strapping pin sampled HIGH is fine as an
   * output) where that is genuinely safe.
   */
  gpioConstraints?: Record<string, { restriction: PinRestriction; note: string }>;
  archDefine: string;
}

/** A sensor/actuator from the knowledge base, bound to concrete pins. */
export interface ResolvedModule {
  deviceId: string;
  nodeId: string;
  name: string;
  partNumber: string;
  kind: 'sensor' | 'actuator' | 'display' | 'other';
  bus: 'single-wire' | 'i2c' | 'spi' | 'uart' | 'analog' | 'pwm' | 'gpio';
  /** signal role → MCU pin label, e.g. { data: 'GPIO4' } */
  pins: Record<string, string>;
  metrics: DeviceMetricSpec[];
  controls: DeviceControlSpec[];
  libraries: { name: string; source: string }[];
  firmwareNotes: string[];
  wiringNotes: string[];
}

export interface DeviceMetricSpec {
  id: string;
  label: string;
  unit: string;
  jsonField: string;
  min?: number;
  max?: number;
}

export interface DeviceControlSpec {
  id: string;
  label: string;
  kind: 'toggle' | 'select' | 'button';
  jsonField: string;
  command: Record<string, unknown>;
}

export interface PipelineInput {
  brief: string;
  /**
   * The paying tier of the human who started this build. Recorded per build
   * for usage accounting; every tier runs on AWS Bedrock.
   */
  userPlan?: 'free' | 'pro';
  userId?: string;
  userEmail?: string;
  projectName?: string;
  graph: ArchitectureGraph;
  provider?: 'bedrock';
  model?: string;
  /**
   * The human's answer to page-01's "how often should the device sample?"
   * question. Without it the build silently falls back to the KB default —
   * the question existed but its answer never reached the firmware.
   */
  sampleIntervalMs?: number;
  /**
   * Optional follow-up change request for a SECOND+ build turn ("make the
   * relay active-low", "publish battery voltage"). When present and an LLM is
   * configured, the generated firmware is edited to satisfy it before the
   * normal validate → repair gauntlet runs — so multi-turn iteration is held
   * to the exact same terminal gate as a first draft.
   */
  revisionInstruction?: string;
}

export type EmitFn = (event: BuildEvent) => void;
