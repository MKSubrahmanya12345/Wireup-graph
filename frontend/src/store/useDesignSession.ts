import { create } from 'zustand';

import { api } from '../services/api';
import { clearPersisted, loadPersisted, persistTo } from '../lib/localPersist';
import { useGraphStore } from './useGraphStore';
import { useProjectsStore } from './useProjectsStore';
import type { ProjectDetail } from '../types/architecture';
import type {
  InterpretResponse,
  Question,
  RequirementsSpec,
  Stage,
} from '../types/session';
import type { LlmOptions } from '../types/llm';

interface SessionState {
  stage: Stage;

  brief: string;
  questions: Question[];
  answers: Record<string, string>;
  requirements: RequirementsSpec | null;
  assumptions: string[];

  /** Human corrections across revisions, oldest first. */
  feedback: string[];
  revision: number;
  // ??$$$ Spec graph state persistence
  specGraph: any | null;
  setSpecGraph: (specGraph: any) => void;
  /** Issue ids the human has consciously accepted. */
  acceptedRisks: string[];

  error: string | null;

  /** Selected LLM options for this session */
  llmOptions: LlmOptions;
  setLlmOptions: (options: LlmOptions) => void;

  /**
   * One design session == one project. Set by beginProject/hydrateProject so
   * every plan of this session files into the SAME project (local-mode key
   * when there is no Mongo id — see useProjectsStore.recordPlan).
   */
  localProjectId: string | null;
  /** True for one tick: page 01 should kick off interpretation on mount. */
  autoStart: boolean;

  setBrief: (brief: string) => void;
  setAnswer: (id: string, value: string) => void;
  acceptRisk: (id: string) => void;

  /** Homepage prompt box: wipe the bench, start a brand-new project. */
  beginProject: (brief: string) => void;
  /** Open a saved project: hydrate graph + brief into the live stores. */
  hydrateProject: (detail: ProjectDetail) => void;
  clearAutoStart: () => void;

  /** Stage 1 — ask the AI to decide everything it can. */
  startInterpretation: (options?: LlmOptions) => Promise<void>;
  /** Stage 2 — send answers, re-interpret, then plan. */
  submitAnswers: () => Promise<void>;
  /** Skip the questions entirely and let the AI's defaults stand. */
  skipQuestions: () => Promise<void>;
  /** Stage 3 — build the graph. */
  runPlan: () => Promise<void>;
  /** Stage 4a — the human is happy. */
  accept: () => void;
  /** Stage 4b — the human explains what is wrong, and we go round again. */
  revise: (note: string) => Promise<void>;

  reset: () => void;
}

const STARTER_BRIEF = '';

// Survive page refreshes: brief, questions and requirements persist locally
// so a reload never sends the user back to a blank page 01.
const SESSION_PERSIST_KEY = 'wireup.session.v1';
const persistedSession = loadPersisted<{
  brief: string;
  questions: Question[];
  answers: Record<string, string>;
  requirements: RequirementsSpec | null;
  assumptions: string[];
  revision: number;
  // ??$$$ Persisted spec graph
  specGraph?: any | null;
}>(SESSION_PERSIST_KEY);

