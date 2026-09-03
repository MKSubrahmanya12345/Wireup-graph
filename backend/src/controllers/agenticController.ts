import type { Request, Response } from 'express';
import { z } from 'zod';

import {
  cancelJob,
  getJob,
  latestJob,
  listJobs,
  startJob,
  subscribe,
  type BuildJobSnapshot,
} from '../agentic/buildJobs.js';
import { runAgenticPipeline } from '../agentic/pipeline.js';
import { specGraphProjectSchema, type SpecGraphProject } from '../agentic/specGraph.js';
import type { AgenticBuildResult, BuildEvent, PipelineInput } from '../agentic/types.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { normaliseGraph } from '../schemas/architecture.js';
import { planForUser } from '../billing/billingService.js';
import { getBillingStore } from '../billing/subscriptionStore.js';
import { logger } from '../config/logger.js';

/**
 * Per-build accounting: which user ran it, on which plan, with which LLM
 * provider ACTUALLY running. Feeds the admin panel's Usage view.
 */
async function recordBuildUsage(
  user: { sub: string; email: string } | undefined,
  plan: 'free' | 'pro',
  result: AgenticBuildResult | null,
  detail: string,
): Promise<void> {
  if (!user) return;
  try {
    await getBillingStore().recordUsage({
      userId: user.sub,
      userEmail: user.email,
      kind: 'build',
      plan,
      llmProvider: result?.llm.actual ?? 'none',
      detail,
    });
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'usage accounting failed (build unaffected)',
    );
  }
}

/**
 * Agentic build endpoints.
 *
 * A build is a JOB now, not a request:
 *
 *   POST /api/build/agentic/jobs              start one, get a jobId back
 *   GET  /api/build/agentic/jobs/:id/stream   attach (replays missed events)
 *   GET  /api/build/agentic/jobs/:id          snapshot: status/progress/result
 *   GET  /api/build/agentic/jobs[ /latest]    this user's jobs
 *   POST /api/build/agentic/jobs/:id/cancel   stop it between stages
 *
 * which is what lets page 03 keep building while page 04 runs the website the
 * build already published — and what lets a refresh pick the build back up
 * instead of losing it.
 *
 *   POST /api/build/agentic/stream — the original endpoint, kept working. It
 *   starts a job and tails it, so a dropped connection no longer kills the work.
 *   POST /api/build/agentic        — buffered variant (same work, one reply).
 */

const bodySchema = z.object({
  brief: z.string().trim().min(1, 'A brief is required.').max(6000),
  projectName: z.string().trim().max(120).optional(),
  graph: z.unknown(),
  // §7: the validated spec graph may ride along with the build. Parsed with
  // the spec-graph schema below — a malformed graph is a 400, never a guess.
  specGraph: z.unknown().optional(),
  provider: z.enum(['bedrock']).optional(),
  model: z.string().optional(),
  // Page-01's sample-interval answer — honored in firmware/config.h.
  sampleIntervalMs: z.coerce.number().int().min(1000).max(600000).optional(),
  // Follow-up change request for a 2nd+ turn (e.g. "make the relay active-low").
  revisionInstruction: z.string().trim().min(1).max(2000).optional(),
});

interface ParsedBuildRequest {
  input: PipelineInput;
  brief: string;
  projectName?: string;
  userPlan: 'free' | 'pro';
}

async function parseBuildRequest(req: Request): Promise<ParsedBuildRequest> {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest('Invalid agentic build request.', parsed.error.flatten());
  }
  const { brief, projectName, provider, model, sampleIntervalMs, revisionInstruction } = parsed.data;
  const { graph } = normaliseGraph(parsed.data.graph ?? {});

  // §7 — normalise the attached spec graph through the schema. The pipeline
  // itself runs the hard readiness gate (every node validated, empty queue);
  // here we only refuse payloads that are not spec graphs at all.
  let specGraph: SpecGraphProject | null = null;
  const rawSpecGraph = parsed.data.specGraph;
  if (rawSpecGraph !== undefined && rawSpecGraph !== null) {
    const specParsed = specGraphProjectSchema.safeParse(rawSpecGraph);
    if (!specParsed.success) {
      throw ApiError.badRequest(
        'The attached specGraph is not a valid wireup-spec-graph project.',
        specParsed.error.flatten(),
      );
    }
    specGraph = specParsed.data;
  }

  // The paying tier decides which model tier the build gets (M2).
  const userPlan = req.user && !req.user.guest ? await planForUser(req.user.sub) : 'free';

  return {
    input: {
      brief,
      projectName,
      graph,
      specGraph,
      provider,
      model,
      sampleIntervalMs,
      revisionInstruction,
      userPlan,
      userId: req.user?.sub,
      userEmail: req.user?.email,
    },
    brief,
    projectName,
    userPlan,
  };
}

/** Usage accounting for a job, recorded when it settles (not when it starts). */
function usageHook(req: Request, userPlan: 'free' | 'pro', label: string) {
  return {
    onSettled: (job: BuildJobSnapshot) =>
      recordBuildUsage(req.user, userPlan, job.result, `${label} · ${job.projectName}`),
  };
}

