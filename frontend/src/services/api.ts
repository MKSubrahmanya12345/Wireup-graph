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
import type { AgenticEvent, AuthSession, BuildFile } from '../types/build';

/** Vite dev-server proxies /api to the backend, so this stays relative. */
const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

/** Session token — set by the auth store, attached to every call. */
let authToken: string | null = localStorage.getItem('wireup.token');

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (token) localStorage.setItem('wireup.token', token);
  else localStorage.removeItem('wireup.token');
}

function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

/** Called on a hard 401 so the app returns to the login screen. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

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
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init?.headers },
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
    if (response.status === 401 && !path.startsWith('/auth/')) {
      setAuthToken(null);
      onUnauthorized?.();
    }
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
    provider?: string;
    model?: string;
  }) =>
    request<PlanResponse>('/architecture/plan', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Deterministic repair loop for page 02 — normalises the graph and
   *  re-runs the engineering rules. No LLM, no credits. */
  repairArchitecture: (body: {
    graph: ArchitectureGraph;
    requirements?: RequirementsSpec | null;
  }) =>
    request<PlanResponse>('/architecture/repair', {
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
    provider?: string;
    model?: string;
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

  // ── Agentic build ───────────────────────────────────────────────────────
  /** The hardcoded MERN scaffold (no LLM call). */
  getScaffold: () =>
    request<{ root: string; files: BuildFile[] }>('/build/scaffold'),

  healthToolchain: () =>
    request<{ node: string | null; npm: string | null; gpp: string | null }>('/healthz/toolchain'),

  signup: (body: { name: string; email: string; password: string }) =>
    request<AuthSession>('/auth/signup', { method: 'POST', body: JSON.stringify(body) }),

  /** One-click session — no account needed. */
  guest: () => request<AuthSession>('/auth/guest', { method: 'POST', body: JSON.stringify({}) }),

  login: (body: { email: string; password: string }) =>
    request<AuthSession>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  me: () => request<{ user: AuthSession['user'] }>('/auth/me'),
};
/**
 * Stream the agentic build: POST + NDJSON reader, one callback per event.
 * Resolves when the stream closes; rejects on transport/parse failures.
 */
export async function streamAgenticBuild(
  body: {
    brief: string;
    projectName?: string;
    graph: unknown;
    provider?: string;
    model?: string;
  },
  onEvent: (event: AgenticEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/build/agentic/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    throw new ApiError('Cannot reach the Wireup API. Is the backend running?', 0);
  }

  if (!response.ok) {
    if (response.status === 401) {
      setAuthToken(null);
      onUnauthorized?.();
    }
    const text = await response.text().catch(() => '');
    let message = `Build failed (${response.status})`;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      /* html error page — keep default */
    }
    throw new ApiError(message, response.status);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new ApiError('Streaming not supported by this browser.', 0);

  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        onEvent(JSON.parse(line) as AgenticEvent);
      }
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as AgenticEvent);
}
