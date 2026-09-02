/**
 * Server-side agentic build jobs.
 *
 * A build takes minutes. Tying it to one HTTP request meant the moment the
 * human opened another page — or their laptop slept, or they hit refresh —
 * the stream died and the work with it, so the simulator page could not be
 * used while the firmware was still being written.
 *
 * So the build now runs as a job on the server:
 *
 *   POST /api/build/agentic/jobs            → starts it, returns { jobId }
 *   GET  /api/build/agentic/jobs/:id/stream → replays every event from a
 *                                             sequence number, then live-tails
 *   GET  /api/build/agentic/jobs/:id        → snapshot (status + progress + result)
 *   POST /api/build/agentic/jobs/:id/cancel → stops it between stages
 *
 * Any number of browser tabs can attach and detach to the same job; the events
 * are kept in a bounded buffer so a tab that arrives late (or comes back after
 * a refresh) replays what it missed instead of seeing an empty terminal.
 *
 * In-memory on purpose: a job is a build in flight, not a record. The finished
 * artifacts still travel in the `result` event and are persisted by the
 * browser, exactly as before.
 */

import { randomBytes } from 'node:crypto';

import { logger } from '../config/logger.js';
import { runAgenticPipeline } from './pipeline.js';
import type { AgenticBuildResult, BuildEvent, BuildProgress, PipelineInput } from './types.js';

export type JobStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface BuildJobSnapshot {
  id: string;
  status: JobStatus;
  brief: string;
  projectName: string;
  startedAt: string;
  finishedAt: string | null;
  /** Highest event sequence number — clients re-attach with `?from=<seq>`. */
  seq: number;
  /** True when the buffer overflowed, so an old `from` cannot replay all. */
  truncated: boolean;
  /** Which half of the build is usable right now (page 04 reads this). */
  progress: BuildProgress | null;
  result: AgenticBuildResult | null;
  error: string | null;
}

interface StoredEvent {
  seq: number;
  event: BuildEvent;
}

interface Subscriber {
  onEvent: (entry: StoredEvent) => void;
  /** Called once when the job reaches a terminal state, so the stream closes. */
  onEnd: (status: JobStatus) => void;
}

interface BuildJob {
  id: string;
  userId: string | null;
  brief: string;
  projectName: string;
  status: JobStatus;
  startedAt: number;
  finishedAt: number | null;
  events: StoredEvent[];
  seq: number;
  truncated: boolean;
  progress: BuildProgress | null;
  result: AgenticBuildResult | null;
  error: string | null;
  controller: AbortController;
  subscribers: Set<Subscriber>;
  completion: Promise<void>;
}

/** How many jobs are kept before the oldest finished one is dropped. */
const KEEP_JOBS = 8;
/** How long a finished job stays re-attachable. */
const KEEP_FINISHED_MS = 45 * 60 * 1000;
/** Bounded event buffer per job — a full build is a few hundred events. */
const MAX_EVENTS = 5000;

const jobs = new Map<string, BuildJob>();

function newJobId(): string {
  return randomBytes(9).toString('base64url');
}

function snapshot(job: BuildJob): BuildJobSnapshot {
  return {
    id: job.id,
    status: job.status,
    brief: job.brief,
    projectName: job.projectName,
    startedAt: new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    seq: job.seq,
    truncated: job.truncated,
    progress: job.progress,
    result: job.result,
    error: job.error,
  };
}

/** Drop finished jobs past their retention, oldest first. */
function prune(): void {
  const now = Date.now();
  const finished = [...jobs.values()]
    .filter((job) => job.status !== 'running' && job.finishedAt)
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));

  for (const job of finished) {
    const expired = now - (job.finishedAt ?? 0) > KEEP_FINISHED_MS;
    const overflow = jobs.size > KEEP_JOBS;
    if (expired || overflow) {
      jobs.delete(job.id);
      job.subscribers.clear();
    }
  }
}

function settle(job: BuildJob, status: JobStatus, error: string | null): void {
  const alreadySettled = job.status !== 'running';
  job.status = status;
  job.finishedAt = job.finishedAt ?? Date.now();
  job.error = error;
  if (job.progress && job.progress.status === 'running') {
    job.progress = { ...job.progress, status, updatedAt: new Date().toISOString() };
  }
  prune();
  if (alreadySettled) return;
  // Every attached stream gets told the job is over, then detached.
  for (const subscriber of [...job.subscribers]) {
    try {
      subscriber.onEnd(status);
    } catch (error2) {
      logger.warn({ err: error2, jobId: job.id }, 'build job subscriber onEnd threw');
    }
  }
  job.subscribers.clear();
}

