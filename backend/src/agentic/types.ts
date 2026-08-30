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
  projectName?: string;
  graph: ArchitectureGraph;
  provider?: 'groq' | 'bedrock';
  model?: string;
}

export type EmitFn = (event: BuildEvent) => void;
