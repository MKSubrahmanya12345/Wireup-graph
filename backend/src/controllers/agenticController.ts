import type { Request, Response } from 'express';
import { z } from 'zod';

import { runAgenticPipeline } from '../agentic/pipeline.js';
import type { AgenticBuildResult, BuildEvent } from '../agentic/types.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { normaliseGraph } from '../schemas/architecture.js';

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
});

export const agenticStreamEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest('Invalid agentic build request.', parsed.error.flatten());
  }
  const { brief, projectName } = parsed.data;
  const { graph } = normaliseGraph(parsed.data.graph ?? {});

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

  try {
    await runAgenticPipeline({ brief, projectName, graph }, emit);
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
  const { brief, projectName } = parsed.data;
  const { graph } = normaliseGraph(parsed.data.graph ?? {});

  const events: BuildEvent[] = [];
  let result: AgenticBuildResult | null = null;
  let failure: string | null = null;

  await runAgenticPipeline({ brief, projectName, graph }, (event) => {
    events.push(event);
    if (event.type === 'result') result = event.result;
    if (event.type === 'error') failure = event.message;
  });

  if (!result) {
    throw new ApiError(422, failure ?? 'Agentic build did not produce artifacts.', {
      events: events.slice(-25),
    });
  }

  res.status(200).json({ result, log: events });
});