/**
 * Start a build. Returns immediately — the pipeline runs in the background and
 * the caller (or any later tab) attaches to its event stream.
 */
export function startJob(
  input: PipelineInput,
  meta: { userId?: string | null; brief: string; projectName?: string },
  hooks: { onSettled?: (snapshot: BuildJobSnapshot) => void | Promise<void> } = {},
): BuildJobSnapshot {
  const id = newJobId();
  const controller = new AbortController();
  const job: BuildJob = {
    id,
    userId: meta.userId ?? null,
    brief: meta.brief,
    projectName: meta.projectName ?? 'Wireup Device',
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    events: [],
    seq: 0,
    truncated: false,
    progress: null,
    result: null,
    error: null,
    controller,
    subscribers: new Set(),
    completion: Promise.resolve(),
  };
  jobs.set(id, job);
  prune();

  const emit = (event: BuildEvent): void => {
    job.seq += 1;
    const entry: StoredEvent = { seq: job.seq, event };
    job.events.push(entry);
    if (job.events.length > MAX_EVENTS) {
      job.events.splice(0, job.events.length - MAX_EVENTS);
      job.truncated = true;
    }
    if (event.type === 'progress') job.progress = event.progress;
    if (event.type === 'result') job.result = event.result;
    if (event.type === 'error') job.error = event.message;
    for (const subscriber of [...job.subscribers]) {
      try {
        subscriber.onEvent(entry);
      } catch (error) {
        logger.warn({ err: error, jobId: id }, 'build job subscriber threw');
      }
    }
  };

  job.completion = runAgenticPipeline({ ...input, signal: controller.signal }, emit)
    .then(() => {
      // The pipeline reports its own outcome through events; a job with a
      // result shipped, a job with an error did not, and neither means the
      // human stopped it.
      if (controller.signal.aborted) settle(job, 'cancelled', job.error ?? 'Cancelled.');
      else if (job.result) settle(job, 'done', null);
      else settle(job, 'error', job.error ?? 'Build produced no artifacts.');
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error, jobId: id }, 'build job crashed');
      settle(job, 'error', message);
    })
    .then(async () => {
      try {
        await hooks.onSettled?.(snapshot(job));
      } catch (error) {
        logger.warn({ err: error, jobId: id }, 'build job onSettled hook failed');
      }
    });

  logger.info({ jobId: id, user: job.userId, brief: job.brief.slice(0, 80) }, 'build job started');
  return snapshot(job);
}

export function getJob(id: string): BuildJobSnapshot | null {
  const job = jobs.get(id);
  return job ? snapshot(job) : null;
}

/** Jobs belonging to one user, newest first. */
export function listJobs(userId: string | null): BuildJobSnapshot[] {
  return [...jobs.values()]
    .filter((job) => job.userId === userId)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(snapshot);
}

/** The newest job for this user — what a refreshed page re-attaches to. */
export function latestJob(userId: string | null): BuildJobSnapshot | null {
  return listJobs(userId)[0] ?? null;
}

/**
 * Attach to a job's event stream.
 *
 * Everything after `fromSeq` is replayed synchronously, then new events arrive
 * live. Returns an unsubscribe function; `replayedFrom` tells the caller where
 * the replay actually started (the buffer may have overflowed).
 */
export function subscribe(
  id: string,
  onEvent: (entry: StoredEvent) => void,
  onEnd: (status: JobStatus) => void,
  fromSeq = 0,
): { unsubscribe: () => void; replayedFrom: number; status: JobStatus } | null {
  const job = jobs.get(id);
  if (!job) return null;

  const backlog = job.events.filter((entry) => entry.seq > fromSeq);
  const replayedFrom = backlog[0]?.seq ?? job.seq;
  for (const entry of backlog) onEvent(entry);

  if (job.status !== 'running') {
    return { unsubscribe: () => undefined, replayedFrom, status: job.status };
  }

  const subscriber: Subscriber = { onEvent, onEnd };
  job.subscribers.add(subscriber);
  return {
    unsubscribe: () => job.subscribers.delete(subscriber),
    replayedFrom,
    status: job.status,
  };
}

/** Ask a running job to stop. It stops at the next stage boundary. */
export function cancelJob(id: string): BuildJobSnapshot | null {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === 'running') {
    job.controller.abort();
    settle(job, 'cancelled', 'Cancelled by the user.');
  }
  return snapshot(job);
}

/** How many builds are in flight — surfaced on the health endpoint. */
export function runningJobCount(): number {
  return [...jobs.values()].filter((job) => job.status === 'running').length;
}
