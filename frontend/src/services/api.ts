import type {
  ArchitectureGraph,
  PlanResponse,
  ProjectDetail,
  ProjectSummary,
} from '../types/architecture';
import type {
  InterpretResponse,
  Question,
  RequirementsSpec,
} from '../types/session';
import type {
  BuildFile,
  FirmwareResult,
  FullBuildResult,
  WebsiteBuildResult,
  WebsiteRequirements,
} from '../types/build';

/** Vite dev-server proxies /api to the backend, so this stays relative. */
const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError('Cannot reach the architecture service. Is the backend running?', 0);
  }

  // Never assume JSON — a proxy 502 returns HTML.
  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : null) ?? `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export const api = {
  health: () => request<{ status: string }>('/healthz'),

  planArchitecture: (body: {
    request: string;
    graph: ArchitectureGraph;
    projectId?: string | null;
    requirements?: RequirementsSpec | null;
    feedback?: string[];
  }) =>
    request<PlanResponse>('/architecture/plan', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Pass 0 of the loop: decide everything, ask only what it cannot. */
  interpretBrief: (body: {
    brief: string;
    answers?: Record<string, string>;
    priorRequirements?: RequirementsSpec;
    priorQuestions?: Question[];
    feedback?: string[];
    graph?: unknown;
  }) =>
    request<InterpretResponse>('/architecture/interpret', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listProjects: () => request<ProjectSummary[]>('/projects'),

  createProject: (body: { name: string; summary?: string }) =>
    request<ProjectSummary>('/projects', { method: 'POST', body: JSON.stringify(body) }),

  getProject: (id: string) => request<ProjectDetail>(`/projects/${id}`),

  deleteProject: (id: string) =>
    request<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),

  renderArchitecture: (body: {
    graph: ArchitectureGraph;
    projectId?: string | null;
    force?: boolean;
    angle?: string;
  }) =>
    request<{
      status: 'ready' | 'pending' | 'unavailable';
      url?: string;
      prompt?: string;
      negativePrompt?: string;
      cached?: boolean;
    }>('/architecture/render', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Validation loop endpoints
  runValidationLoop: (body: {
    graph: ArchitectureGraph;
    projectName?: string;
    doubts?: unknown[];
    resolvedDoubts?: Record<string, string>;
    requirements?: RequirementsSpec | null;
    notes?: string[];
  }) =>
    request<{
      loopId: string;
      status: 'in_progress' | 'perfect' | 'blocked';
      doubtsAsked: number;
      doubtsResolved: number;
      isPerfect: boolean;
      score: number;
      summary: string;
      doubts: unknown[];
      validationLoops: unknown[];
      persistenceEnabled: boolean;
    }>('/validation/loop', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  checkPerfectStatus: (body: {
    graph: ArchitectureGraph;
    doubts?: unknown[];
    resolvedDoubts?: Record<string, string>;
    requirements?: RequirementsSpec | null;
  }) =>
    request<{
      isPerfect: boolean;
      score: number;
      blocking: boolean;
      doubtsResolved: number;
      totalDoubts: number;
      summary: string;
    }>('/validation/check-perfect', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listPerfectGraphDSAs: () =>
    request<{ count: number; perfectDSAs: unknown[]; persistenceEnabled: boolean }>(
      '/validation/dsa/perfect',
    ),

  getGraphDSA: (id: string) =>
    request<{ id: string; projectName: string; isPerfect: boolean; prdDocument: unknown; updatedAt: string }>(
      `/validation/dsa/${id}`,
    ),

  // ── Agentic build ───────────────────────────────────────────────────────
  /** The hardcoded MERN scaffold (no LLM call). */
  getScaffold: () =>
    request<{ root: string; files: BuildFile[] }>('/build/scaffold'),

  /** Step 1 — hardware: real firmware source for the device. */
  buildFirmware: (body: {
    brief: string;
    projectName: string;
    graph: ArchitectureGraph;
  }) =>
    request<FirmwareResult>('/build/firmware', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Step 2 — the Website Requirements section. */
  buildWebsiteRequirements: (body: {
    brief: string;
    projectName: string;
    graph: ArchitectureGraph;
    firmware?: FirmwareResult;
  }) =>
    request<WebsiteRequirements>('/build/website-requirements', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Step 3 — assemble the MERN codebase (scaffold + AI wiring). */
  buildWebsite: (body: {
    projectName: string;
    graph: ArchitectureGraph;
    websiteRequirements?: WebsiteRequirements | null;
    firmware?: FirmwareResult;
  }) =>
    request<WebsiteBuildResult>('/build/website', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Run the whole pipeline in order: firmware → requirements → website. */
  buildAll: (body: {
    brief: string;
    projectName: string;
    graph: ArchitectureGraph;
  }) =>
    request<FullBuildResult>('/build/all', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};