/** NDJSON writer shared by both streaming endpoints. */
function openNdjsonStream(res: Response): { write: (event: BuildEvent) => void; closed: () => boolean } {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  res.on('close', () => {
    closed = true;
  });

  return {
    closed: () => closed || res.writableEnded,
    write: (event: BuildEvent) => {
      if (closed || res.writableEnded) return;
      res.write(`${JSON.stringify(event)}\n`);
    },
  };
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export const startAgenticJobEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const { input, brief, projectName, userPlan } = await parseBuildRequest(req);
  const job = startJob(
    input,
    { userId: req.user?.sub ?? null, brief, projectName },
    usageHook(req, userPlan, 'job'),
  );
  res.status(201).json({
    jobId: job.id,
    status: job.status,
    streamUrl: `/api/build/agentic/jobs/${job.id}/stream`,
    snapshotUrl: `/api/build/agentic/jobs/${job.id}`,
  });
});

export const listAgenticJobsEndpoint = asyncHandler(async (req: Request, res: Response) => {
  res.json({ jobs: listJobs(req.user?.sub ?? null) });
});

export const latestAgenticJobEndpoint = asyncHandler(async (req: Request, res: Response) => {
  res.json({ job: latestJob(req.user?.sub ?? null) });
});

export const agenticJobEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const job = getJob(String(req.params.jobId ?? ''));
  if (!job) throw new ApiError(404, 'That build job is gone — jobs are kept for a while after they finish, then dropped.');
  res.json({ job });
});

/**
 * Attach to a running (or just-finished) job.
 *
 * `?from=<seq>` replays everything the caller has not seen yet — that is what
 * makes a page refresh, or a second tab, resume the build instead of losing it.
 * A ping every 15s keeps proxies from closing an idle-but-alive stream.
 */
export const agenticJobStreamEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId ?? '');
  const job = getJob(jobId);
  if (!job) throw new ApiError(404, 'That build job is gone — run the build again.');

  const fromRaw = Number(req.query.from ?? 0);
  const fromSeq = Number.isFinite(fromRaw) && fromRaw > 0 ? Math.floor(fromRaw) : 0;

  const stream = openNdjsonStream(res);
  stream.write({ type: 'log', stage: 'job', line: `[job ${jobId}] attached — status ${job.status}, replaying from event ${fromSeq}` });

  const heartbeat = setInterval(() => {
    if (stream.closed()) {
      clearInterval(heartbeat);
      return;
    }
    // A comment-only line: keeps the connection warm, ignored by the client.
    res.write(': ping\n');
  }, 15_000);

  const finish = (): void => {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  };

  const attached = subscribe(
    jobId,
    (entry) => stream.write(entry.event),
    () => finish(),
    fromSeq,
  );
  if (!attached) {
    finish();
    return;
  }

  req.on('close', () => {
    // The tab went away. The job keeps running — that is the whole point.
    clearInterval(heartbeat);
    attached.unsubscribe();
  });
});

export const cancelAgenticJobEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const job = cancelJob(String(req.params.jobId ?? ''));
  if (!job) throw new ApiError(404, 'That build job is gone.');
  res.json({ job });
});

// ── Legacy endpoints (still supported) ──────────────────────────────────────

/**
 * Start a job and tail it in one request. Disconnecting no longer abandons the
 * build: the job keeps running and can be re-attached by id.
 */
export const agenticStreamEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const { input, brief, projectName, userPlan } = await parseBuildRequest(req);
  const job = startJob(
    input,
    { userId: req.user?.sub ?? null, brief, projectName },
    usageHook(req, userPlan, 'stream'),
  );

  const stream = openNdjsonStream(res);
  stream.write({ type: 'log', stage: 'job', line: `[job ${job.id}] started — this build survives navigation and refresh` });

  const heartbeat = setInterval(() => {
    if (stream.closed()) {
      clearInterval(heartbeat);
      return;
    }
    res.write(': ping\n');
  }, 15_000);

  const finish = (): void => {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  };

  const attached = subscribe(
    job.id,
    (entry) => stream.write(entry.event),
    () => finish(),
    0,
  );
  if (!attached) {
    finish();
    return;
  }

  req.on('close', () => {
    clearInterval(heartbeat);
    attached.unsubscribe();
  });
});

export const agenticBufferedEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const { input } = await parseBuildRequest(req);
  const userPlan = input.userPlan ?? 'free';

  const events: BuildEvent[] = [];
  let result: AgenticBuildResult | null = null;
  let failure: string | null = null;

  await runAgenticPipeline(input, (event) => {
    events.push(event);
    if (event.type === 'result') result = event.result;
    if (event.type === 'error') failure = event.message;
  });

  await recordBuildUsage(req.user, userPlan, result, `buffered · ${input.projectName ?? 'build'}`);

  if (!result) {
    throw new ApiError(422, failure ?? 'Agentic build did not produce artifacts.', {
      events: events.slice(-25),
    });
  }

  res.status(200).json({ result, log: events });
});
