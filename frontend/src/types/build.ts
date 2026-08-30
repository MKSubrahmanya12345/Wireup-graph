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
