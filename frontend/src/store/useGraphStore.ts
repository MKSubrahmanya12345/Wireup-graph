import { create } from 'zustand';

import { api } from '../services/api';
import { clearPersisted, loadPersisted, persistTo } from '../lib/localPersist';
import {
  emptyGraph,
  type ArchitectureGraph,
  type ArchitectureNode,
  type Issue,
  type PlanResponse,
  type RepairRecord,
  type VerificationReport,
} from '../types/architecture';

type Status = 'idle' | 'planning' | 'error';

interface GraphState {
  /** The canonical server-shaped graph. This — and only this — goes back to the API. */
  graph: ArchitectureGraph;
  verification: VerificationReport | null;
  projectId: string | null;

  request: string;
  status: Status;
  error: string | null;
  lastUpdated: string | null;

  /** Deterministic engineering violations from the last plan. */
  issues: Issue[];
  blocking: boolean;
  /** Automatic corrections the backend made to the model's raw output. */
  repairs: RepairRecord[];

  /** View-only state. Never sent to the server. */
  selectedNodeId: string | null;

  setStatus: (status: Status) => void;
  setIssues: (issues: Issue[], blocking: boolean) => void;
  setRequest: (request: string) => void;
  appendToRequest: (text: string) => void;
  selectNode: (id: string | null) => void;

  /** Commits a dragged position into the canonical graph (x/y, not a view-only object). */
  moveNode: (id: string, position: { x: number; y: number }) => void;

  // Commits a 3D drag into the canonical graph node's spatial.position3d.
  // Follows the identical pattern to moveNode: local state during drag, store commit on release.
  moveNode3D: (id: string, xyz: { x: number; y: number; z: number }) => void;

  submitPlan: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  reset: () => void;
  dismissError: () => void;

  /** Deterministic repair loop — normalises the graph and re-runs the rules. */
  autoRepair: () => Promise<void>;
}

const STARTER_REQUEST =
  'Design a battery-powered environmental sensor node. Sample temperature, humidity, and pressure every five minutes, buffer readings locally, and sync over Bluetooth when a phone is nearby. Keep it serviceable over USB-C and prioritize a long sleep life.';

// Survive page refreshes: the graph is the user's work — losing it on F5 is
// not acceptable for a local tool.
const GRAPH_PERSIST_KEY = 'wireup.graph.v1';
const persistedGraph = loadPersisted<{
  graph: ArchitectureGraph;
  verification: VerificationReport | null;
  issues: Issue[];
  blocking: boolean;
  repairs: RepairRecord[];
  projectId: string | null;
  lastUpdated: string | null;
}>(GRAPH_PERSIST_KEY);

