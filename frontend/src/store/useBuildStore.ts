import { create } from 'zustand';

import {
  agenticJobSnapshot,
  cancelAgenticJob,
  startAgenticJob,
  streamAgenticJob,
} from '../services/api';
import { clearPersisted, loadPersisted, persistTo } from '../lib/localPersist';
import { useDesignSession } from './useDesignSession';
import { useGraphStore } from './useGraphStore';
import { useDebugStore } from './useDebugStore';
import type {
  AgenticBuildResult,
  AgenticEvent,
  BuildProgress,
  ValidationReport,
  ConnectionHealth,
  StageProgress,
  ErrorContext,
} from '../types/build';

export interface TerminalLine {
  id: number;
  kind: 'stage' | 'log' | 'cmd' | 'out' | 'artifact' | 'banner';
  tone: 'info' | 'ok' | 'warn' | 'error';
  stage: string;
  text: string;
  /** For cmd lines: exit code once the result arrives. */
  exitCode?: number | null;
}

interface BuildState {
  running: boolean;
  /** Server-side job this build is running as — survives navigation + refresh. */
  jobId: string | null;
  /** Highest event sequence number seen, so a re-attach only replays the rest. */
  seq: number;
  /**
   * What the build has produced SO FAR. The website half lands here while the
   * firmware is still being written, which is what lets page 04 run the
   * generated dashboard mid-build.
   */
  progress: BuildProgress | null;
  lines: TerminalLine[];
  reports: Partial<Record<'firmware' | 'software' | 'consistency', ValidationReport>>;
  result: AgenticBuildResult | null;
  error: string | null;
  cancelled: boolean;
  abort: AbortController | null;

  // Enhanced progress tracking
  stageProgress: Map<string, StageProgress>;
  currentStage?: string;
  connectionHealth?: ConnectionHealth;
  errorContexts: ErrorContext[];
  operationTraces: Map<string, any>;

  run: (options?: { provider?: string; model?: string; revisionInstruction?: string }) => Promise<void>;
  /** Re-attach to a job this browser started before a refresh/navigation. */
  resume: () => Promise<void>;
  cancel: () => void;
  clear: () => void;
  /** Fold canvas edits (pulled from the embedded Velxio) into the artifacts. */
  applyFileUpdates: (updates: { path: string; content: string }[]) => void;
  /** Load a ready-made result (the demo project) as if a build had just run. */
  loadResult: (result: AgenticBuildResult) => void;
}

let lineId = 0;
function makeLine(partial: Omit<TerminalLine, 'id'>): TerminalLine {
  lineId += 1;
  return { id: lineId, ...partial };
}

const MAX_LINES = 600;

// Survive page refreshes: the built zips (firmware + software trees) stay
// downloadable after a reload instead of vanishing with the page state.
const BUILD_PERSIST_KEY = 'wireup.build.v1';
// And the JOB itself — the id + how far we got, so a refresh picks the same
// running build back up instead of orphaning it on the server.
const JOB_PERSIST_KEY = 'wireup.build.job.v1';

const persistedBuild = loadPersisted<{
  result: AgenticBuildResult | null;
  reports: BuildState['reports'];
  progress: BuildProgress | null;
}>(BUILD_PERSIST_KEY);

const persistedJob = loadPersisted<{ jobId: string; seq: number }>(JOB_PERSIST_KEY);

