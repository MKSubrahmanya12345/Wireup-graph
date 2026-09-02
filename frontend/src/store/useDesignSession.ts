import { create } from 'zustand';

import { api, streamInterpretation } from '../services/api';
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
import type {
  ProgressStep,
  SpecGraphProject,
  SpecNode,
  SpecNodeQuestion,
} from '../types/specGraph';
import type { LlmOptions } from '../types/llm';

/**
 * Hard ceiling on pass 0.
 *
 * The backend bounds its own LLM call, but the network between the two is not
 * ours to guarantee. Whatever happens, the human gets an error they can act on
 * within this many seconds — never a button that spins forever.
 */
const INTERPRET_TIMEOUT_MS = 60_000;

/** Marks a deliberate cancel so it is never mistaken for a failure. */
const CANCELLED = Symbol('wireup.interpret.cancelled');

let interpretController: AbortController | null = null;

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
  /** Issue ids the human has consciously accepted. */
  acceptedRisks: string[];

  error: string | null;

  /**
   * Live pass-0 state. These are what make the page feel alive: the engine's
   * progress trail, the spec-graph nodes as they are spawned, the questions as
   * they survive the gate, and any warnings (e.g. "model unreachable").
   */
  progress: ProgressStep[];
  liveNodes: SpecNode[];
  liveQuestions: SpecNodeQuestion[];
  specGraph: SpecGraphProject | null;
  warnings: string[];

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
  /** Abort an in-flight interpretation (the button becomes Cancel while busy). */
  cancelInterpretation: () => void;
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

  /** Shared pass-0 runner — streams, so the graph draws as it is built. */
  interpretStream: (payload: {
    brief: string;
    answers?: Record<string, string>;
    priorRequirements?: RequirementsSpec;
    priorQuestions?: Question[];
    feedback?: string[];
    graph?: unknown;
    provider?: string;
    model?: string;
  }) => Promise<InterpretResponse>;
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
  acceptedRisks: [],
  error: null,

  progress: [],
  liveNodes: [],
  liveQuestions: [],
  specGraph: null,
  warnings: [],

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
    interpretController?.abort();
    interpretController = null;
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
      progress: [],
      liveNodes: [],
      liveQuestions: [],
      specGraph: null,
      warnings: [],
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
      progress: [],
      liveNodes: [],
      liveQuestions: [],
      specGraph: null,
      warnings: [],
      localProjectId: detail.id,
      autoStart: false,
    });
  },

  clearAutoStart: () => set({ autoStart: false }),

  cancelInterpretation: () => {
    interpretController?.abort();
    interpretController = null;
    set({ stage: 'idle', error: null, progress: [] });
  },

  /**
   * Run pass 0 over the stream.
   *
   * Every `stage`, `node`, `question` and `warn` event is pushed into the
   * store as it arrives, which is what lets the page render the spec graph
   * while it is still being built instead of blocking on one atomic POST.
   */
  interpretStream: async (payload) => {
    // Two clicks must never race — cancel anything still in flight.
    interpretController?.abort();
    const controller = new AbortController();
    interpretController = controller;

    let timedOut = false;
    const guard = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, INTERPRET_TIMEOUT_MS);

    set({
      stage: 'interpreting',
      error: null,
      progress: [],
      liveNodes: [],
      liveQuestions: [],
      specGraph: null,
      warnings: [],
    });

    let done: InterpretResponse | null = null;

    try {
      await streamInterpretation(
        payload,
        (event) => {
          switch (event.type) {
            case 'stage':
              set((state) => ({
                progress: [
                  ...state.progress,
                  { stage: event.stage, title: event.title, detail: event.detail, at: Date.now() },
                ],
              }));
              break;

            case 'node':
              // A node the engine already emitted can be re-emitted when its
              // `produces` edges are back-filled — replace, never duplicate.
              set((state) => ({
                liveNodes: state.liveNodes.some((n) => n.id === event.node.id)
                  ? state.liveNodes.map((n) => (n.id === event.node.id ? event.node : n))
                  : [...state.liveNodes, event.node],
              }));
              break;

            case 'question':
              set((state) => ({
                liveQuestions: state.liveQuestions.some((q) => q.id === event.question.id)
                  ? state.liveQuestions
                  : [...state.liveQuestions, event.question],
              }));
              break;

            case 'assumption':
              // Already carried on the node itself; nothing extra to store.
              break;

            case 'refined':
              set((state) => ({
                progress: [
                  ...state.progress,
                  {
                    stage: 'refined',
                    title: 'Model revised the question set',
                    detail: `${event.questions.length} question(s) after re-reading the brief.`,
                    at: Date.now(),
                  },
                ],
              }));
              break;

            case 'warn':
              set((state) => ({ warnings: [...state.warnings, event.message] }));
              break;

            case 'done': {
              done = {
                requirements: event.requirements,
                questions: event.questions ?? [],
                assumptions: event.assumptions ?? [],
                ready: Boolean(event.ready),
                specGraph: event.specGraph,
              };
              // Nodes are streamed as they are spawned, i.e. before the
              // validation pass has run. Swap in the validated copies so a node
              // that is waiting on an answer says so instead of claiming to be
              // decided.
              const validated = event.specGraph?.nodes;
              if (validated) {
                set((state) => ({
                  liveNodes: Object.values(validated).length
                    ? Object.values(validated)
                    : state.liveNodes,
                }));
              }
              break;
            }

            case 'error':
              throw new Error(event.error);
          }
        },
        controller.signal,
      );
    } catch (error) {
      if (done) {
        // A transport hiccup AFTER `done` is not a failure — we have the result.
      } else {
        const aborted = (error as Error)?.name === 'AbortError';
        if (aborted && !timedOut) throw CANCELLED;
        const message = timedOut
          ? `The engine took longer than ${Math.round(INTERPRET_TIMEOUT_MS / 1000)}s to answer. Nothing was lost — check that the backend is running and try again.`
          : (error as Error)?.message || 'Could not interpret the brief.';
        throw new Error(message);
      }
    } finally {
      clearTimeout(guard);
      if (interpretController === controller) interpretController = null;
    }

    if (!done) throw new Error('The engine finished without returning a result.');
    return done;
  },

  startInterpretation: async (options?: LlmOptions) => {
    const { brief, revision, answers, questions, requirements, feedback } = get();
    if (!brief.trim()) {
      set({ error: 'Describe what you want to build first.' });
      return;
    }

    try {
      const isReanalyze = revision > 0;
      // Re-analyze is a CONTINUATION, not a cold start: send the same payload
      // shape submitAnswers() builds so the backend sees prior state.
      const result = await get().interpretStream({
        brief: brief.trim(),
        answers: isReanalyze ? answers : {},
        priorRequirements: isReanalyze ? (requirements ?? undefined) : undefined,
        priorQuestions: isReanalyze ? questions : [],
        feedback: isReanalyze ? feedback : [],
        graph: isReanalyze ? useGraphStore.getState().graph : undefined,
        provider: options?.provider ?? get().llmOptions.provider,
        model: options?.model ?? get().llmOptions.model,
      });

      set({
        requirements: result.requirements,
        questions: result.questions,
        assumptions: result.assumptions,
        specGraph: result.specGraph ?? null,
        // Pre-fill every answer with the AI's recommendation so the human can
        // accept the whole form in one click.
        answers: Object.fromEntries(result.questions.map((q) => [q.id, q.default])),
        stage: result.questions.length > 0 && !result.ready ? 'questioning' : 'planning',
      });

      if (get().stage === 'planning') await get().runPlan();
    } catch (error) {
      if (error === CANCELLED) return;
      set({
        stage: 'idle',
        error: error instanceof Error ? error.message : 'Could not interpret the brief.',
      });
    }
  },

  submitAnswers: async () => {
    const { brief, answers, questions, requirements, feedback } = get();
    try {
      const result = await get().interpretStream({
        brief: brief.trim(),
        answers,
        priorRequirements: requirements ?? undefined,
        priorQuestions: questions,
        feedback,
        graph: useGraphStore.getState().graph,
      });

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
        specGraph: result.specGraph ?? null,
        answers: Object.fromEntries(result.questions.map((q) => [q.id, q.default])),
      });

      await get().runPlan();
    } catch (error) {
      if (error === CANCELLED) return;
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
      progress: [],
      liveNodes: [],
      liveQuestions: [],
      specGraph: null,
      warnings: [],
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
  });
});