export const useGraphStore = create<GraphState>()((set, get) => ({
  graph: persistedGraph?.graph ?? emptyGraph(),
  verification: persistedGraph?.verification ?? null,
  projectId: persistedGraph?.projectId ?? null,

  request: STARTER_REQUEST,
  status: 'idle',
  error: null,
  lastUpdated: persistedGraph?.lastUpdated ?? null,

  issues: persistedGraph?.issues ?? [],
  blocking: persistedGraph?.blocking ?? false,
  repairs: persistedGraph?.repairs ?? [],

  selectedNodeId: null,

  setStatus: (status) => set({ status }),

  setIssues: (issues, blocking) => set({ issues, blocking }),

  setRequest: (request) => set({ request }),

  appendToRequest: (text) =>
    set((state) => ({
      request: `${state.request.trim()} ${text}.`.trim(),
    })),

  selectNode: (selectedNodeId) => set({ selectedNodeId }),

  moveNode: (id, position) =>
    set((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((node) =>
          node.id === id
            ? { ...node, x: Math.round(position.x), y: Math.round(position.y) }
            : node,
        ),
      },
    })),

  // identical shape to moveNode; commits 3D position on drag-stop.
  moveNode3D: (id, xyz) =>
    set((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                spatial: {
                  ...node.spatial,
                  position3d: {
                    x: Math.round(xyz.x * 1000) / 1000,
                    y: Math.round(xyz.y * 1000) / 1000,
                    z: Math.round(xyz.z * 1000) / 1000,
                  },
                },
              }
            : node,
        ),
      },
    })),

  submitPlan: async () => {
    const { request, graph, projectId } = get();
    if (!request.trim()) {
      set({ status: 'error', error: 'Add a project brief before generating a plan.' });
      return;
    }

    set({ status: 'planning', error: null });
    try {
      const response = (await api.planArchitecture({
        request: request.trim(),
        graph,
        projectId,
      })) as PlanResponse;

      // Strip every envelope field. Leaving them in `nextGraph` puts
      // revisionId/blocking/repairs inside the canonical graph, which then
      // gets POSTed back to the planner on the next turn.
      const {
        verification = null,
        projectId: returnedId = null,
        issues: nextIssues = [],
        blocking: nextBlocking = false,
        repairs: nextRepairs = [],
        revisionId: _revisionId,
        ...nextGraph
      } = response;

      set({
        graph: nextGraph,
        verification,
        projectId: returnedId ?? projectId,
        issues: nextIssues,
        blocking: nextBlocking,
        repairs: nextRepairs,
        status: 'idle',
        error: null,
        lastUpdated: new Date().toISOString(),
        selectedNodeId: nextGraph.nodes[0]?.id ?? null,
      });
    } catch (error) {
      set({
        status: 'error',
        error:
          error instanceof Error
            ? error.message
            : 'Could not update the architecture plan.',
      });
    }
  },

  autoRepair: async () => {
    const { graph, projectId } = get();
    set({ status: 'planning', error: null });
    try {
      const response = (await api.repairArchitecture({
        graph,
      })) as PlanResponse;

      // Same envelope-stripping as submitPlan: only the canonical graph stays.
      const {
        verification = null,
        projectId: returnedId = null,
        issues: nextIssues = [],
        blocking: nextBlocking = false,
        repairs: nextRepairs = [],
        revisionId: _revisionId,
        ...nextGraph
      } = response;

      set({
        graph: nextGraph,
        verification,
        projectId: returnedId ?? projectId,
        issues: nextIssues,
        blocking: nextBlocking,
        repairs: nextRepairs,
        status: 'idle',
        error: null,
        lastUpdated: new Date().toISOString(),
        selectedNodeId: nextGraph.nodes[0]?.id ?? null,
      });
    } catch (error) {
      set({
        status: 'error',
        error:
          error instanceof Error
            ? error.message
            : 'Could not repair the architecture graph.',
      });
    }
  },

  loadProject: async (id) => {
    set({ status: 'planning', error: null });
    try {
      const project = await api.getProject(id);
      set({
        graph: project.graph,
        verification: project.verification,
        projectId: project.id,
        status: 'idle',
        error: null,
        selectedNodeId: project.graph.nodes[0]?.id ?? null,
      });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not load that project.',
      });
    }
  },

  reset: () => {
    clearPersisted(GRAPH_PERSIST_KEY);
    set({
      graph: emptyGraph(),
      verification: null,
      projectId: null,
      selectedNodeId: null,
      status: 'idle',
      error: null,
      lastUpdated: null,
      issues: [],
      blocking: false,
      repairs: [],
    });
  },

  dismissError: () => set({ error: null, status: 'idle' }),
}));

// Persist the user's work on every change — refresh-proof.
useGraphStore.subscribe((state) => {
  persistTo(GRAPH_PERSIST_KEY, {
    graph: state.graph,
    verification: state.verification,
    issues: state.issues,
    blocking: state.blocking,
    repairs: state.repairs,
    projectId: state.projectId,
    lastUpdated: state.lastUpdated,
  });
});

/** Stable selectors — keeps re-renders tight. */
export const selectNodes = (state: GraphState): ArchitectureNode[] => state.graph.nodes;
export const selectSelectedNode = (state: GraphState) =>
  state.graph.nodes.find((node) => node.id === state.selectedNodeId) ?? null;