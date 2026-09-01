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

// ── Simulation, instructions, BOM (M4/M5) ──────────────────────────────────

export interface SimCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface BuildSimulationSummary {
  hardware: {
    provider: string;
    ready: boolean;
    /** The SIMULATOR failed (not the circuit) — surfaced explicitly. */
    errored: boolean;
    checks: SimCheck[];
    log: string[];
    durationMs: number;
    runUrl?: string;
  };
  software: {
    ready: boolean;
    checks: SimCheck[];
    detail: string;
  };
  downloadUnlocked: boolean;
}

export interface BomLink {
  vendor: string;
  url: string;
  note?: string;
}

export interface BomEntry {
  ref: string;
  name: string;
  partNumber: string;
  quantity: number;
  role: string;
  connections: string;
  approxPricePaise: number;
  datasheet?: string;
  links: BomLink[];
}

export interface Bom {
  entries: BomEntry[];
  totalApproxPaise: number;
  currency: 'INR';
  incomplete: boolean;
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
  llm: { plan: 'free' | 'pro'; requested: string; actual: string; note?: string };
  simulation: BuildSimulationSummary;
  instructions: { path: string; content: string };
  bom: Bom;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
}

// ── Billing / admin ─────────────────────────────────────────────────────────

export interface Plan {
  id: 'free' | 'pro';
  name: string;
  amountPaise: number;
  currency: 'INR';
  llmTier: 'groq' | 'gemini';
  features: string[];
  pricingPending: boolean;
}

export interface Subscription {
  id: string;
  userId: string;
  userEmail: string;
  plan: string;
  status: 'pending' | 'active' | 'failed' | 'refunded' | 'cancelled';
  provider: string;
  externalId: string;
  amount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutOutcome {
  subscriptionId: string;
  provider: string;
  externalId: string;
  checkoutUrl: string;
  publicKey?: string;
  amount: number;
  currency: string;
  plan: 'free' | 'pro';
  selfSettling: boolean;
  pricingPending: boolean;
}

export interface AdminOverview {
  users: { total: number; admins: number };
  subscriptions: { total: number; active: number; pending: number; failed: number };
  revenue: {
    currency: string;
    grossPaise: number;
    refundedPaise: number;
    netPaise: number;
    byPlan: Record<string, number>;
    payments: number;
    pricingPending: boolean;
  };
  usage: { total: number; builds: number; byLlmProvider: Record<string, number> };
  adapters: {
    payment: { mode: string; detail: string };
    sim: { mode: string; detail: string };
    llm: { gemini: boolean; groq: boolean };
  };
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
  plan: string;
}

export interface PaymentRecord {
  id: string;
  subscriptionId: string;
  userId: string;
  plan: string;
  provider: string;
  externalId: string;
  eventId: string;
  amount: number;
  currency: string;
  status: 'paid' | 'failed' | 'refunded' | 'pending';
  createdAt: string;
}

export interface WebhookLogEntry {
  id: string;
  eventId: string;
  provider: string;
  type: string;
  externalId: string;
  outcome: 'applied' | 'duplicate' | 'rejected' | 'unmatched';
  message: string;
  receivedAt: string;
}

export interface UsageEvent {
  id: string;
  userId: string;
  userEmail: string;
  kind: string;
  plan: string;
  llmProvider?: string;
  detail?: string;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  expiresIn: number;
  user: AuthUser;
}
