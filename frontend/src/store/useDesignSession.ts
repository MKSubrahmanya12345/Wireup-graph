import { create } from 'zustand';

import { api } from '../services/api';
import { useGraphStore } from './useGraphStore';
import type {
  InterpretResponse,
  Question,
  RequirementsSpec,
  Stage,
} from '../types/session';

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

  setBrief: (brief: string) => void;
  setAnswer: (id: string, value: string) => void;
  acceptRisk: (id: string) => void;

  /** Stage 1 — ask the AI to decide everything it can. */
  startInterpretation: () => Promise<void>;
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

export const useDesignSession = create<SessionState>()((set, get) => ({
  stage: 'idle',
  brief: STARTER_BRIEF,
  questions: [],
  answers: {},
  requirements: null,
  assumptions: [],
  feedback: [],
  revision: 0,
  acceptedRisks: [],
  error: null,

  setBrief: (brief) => set({ brief }),

  setAnswer: (id, value) =>
    set((state) => ({ answers: { ...state.answers, [id]: value } })),

  acceptRisk: (id) =>
    set((state) =>
      state.acceptedRisks.includes(id)
        ? state
        : { acceptedRisks: [...state.acceptedRisks, id] },
    ),

  startInterpretation: async () => {
    const { brief } = get();
    if (!brief.trim()) {
      set({ error: 'Describe what you want to build first.' });
      return;
    }

    set({ stage: 'interpreting', error: null });
    try {
      const result = (await api.interpretBrief({
        brief: brief.trim(),
        answers: {},
        priorQuestions: [],
        feedback: [],
      })) as InterpretResponse;

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
    const { brief, requirements, feedback } = get();
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
    });
  },
}));