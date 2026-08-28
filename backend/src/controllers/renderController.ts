import { renderArchitecture } from '../services/image/renderService.js';
import { normaliseGraph } from '../schemas/architecture.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { z } from 'zod';
import type { Request, Response } from 'express';

/**
 * POST /api/architecture/render
 *
 * Body: { graph, projectId?, force?: boolean, provider?: string, angle?: string }
 * Returns: { status: 'ready'|'pending'|'unavailable', url?, prompt?, cached? }
 *
 * Generates or retrieves a cached photorealistic image of the hardware assembly.
 * Never fails the request; degradation is via status: 'unavailable'.
 */

const renderBodySchema = z.object({
  graph: z.unknown().optional(),
  projectId: z.string().nullish(),
  force: z.boolean().optional(),
  provider: z.string().optional(),
  angle: z.enum(['three-quarter', 'side', 'top', 'front']).optional(),
});

export const renderArchitectureImage = asyncHandler(async (req: Request, res: Response) => {
  const parsed = renderBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest('Invalid render request', parsed.error.flatten());
  }

  const { graph: graphInput, force, angle } = parsed.data;

  const graph = normaliseGraph(graphInput);

  const result = await renderArchitecture({
    graph,
    force,
    angle,
  });

  res.status(200).json(result);
});
