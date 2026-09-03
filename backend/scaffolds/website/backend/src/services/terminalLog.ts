import { EventEmitter } from 'node:events';

/**
 * The feed behind the browser terminal (/terminal).
 *
 * A small in-memory ring buffer plus a live emitter: the SSE route replays
 * the tail and then streams. No dependencies, no persistence — a terminal is
 * a view of what the server is doing right now, not a record.
 */

export type TerminalLineKind = 'boot' | 'request' | 'device' | 'control' | 'error' | 'info';

export interface TerminalLine {
  /** Monotonic id — the browser resumes with ?since=<seq> after a reconnect. */
  seq: number;
  /** Clock time, HH:MM:SS. */
  at: string;
  kind: TerminalLineKind;
  text: string;
}

const CAPACITY = 500;
const buffer: TerminalLine[] = [];
let nextSeq = 1;
const emitter = new EventEmitter();
// Terminals come and go with page refreshes; a slow leak of detached viewers
// must never crash the process on a warning threshold.
emitter.setMaxListeners(0);

function clock(): string {
  return new Date().toISOString().slice(11, 19);
}

export function pushTerminalLine(kind: TerminalLineKind, text: string): TerminalLine {
  const line: TerminalLine = { seq: nextSeq, at: clock(), kind, text };
  nextSeq += 1;
  buffer.push(line);
  if (buffer.length > CAPACITY) buffer.shift();
  emitter.emit('line', line);
  return line;
}

/** Everything after `sinceSeq`, or the last 100 lines for a fresh viewer. */
export function recentTerminalLines(sinceSeq = 0): TerminalLine[] {
  if (sinceSeq <= 0) return buffer.slice(-100);
  return buffer.filter((line) => line.seq > sinceSeq);
}

/** Subscribe to live lines; returns the unsubscribe function. */
export function subscribeTerminal(listener: (line: TerminalLine) => void): () => void {
  emitter.on('line', listener);
  return () => {
    emitter.off('line', listener);
  };
}