export const useBuildStore = create<BuildState>()((set, get) => {
  const push = (line: Omit<TerminalLine, 'id'>) =>
    set((state) => ({ lines: [...state.lines.slice(-MAX_LINES), makeLine(line)] }));

  const patchLastCmd = (cmd: string, exitCode: number | null) =>
    set((state) => {
      const lines = [...state.lines];
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];
        if (line.kind === 'cmd' && line.text === `$ ${cmd}` && line.exitCode === undefined) {
          lines[i] = { ...line, exitCode, tone: exitCode === 0 ? 'ok' : 'error' };
          break;
        }
      }
      return { lines };
    });

  /** Translate one streamed event into store state. */
  const handle = (event: AgenticEvent): void => {
    // Forward every event to the debug console store. This used to go through
    // `require()`, which does not exist in the browser ESM bundle — it threw and
    // the catch swallowed it, so the console never saw a single event.
    useDebugStore.getState().addEvent(event);
    
    switch (event.type) {
      case 'stage':
        set({ currentStage: event.stage });
        push({ kind: 'stage', tone: 'info', stage: event.stage, text: `▶ ${event.title}` });
        break;
      case 'stage_progress':
        set((state) => ({
          stageProgress: new Map(state.stageProgress.set(event.progress.stage, event.progress)),
          currentStage: event.progress.stage,
        }));
        break;
      case 'substep':
        // Update the substep in the current stage progress
        set((state) => {
          const currentProgress = state.stageProgress.get(event.stage);
          if (currentProgress) {
            const updatedSubsteps = currentProgress.substeps.map(s => 
              s.id === event.substep.id ? event.substep : s
            );
            const updatedProgress = { ...currentProgress, substeps: updatedSubsteps };
            return {
              stageProgress: new Map(state.stageProgress.set(event.stage, updatedProgress))
            };
          }
          return state;
        });
        break;
      case 'heartbeat':
        set({ connectionHealth: event.health });
        break;
      case 'operation_start':
        push({ 
          kind: 'log', 
          tone: 'info', 
          stage: event.stage, 
          text: `🚀 Starting ${event.operation}` 
        });
        break;
      case 'operation_step':
        push({ 
          kind: 'log', 
          tone: event.status === 'failed' ? 'error' : 'info', 
          stage: event.stage, 
          text: `${event.status === 'completed' ? '✅' : event.status === 'failed' ? '❌' : '📋'} ${event.stepName}` 
        });
        break;
      case 'operation_complete':
        push({ 
          kind: 'log', 
          tone: event.status === 'failed' ? 'error' : 'ok', 
          stage: event.stage, 
          text: `${event.status === 'failed' ? '💥' : '🎉'} Operation ${event.status} (${event.duration}ms)` 
        });
        break;
      case 'error_context':
        set((state) => ({
          errorContexts: [...state.errorContexts, event.context].slice(-50) // Keep last 50 errors
        }));
        const errorIcon = event.context.severity === 'error' ? '🚨' : '⚠️';
        push({ 
          kind: 'log', 
          tone: event.context.severity === 'error' ? 'error' : 'warn', 
          stage: event.stage, 
          text: `${errorIcon} ${event.context.code || 'ERROR'}: ${event.context.message}` 
        });
        if (event.context.suggestion) {
          push({ 
            kind: 'log', 
            tone: 'info', 
            stage: event.stage, 
            text: `💡 ${event.context.suggestion}` 
          });
        }
        break;
      case 'log':
        push({ kind: 'log', tone: event.tone ?? 'info', stage: event.stage, text: event.line });
        break;
      case 'command':
        push({ kind: 'cmd', tone: 'info', stage: event.stage, text: `$ ${event.cmd}` });
        break;
      case 'command_result': {
        patchLastCmd(event.cmd, event.exitCode);
        if (event.output) {
          push({
            kind: 'out',
            tone: event.exitCode === 0 ? 'ok' : 'warn',
            stage: event.stage,
            text: event.output.slice(0, 1800),
          });
        }
        break;
      }
      case 'validation':
        set((state) => ({
          reports: {
            ...state.reports,
            [event.report.target]: event.report,
          },
        }));
        break;
      case 'artifact':
        push({ kind: 'artifact', tone: 'ok', stage: event.stage, text: `◈ ${event.summary}` });
        break;
      case 'progress':
        // The website half going live mid-build is the headline: page 04 reads
        // this straight out of the store and iframes the real bundle.
        set({ progress: event.progress });
        if (event.progress.website?.ready && event.progress.website.preview) {
          push({
            kind: 'banner',
            tone: 'ok',
            stage: 'software',
            text: `website is LIVE at ${event.progress.website.preview.url} — open page 04 and use it while the firmware is written`,
          });
        }
        if (event.progress.firmware?.ready) {
          push({
            kind: 'banner',
            tone: 'ok',
            stage: 'firmware',
            text: `firmware is ready (${event.progress.firmware.board}) — simulation bench unlocked on page 04`,
          });
        }
        break;
      case 'result':
        set({ result: event.result });
        push({ kind: 'banner', tone: 'ok', stage: 'done', text: 'build succeeded — artifacts below, two zips ready' });
        break;
      case 'cancelled':
        set({ cancelled: true, error: null });
        push({ kind: 'banner', tone: 'warn', stage: 'cancelled', text: event.message });
        break;
      case 'error':
        set({ error: event.message });
        push({ kind: 'banner', tone: 'error', stage: 'error', text: `build failed: ${event.message}` });
        break;
    }
  };

  /**
   * Attach to a job and consume its stream until it settles. Used both for a
   * freshly started build and for one picked back up after a refresh.
   */
  const attach = async (jobId: string, fromSeq: number): Promise<void> => {
    const abort = new AbortController();
    set({ running: true, jobId, seq: fromSeq, abort, error: null, cancelled: false });

    try {
      await streamAgenticJob(
        jobId,
        (event) => {
          handle(event);
          set((state) => ({ seq: state.seq + 1 }));
        },
        abort.signal,
        fromSeq,
      );
    } catch (error) {
      if (!abort.signal.aborted) {
        const message = error instanceof Error ? error.message : 'Lost the build stream.';
        set({ error: message });
        push({ kind: 'banner', tone: 'error', stage: 'error', text: message });
      }
    } finally {
      // The stream closes when the job settles. Ask the server what the final
      // verdict was — the browser may have been away for the last events.
      const snapshot = await agenticJobSnapshot(jobId).catch(() => null);
      if (snapshot) {
        if (snapshot.progress) set({ progress: snapshot.progress });
        if (snapshot.result) set({ result: snapshot.result });
        if (snapshot.status === 'cancelled') set({ cancelled: true });
        else if (snapshot.status === 'error' && snapshot.error && !get().result) {
          set({ error: snapshot.error });
        }
        set({ seq: snapshot.seq });
        persistTo(JOB_PERSIST_KEY, { jobId, seq: snapshot.seq });
      }
      set({ running: false, abort: null });
    }
  };

  return {
    running: false,
    jobId: persistedJob?.jobId ?? null,
    seq: persistedJob?.seq ?? 0,
    progress: persistedBuild?.progress ?? null,
    lines: [],
    reports: persistedBuild?.reports ?? {},
    result: persistedBuild?.result ?? null,
    error: null,
    cancelled: false,
    abort: null,

    // Enhanced progress tracking
    stageProgress: new Map<string, StageProgress>(),
    currentStage: undefined,
    connectionHealth: undefined,
    errorContexts: [],
    operationTraces: new Map(),

    run: async (options?: { provider?: string; model?: string; revisionInstruction?: string }) => {
      const { graph } = useGraphStore.getState();
      const { brief: rawBrief, llmOptions, answers, specGraph } = useDesignSession.getState();
      const brief = rawBrief.trim();
      if (!brief) {
        set({ error: 'Write the prompt on page 01 first.' });
        return;
      }
      if (get().running) {
        set({ error: 'A build is already running — wait for it, or cancel it first.' });
        return;
      }
      // Page-01's "how often should the device sample?" answer must reach the
      // build — without it the firmware silently falls back to the KB default.
      const intervalAnswer = Number(answers['sample-interval']);

      set({
        running: true,
        jobId: null,
        seq: 0,
        progress: null,
        result: null,
        error: null,
        cancelled: false,
        reports: {},
        lines: [
          makeLine({
            kind: 'banner',
            tone: 'info',
            stage: 'wireup',
            text: `wireup agentic build — "${brief.slice(0, 110)}${brief.length > 110 ? '…' : ''}"`,
          }),
          makeLine({
            kind: 'banner',
            tone: 'info',
            stage: 'wireup',
            text: 'website first, firmware second — you can open page 04 and use the dashboard while the firmware is still being written',
          }),
        ],
      });

      try {
        const started = await startAgenticJob({
          brief,
          projectName: graph.project,
          graph,
          // §7: the validated spec graph rides along; the backend's stage-0
          // gate refuses to build from a graph that is not fully validated.
          specGraph: specGraph ?? undefined,
          provider: options?.provider ?? llmOptions.provider,
          model: options?.model ?? llmOptions.model,
          revisionInstruction: options?.revisionInstruction,
          sampleIntervalMs:
            Number.isFinite(intervalAnswer) && intervalAnswer > 0 ? intervalAnswer : undefined,
        });
        persistTo(JOB_PERSIST_KEY, { jobId: started.jobId, seq: 0 });
        push({
          kind: 'log',
          tone: 'info',
          stage: 'job',
          text: `build job ${started.jobId} started on the server — it keeps running if you leave this page`,
        });
        await attach(started.jobId, 0);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not start the build.';
        set({ error: message, running: false, abort: null });
        push({ kind: 'banner', tone: 'error', stage: 'error', text: message });
      }
    },

    resume: async () => {
      const { jobId, running } = get();
      if (!jobId || running) return;
      const snapshot = await agenticJobSnapshot(jobId).catch(() => null);
      // No such job any more (server restarted, or it aged out) — forget it.
      if (!snapshot) {
        clearPersisted(JOB_PERSIST_KEY);
        set({ jobId: null, seq: 0 });
        return;
      }
      if (snapshot.status !== 'running') {
        // Finished while this tab was closed: take the outcome, stop tracking.
        if (snapshot.progress) set({ progress: snapshot.progress });
        if (snapshot.result) set({ result: snapshot.result });
        set({ jobId: snapshot.id, seq: snapshot.seq, cancelled: snapshot.status === 'cancelled' });
        return;
      }
      push({
        kind: 'banner',
        tone: 'info',
        stage: 'job',
        text: `re-attached to build job ${jobId} — still running on the server`,
      });
      await attach(jobId, get().seq);
    },

    cancel: () => {
      const { jobId, abort } = get();
      abort?.abort();
      if (jobId) void cancelAgenticJob(jobId);
      set({ running: false, abort: null, cancelled: true });
      push({ kind: 'banner', tone: 'warn', stage: 'cancelled', text: 'cancel requested — the server stops the build at the next stage boundary' });
    },

    clear: () => {
      clearPersisted(BUILD_PERSIST_KEY);
      clearPersisted(JOB_PERSIST_KEY);
      set({ 
        lines: [], 
        reports: {}, 
        result: null, 
        progress: null, 
        error: null, 
        jobId: null, 
        seq: 0, 
        cancelled: false,
        stageProgress: new Map(),
        currentStage: undefined,
        connectionHealth: undefined,
        errorContexts: [],
        operationTraces: new Map()
      });
    },

    applyFileUpdates: (updates) => {
      const { result } = get();
      if (!result || updates.length === 0) return;
      const byPath = new Map(updates.map((update) => [update.path, update.content]));
      const files = result.firmware.files.map((file) =>
        byPath.has(file.path) ? { ...file, content: byPath.get(file.path)! } : file,
      );
      // The subscriber below persists this — canvas edits survive a refresh
      // exactly like the original build result does.
      set({ result: { ...result, firmware: { ...result.firmware, files } } });
    },

    loadResult: (result) => {
      // Same shape a real build produces, so every downstream page (03, 04,
      // downloads, Velxio push) works unchanged. The persistence subscriber
      // makes it refresh-proof, exactly like a real result.
      set({ result, error: null, reports: {} });
    },
  };
});

// Persist the shipped artifacts on every change — refresh-proof.
useBuildStore.subscribe((state) => {
  if (state.result || Object.keys(state.reports).length > 0 || state.progress) {
    persistTo(BUILD_PERSIST_KEY, {
      result: state.result,
      reports: state.reports,
      progress: state.progress,
    });
  }
});
