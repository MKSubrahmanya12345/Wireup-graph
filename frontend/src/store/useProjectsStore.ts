import { create } from 'zustand';

import { api, ApiError } from '../services/api';
import { loadPersisted, persistTo } from '../lib/localPersist';
import type {
  ArchitectureGraph,
  ProjectDetail,
  ProjectSummary,
  VerificationReport,
} from '../types/architecture';

/**
 * Multiple projects per account.
 *
 * Server mode (MONGO_URI set): the API is the source of truth — this store is
 * a cache of GET /api/projects, scoped to the signed-in user by the backend.
 *
 * Local mode (no Mongo → the API answers 503): the list falls back to a
 * browser-local index so the multi-project homepage still works in dev. Every
 * successful plan is mirrored into that index either way, so switching modes
 * never loses the bench.
 */

interface LocalProjectEntry extends ProjectSummary {
  brief: string;
  graph: ArchitectureGraph;
  verification: VerificationReport | null;
}

const LOCAL_INDEX_KEY = 'wireup.projects.local.v1';

function readLocalIndex(): LocalProjectEntry[] {
  const raw = loadPersisted<{ entries: LocalProjectEntry[] }>(LOCAL_INDEX_KEY);
  const entries = raw?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (entry): entry is LocalProjectEntry =>
      entry && typeof entry.id === 'string' && typeof entry.name === 'string',
  );
}

function writeLocalIndex(entries: LocalProjectEntry[]): void {
  // Keep it bounded — the 30 newest projects stay, the rest roll off.
  persistTo(LOCAL_INDEX_KEY, { entries: entries.slice(0, 30) });
}

function upsertLocal(entry: LocalProjectEntry): LocalProjectEntry[] {
  const next = readLocalIndex().filter((existing) => existing.id !== entry.id);
  next.unshift(entry);
  writeLocalIndex(next);
  return next;
}

function newLocalId(): string {
  return `local:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface ProjectsState {
  projects: ProjectSummary[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** 'server' = Mongo-backed; 'local' = browser-only (no MONGO_URI). */
  mode: 'server' | 'local';
  error: string | null;

  refresh: () => Promise<void>;

  /**
   * Mirror a finished plan into the local index (and the cached list so the
   * homepage is instantly fresh). Returns the id the project was filed under.
   */
  recordPlan: (input: {
    /** Stable key for local mode (see useDesignSession.localProjectId). */
    key?: string | null;
    /** Server-assigned id when persistence is on, else null. */
    projectId?: string | null;
    name: string;
    summary: string;
    brief: string;
    graph: ArchitectureGraph;
    verification: VerificationReport | null;
  }) => string;

  /** Full detail for "open" — server copy first, local snapshot as fallback. */
  loadDetail: (id: string) => Promise<ProjectDetail>;

  /** A local-mode project gained a server id — drop the stale local entry. */
  forgetLocal: (id: string) => void;

  remove: (id: string) => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>()((set, get) => ({
  projects: [],
  status: 'idle',
  mode: 'server',
  error: null,

  refresh: async () => {
    set({ status: 'loading', error: null });
    try {
      const projects = await api.listProjects();
      set({ projects, mode: 'server', status: 'ready' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        // Persistence is off server-side — degrade to the browser index.
        set({ projects: readLocalIndex(), mode: 'local', status: 'ready' });
        return;
      }
      set({
        status: 'error',
        error:
          error instanceof Error ? error.message : 'Could not load the projects list.',
      });
    }
  },

  recordPlan: ({ key, projectId, name, summary, brief, graph, verification }) => {
    const id = projectId ?? key ?? newLocalId();
    const entry: LocalProjectEntry = {
      id,
      name: name || brief.slice(0, 60) || 'Untitled hardware system',
      summary: summary || brief.slice(0, 160),
      nodeCount: graph.nodes.length,
      updatedAt: new Date().toISOString(),
      brief,
      graph,
      verification,
    };
    const localEntries = upsertLocal(entry);

    // Keep the cached homepage list fresh in both modes.
    const summaryEntry: ProjectSummary = {
      id: entry.id,
      name: entry.name,
      summary: entry.summary,
      nodeCount: entry.nodeCount,
      updatedAt: entry.updatedAt,
    };
    if (projectId) {
      const rest = get().projects.filter((project) => project.id !== entry.id);
      set({ mode: 'server', projects: [summaryEntry, ...rest].slice(0, 50) });
    } else {
      // No server id → stateless API: the local index IS the list.
      set({ projects: localEntries });
    }
    return id;
  },

  loadDetail: async (id) => {
    if (!id.startsWith('local:')) {
      try {
        return await api.getProject(id);
      } catch {
        // Not on the server (or not ours) — fall through to the local mirror.
      }
    }
    const entry = readLocalIndex().find((project) => project.id === id);
    if (!entry) {
      throw new Error('That project is not on the server and not in this browser.');
    }
    return {
      id: entry.id,
      name: entry.name,
      summary: entry.summary,
      nodeCount: entry.nodeCount,
      updatedAt: entry.updatedAt,
      graph: entry.graph,
      verification: entry.verification,
      revisions: [
        { id: entry.id, request: entry.brief, createdAt: entry.updatedAt },
      ],
    };
  },

  forgetLocal: (id) => {
    writeLocalIndex(readLocalIndex().filter((project) => project.id !== id));
    set({ projects: get().projects.filter((project) => project.id !== id) });
  },

  remove: async (id) => {
    if (!id.startsWith('local:')) {
      try {
        await api.deleteProject(id);
      } catch {
        // Server copy already gone (or persistence off) — clean the mirror.
      }
    }
    writeLocalIndex(readLocalIndex().filter((project) => project.id !== id));
    if (get().mode === 'local') {
      set({ projects: readLocalIndex() });
    } else {
      await get().refresh();
    }
  },
}));