export const useDesignSession = create<SessionState>()((set, get) => ({
  stage: 'idle',
  brief: persistedSession?.brief ?? STARTER_BRIEF,
  questions: persistedSession?.questions ?? [],
  answers: persistedSession?.answers ?? {},
  requirements: persistedSession?.requirements ?? null,
  assumptions: persistedSession?.assumptions ?? [],
  feedback: [],
  revision: persistedSession?.revision ?? 0,
  // ??$$$ SpecGraph store state
  specGraph: persistedSession?.specGraph ?? null,
  setSpecGraph: (specGraph) => set({ specGraph }),
  acceptedRisks: [],
  error: null,
  llmOptions: {},
  setLlmOptions: (options) => set({ llmOptions: options }),

  localProjectId: null,
  autoStart: false,

  setBrief: (brief) => set({ brief }),

  setAnswer: (id, value) =>
    set((state) => ({ answers: { ...state.answers, [id]: value } })),

  acceptRisk: (id) =>
    set((state) =>
      state.acceptedRisks.includes(id)
        ? state
        : { acceptedRisks: [...state.acceptedRisks, id] },
    ),

  beginProject: (brief) => {
    const trimmed = brief.trim();
    if (!trimmed) {
      set({ error: 'Describe what you want to build first.' });
      return;
    }
    // A new prompt from the homepage is a NEW project: clear the previous
    // design off the bench so nothing from the old session leaks into it.
    useGraphStore.getState().reset();
    set({
      stage: 'idle',
      brief: trimmed,
      questions: [],
      answers: {},
      requirements: null,
      assumptions: [],
      feedback: [],
      revision: 0,
      acceptedRisks: [],
      error: null,
      localProjectId: `local:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      autoStart: true,
    });
  },

  hydrateProject: (detail) => {
    // Bring a saved project back onto the bench. The graph store carries the
    // canonical copy; this store carries the brief that produced it.
    const brief =
      detail.revisions?.[detail.revisions.length - 1]?.request ?? detail.summary ?? '';
    useGraphStore.setState({
      graph: detail.graph,
      verification: detail.verification,
      projectId: detail.id.startsWith('local:') ? null : detail.id,
      selectedNodeId: detail.graph.nodes[0]?.id ?? null,
      status: 'idle',
      error: null,
      lastUpdated: new Date().toISOString(),
      issues: [],
      blocking: false,
      repairs: [],
    });
    set({
      stage: detail.graph.nodes.length > 0 ? 'reviewing' : 'idle',
      brief,
      questions: [],
      answers: {},
      requirements: null,
      assumptions: [],
      feedback: [],
      revision: detail.graph.nodes.length > 0 ? 1 : 0,
      acceptedRisks: [],
      error: null,
      localProjectId: detail.id,
      autoStart: false,
    });
  },

  clearAutoStart: () => set({ autoStart: false }),

  startInterpretation: async (options?: LlmOptions) => {
    const { brief, revision, answers, questions, requirements, feedback } = get();
    if (!brief.trim()) {
      set({ error: 'Describe what you want to build first.' });
      return;
    }

    set({ stage: 'interpreting', error: null });
    try {
      const isReanalyze = revision > 0;
      // Re-analyze is a CONTINUATION, not a cold start: send the same payload
      // shape submitAnswers() builds so the backend sees prior state and its
      // single-round guarantee kicks in. Only the very first analyze of a
      // session sends truly-empty state.
      const payload = {
        brief: brief.trim(),
        answers: isReanalyze ? answers : {},
        priorRequirements: isReanalyze ? (requirements ?? undefined) : undefined,
        priorQuestions: isReanalyze ? questions : [],
        feedback: isReanalyze ? feedback : [],
        graph: isReanalyze ? useGraphStore.getState().graph : undefined,
        provider: options?.provider ?? get().llmOptions.provider,
        model: options?.model ?? get().llmOptions.model,
      };
      const result = (await api.interpretBrief(payload)) as InterpretResponse;

      set({
        requirements: result.requirements,
        questions: result.questions,
        assumptions: result.assumptions,
        // Pre-fill every answer with the AI's recommendation so the human can
        // accept the whole form in one click.
        answers: Object.fromEntries(result.questions.map((q) => [q.id, q.default])),
        stage: result.questions.length > 0 && !result.ready ? 'questioning' : 'planning',
      });

      if (get().stage === 'planning') await get().runPlan();
    } catch (error) {
      set({
        stage: 'idle',
        error: error instanceof Error ? error.message : 'Could not interpret the brief.',
      });
    }
  },

  submitAnswers: async () => {
    const { brief, answers, questions, requirements, feedback } = get();
    set({ stage: 'interpreting', error: null });
    try {
      const result = (await api.interpretBrief({
        brief: brief.trim(),
        answers,
        priorRequirements: requirements ?? undefined,
        priorQuestions: questions,
        feedback,
        graph: useGraphStore.getState().graph,
      })) as InterpretResponse;

      // The backend guarantees a second-pass /interpret never returns
      // questions. If one shows up here, a prompt/server regression slipped
      // through — be loud about it in dev instead of silently dropping it.
      if (import.meta.env.DEV && result.questions && result.questions.length > 0) {
        console.warn(
          '[useDesignSession] Backend returned questions on a second pass — the single-round guarantee regressed:',
          result.questions,
        );
      }

      set({
        requirements: result.requirements,
        questions: result.questions,
        assumptions: result.assumptions,
        answers: Object.fromEntries(result.questions.map((q) => [q.id, q.default])),
      });

      await get().runPlan();
    } catch (error) {
      set({
        stage: 'questioning',
        error: error instanceof Error ? error.message : 'Could not apply those answers.',
      });
    }
  },

  skipQuestions: async () => {
    // Keep the AI's defaults for anything unanswered and move on.
    const { questions, answers } = get();
    const filled = { ...answers };
    for (const question of questions) {
      if (!filled[question.id]) filled[question.id] = question.default;
    }
    set({ answers: filled });
    await get().runPlan();
  },

  runPlan: async () => {
    const { brief, requirements, feedback, llmOptions } = get();
    const graphStore = useGraphStore.getState();

    set({ stage: 'planning', error: null });
    graphStore.setStatus('planning');
    graphStore.dismissError();

    try {
      const response = await api.planArchitecture({
        request: brief.trim(),
        graph: graphStore.graph,
        projectId: graphStore.projectId,
        requirements,
        feedback,
        provider: llmOptions.provider,
        model: llmOptions.model,
      });

      // Strip every envelope field so only the canonical graph is stored —
      // anything left here gets POSTed back to the planner next turn.
      const {
        verification = null,
        issues = [],
        blocking = false,
        repairs = [],
        projectId: returnedId = null,
        revisionId: _revisionId,
        ...nextGraph
      } = response;

      useGraphStore.setState((state) => ({
        graph: nextGraph,
        verification,
        issues,
        blocking,
        repairs,
        projectId: returnedId ?? state.projectId,
        selectedNodeId: nextGraph.nodes[0]?.id ?? null,
        status: 'idle',
        error: null,
        lastUpdated: new Date().toISOString(),
      }));

      // File this draft into the projects list (server id when the API
      // persists, the session's local key otherwise) so the homepage shows
      // every project, not just the last one touched.
      const prevKey = get().localProjectId;
      const filedId = useProjectsStore.getState().recordPlan({
        key: prevKey,
        projectId: returnedId,
        name: nextGraph.project,
        summary: nextGraph.summary,
        brief: brief.trim(),
        graph: nextGraph,
        verification,
      });
      if (returnedId) {
        // This project now lives on the server — retire its local-mode key.
        if (prevKey && prevKey.startsWith('local:')) {
          useProjectsStore.getState().forgetLocal(prevKey);
        }
        set({ localProjectId: returnedId });
      } else {
        set({ localProjectId: filedId });
      }

      set((state) => ({
        stage: 'reviewing',
        revision: state.revision + 1,
        // A new draft invalidates previous risk acceptances.
        acceptedRisks: [],
        error: null,
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not generate the architecture.';
      useGraphStore.setState({ status: 'error', error: message });
      set({ stage: 'reviewing', error: message });
    }
  },

  accept: () => set({ stage: 'accepted', error: null }),

  revise: async (note) => {
    const trimmed = note.trim();
    if (!trimmed) {
      set({ error: 'Say what is wrong before revising.' });
      return;
    }
    set((state) => ({ feedback: [...state.feedback, trimmed] }));
    await get().runPlan();
  },

  reset: () => {
    clearPersisted(SESSION_PERSIST_KEY);
    useGraphStore.getState().reset();
    set({
      stage: 'idle',
      questions: [],
      answers: {},
      requirements: null,
      assumptions: [],
      feedback: [],
      revision: 0,
      acceptedRisks: [],
      error: null,
      localProjectId: null,
      autoStart: false,
    });
  },
}));

// Persist on every change — refresh-proof.
useDesignSession.subscribe((state) => {
  persistTo(SESSION_PERSIST_KEY, {
    brief: state.brief,
    questions: state.questions,
    answers: state.answers,
    requirements: state.requirements,
    assumptions: state.assumptions,
    revision: state.revision,
    // ??$$$ Persist spec graph state across sessions
    specGraph: state.specGraph,
  });
});