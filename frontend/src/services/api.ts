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
};