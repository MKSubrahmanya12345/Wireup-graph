import type { Request, Response } from 'express';
import { z } from 'zod';

import { runAgenticPipeline } from '../agentic/pipeline.js';
import type { AgenticBuildResult, BuildEvent } from '../agentic/types.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { normaliseGraph } from '../schemas/architecture.js';
import { planForUser } from '../billing/billingService.js';
import { getBillingStore } from '../billing/subscriptionStore.js';
import { logger } from '../config/logger.js';

/**
 * Per-build accounting: which user ran it, on which plan, with which LLM
 * provider ACTUALLY running (after any Gemini→Groq fallback). Feeds the
 * admin panel's Usage view.
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
 * POST /api/build/agentic/stream — the primary path. The pipeline runs with
 * its terminal open: every stage, command, validation report and artifact is
 * streamed to the browser as newline-delimited JSON.
 *
 * POST /api/build/agentic — buffered variant (same work, one JSON reply).
 */

const bodySchema = z.object({
  brief: z.string().trim().min(1, 'A brief is required.').max(6000),
  projectName: z.string().trim().max(120).optional(),
  graph: z.unknown(),
  provider: z.enum(['groq', 'bedrock', 'gemini']).optional(),
  model: z.string().optional(),
  // Page-01's sample-interval answer — honored in firmware/config.h.
  sampleIntervalMs: z.coerce.number().int().min(1000).max(600000).optional(),
  // Follow-up change request for a 2nd+ turn (e.g. "make the relay active-low").
  revisionInstruction: z.string().trim().min(1).max(2000).optional(),
});

export const agenticStreamEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest('Invalid agentic build request.', parsed.error.flatten());
  }
  const { brief, projectName, provider, model, sampleIntervalMs, revisionInstruction } = parsed.data;
  const { graph } = normaliseGraph(parsed.data.graph ?? {});
  // The paying tier decides which model tier the build gets (M2).
  const userPlan = req.user && !req.user.guest ? await planForUser(req.user.sub) : 'free';

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  const emit = (event: BuildEvent): void => {
    if (closed || res.writableEnded) return;
    res.write(`${JSON.stringify(event)}\n`);
  };

  let streamed: AgenticBuildResult | null = null;
  try {
    await runAgenticPipeline(
      {
        brief,
        projectName,
        graph,
        provider,
        model,
        sampleIntervalMs,
        revisionInstruction,
        userPlan,
        userId: req.user?.sub,
        userEmail: req.user?.email,
      },
      (event) => {
        if (event.type === 'result') streamed = event.result;
        emit(event);
      },
    );
    await recordBuildUsage(req.user, userPlan, streamed, `stream · ${projectName ?? 'build'}`);
  } catch (error) {
    emit({ type: 'error', message: error instanceof Error ? error.message : 'Agentic build failed.' });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

export const agenticBufferedEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest('Invalid agentic build request.', parsed.error.flatten());
  }
  const { brief, projectName, provider, model, sampleIntervalMs, revisionInstruction } = parsed.data;
  const { graph } = normaliseGraph(parsed.data.graph ?? {});
  const userPlan = req.user && !req.user.guest ? await planForUser(req.user.sub) : 'free';

  const events: BuildEvent[] = [];
  let result: AgenticBuildResult | null = null;
  let failure: string | null = null;

  await runAgenticPipeline(
    {
      brief,
      projectName,
      graph,
      provider,
      model,
      sampleIntervalMs,
      revisionInstruction,
      userPlan,
      userId: req.user?.sub,
      userEmail: req.user?.email,
    },
    (event) => {
      events.push(event);
      if (event.type === 'result') result = event.result;
      if (event.type === 'error') failure = event.message;
    },
  );

  await recordBuildUsage(req.user, userPlan, result, `buffered · ${projectName ?? 'build'}`);

  if (!result) {
    throw new ApiError(422, failure ?? 'Agentic build did not produce artifacts.', {
      events: events.slice(-25),
    });
  }

  res.status(200).json({ result, log: events });
});
