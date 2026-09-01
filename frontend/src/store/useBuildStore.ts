import { create } from 'zustand';

import { streamAgenticBuild } from '../services/api';
import { clearPersisted, loadPersisted, persistTo } from '../lib/localPersist';
import { useDesignSession } from './useDesignSession';
import { useGraphStore } from './useGraphStore';
import type { AgenticBuildResult, AgenticEvent, ValidationReport } from '../types/build';

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
  lines: TerminalLine[];
  reports: Partial<Record<'firmware' | 'software' | 'consistency', ValidationReport>>;
  result: AgenticBuildResult | null;
  error: string | null;
  abort: AbortController | null;

  run: (options?: { provider?: string; model?: string }) => Promise<void>;
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
const persistedBuild = loadPersisted<{
  result: AgenticBuildResult | null;
  reports: BuildState['reports'];
}>(BUILD_PERSIST_KEY);

export const useBuildStore = create<BuildState>()((set, get) => ({
  running: false,
  lines: [],
  reports: persistedBuild?.reports ?? {},
  result: persistedBuild?.result ?? null,
  error: null,
  abort: null,

  run: async (options?: { provider?: string; model?: string }) => {
    const { graph } = useGraphStore.getState();
    const { brief: rawBrief, llmOptions, answers } = useDesignSession.getState();
    const brief = rawBrief.trim();
    if (!brief) {
      set({ error: 'Write the prompt on page 01 first.' });
      return;
    }
    // Page-01's "how often should the device sample?" answer must reach the
    // build — without it the firmware silently falls back to the KB default.
    const intervalAnswer = Number(answers['sample-interval']);

    const abort = new AbortController();
    set({
      running: true,
      abort,
      result: null,
      error: null,
      reports: {},
      lines: [
        makeLine({
          kind: 'banner',
          tone: 'info',
          stage: 'wireup',
          text: `wireup agentic build — "${brief.slice(0, 110)}${brief.length > 110 ? '…' : ''}"`,
        }),
      ],
    });

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

    const handle = (event: AgenticEvent): void => {
      switch (event.type) {
        case 'stage':
          push({ kind: 'stage', tone: 'info', stage: event.stage, text: `▶ ${event.title}` });
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
        case 'result':
          set({ result: event.result });
          push({ kind: 'banner', tone: 'ok', stage: 'done', text: 'build succeeded — artifacts below, two zips ready' });
          break;
        case 'error':
          set({ error: event.message });
          push({ kind: 'banner', tone: 'error', stage: 'error', text: `build failed: ${event.message}` });
          break;
      }
    };

    try {
      await streamAgenticBuild(
        { 
          brief, 
          projectName: graph.project, 
          graph,
          provider: options?.provider ?? llmOptions.provider,
          model: options?.model ?? llmOptions.model,
          sampleIntervalMs:
            Number.isFinite(intervalAnswer) && intervalAnswer > 0 ? intervalAnswer : undefined,
        },
        handle,
        abort.signal,
      );
    } catch (error) {
      if (!abort.signal.aborted) {
        const message = error instanceof Error ? error.message : 'Build failed.';
        set({ error: message });
        push({ kind: 'banner', tone: 'error', stage: 'error', text: message });
      }
    } finally {
      set({ running: false, abort: null });
    }
  },

  cancel: () => {
    get().abort?.abort();
    set({ running: false, abort: null });
  },

  clear: () => {
    clearPersisted(BUILD_PERSIST_KEY);
    set({ lines: [], reports: {}, result: null, error: null });
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
}));

// Persist the shipped artifacts on every change — refresh-proof.
useBuildStore.subscribe((state) => {
  if (state.result || Object.keys(state.reports).length > 0) {
    persistTo(BUILD_PERSIST_KEY, { result: state.result, reports: state.reports });
  }
});
