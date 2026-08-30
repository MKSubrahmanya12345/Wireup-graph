import { create } from 'zustand';

import { streamAgenticBuild } from '../services/api';
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

  run: () => Promise<void>;
  cancel: () => void;
  clear: () => void;
}

let lineId = 0;
function makeLine(partial: Omit<TerminalLine, 'id'>): TerminalLine {
  lineId += 1;
  return { id: lineId, ...partial };
}

const MAX_LINES = 600;

export const useBuildStore = create<BuildState>()((set, get) => ({
  running: false,
  lines: [],
  reports: {},
  result: null,
  error: null,
  abort: null,

  run: async () => {
    const { graph } = useGraphStore.getState();
    const brief = useDesignSession.getState().brief.trim();
    if (!brief) {
      set({ error: 'Write the prompt on page 01 first.' });
      return;
    }

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
        { brief, projectName: graph.project, graph },
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

  clear: () => set({ lines: [], reports: {}, result: null, error: null }),
}));
