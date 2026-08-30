import type { Request, Response } from 'express';

import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { loadScaffold } from '../services/scaffoldService.js';

/**
 * Build endpoints.
 *
 * The full generate → compile → repair → build pipeline lives at
 * POST /api/build/agentic (streaming variant: /api/build/agentic/stream) —
 * see controllers/agenticController.ts. This controller keeps the free,
 * LLM-less scaffold introspection endpoint.
 */

/** GET /api/build/scaffold — the committed MERN scaffold (no LLM call). */
export const getScaffold = asyncHandler(async (_req: Request, res: Response) => {
  try {
    const scaffold = await loadScaffold();
    res.status(200).json({ root: 'scaffolds/website', files: scaffold });
  } catch (error) {
    throw new ApiError(500, error instanceof Error ? error.message : 'Could not load the scaffold.');
  }
});
