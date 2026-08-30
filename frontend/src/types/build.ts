/** Frontend mirror of the Agentic Build contracts. */

export interface BuildFile {
  path: string;
  content: string;
}

// ── Firmware ──────────────────────────────────────────────────────────────
export interface FirmwareFile {
  path: string;
  content: string;
}

export interface FirmwareResult {
  platform: string;
  board: string;
  language: string;
  framework: string;
  files: FirmwareFile[];
  buildSteps: string[];
  notes: string[];
}

// ── Website requirements ──────────────────────────────────────────────────
export interface ReadEndpoint {
  name: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT';
  description: string;
  dataType: string;
  unit?: string;
  sampleIntervalMs?: number;
}

export interface ControlEndpoint {
  name: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT';
  description: string;
  bodyType: string;
  commandOptions: string[];
}

export interface DataField {
  field: string;
  type: string;
  unit?: string;
  source: string;
}

export interface WebsiteRequirements {
  requested: boolean;
  summary: string;
  device: {
    name: string;
    connection: 'wifi' | 'ethernet' | 'serial' | 'ble' | 'cellular' | 'other';
    localIpHint?: string | null;
    port?: number;
    protocol: string;
    endpointBase: string;
    ssidHint?: string | null;
    credentialsRequired: boolean;
  };
  readEndpoints: ReadEndpoint[];
  controlEndpoints: ControlEndpoint[];
  telemetry: {
    livePath: string;
    historyPath: string;
    sampleRateMs?: number;
    retentionDays?: number;
  };
  dataModel: DataField[];
  security: string[];
  notes: string[];
}

// ── Website build ─────────────────────────────────────────────────────────
export interface WebsiteBuildResult {
  projectName: string;
  mergedFiles: BuildFile[];
  generatedFiles: BuildFile[];
  scaffoldFiles: number;
  vercel: { config: string; frontend: string; backend: string };
  buildNotes: string[];
}

export interface FullBuildResult {
  projectName: string;
  order: string[];
  firmware: FirmwareResult;
  websiteRequirements: WebsiteRequirements;
  website: WebsiteBuildResult | null;
  websiteRequested: boolean;
}

// ── Wireup agentic pipeline (streamed) ──────────────────────────────────────

export interface ValidationFinding {
  severity: 'error' | 'warning' | 'notice';
  code: string;
  message: string;
  file?: string;
  line?: number;
  hint?: string;
}

export interface ValidationReport {
  target: 'firmware' | 'software' | 'consistency' | 'graph';
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  findings: ValidationFinding[];
  commands: { cmd: string; exitCode: number | null; output: string; durationMs: number }[];
  durationMs: number;
}

export type AgenticEvent =
  | { type: 'stage'; stage: string; title: string; detail?: string }
  | { type: 'log'; stage: string; line: string; tone?: 'info' | 'ok' | 'warn' | 'error' }
  | { type: 'command'; stage: string; cmd: string; cwd?: string }
  | { type: 'command_result'; stage: string; cmd: string; exitCode: number | null; output: string; durationMs: number }
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

// ── Auth ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  expiresIn: number;
  user: AuthUser;
}
