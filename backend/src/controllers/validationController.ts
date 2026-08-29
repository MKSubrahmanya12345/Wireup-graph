/**
 * Validation Loop Controller — handles the loop endpoint that validates
 * architecture graphs using RAG and stores verified data in Graph DSA format.
 */
import type { Request, Response } from 'express';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { runValidationLoop, getGraphDSAById, listPerfectGraphDSAs, isProjectDataPerfect } from '../services/validationLoopService.js';
import { buildRAGValidation } from '../services/ragValidationService.js';
import { isPersistenceEnabled } from '../config/db.js';
import type { ArchitectureGraph } from '../schemas/architecture.js';

/**
 * POST /api/validation/loop
 *
 * Body: {
 *   graph: ArchitectureGraph,
 *   projectName?: string,
 *   doubts?: Question[],
 *   resolvedDoubts?: Record<string, string>,
 *   requirements?: RequirementsSpec,
 *   notes?: string[]
 * }
 *
 * Response: ValidationLoopResult with loop status, doubts, score, and saved DSA id.
 */
export const runValidationLoopEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const { graph, projectName, doubts, resolvedDoubts, requirements, notes } = req.body ?? {};

  if (!graph || typeof graph !== 'object') {
    throw ApiError.badRequest('A graph object is required for validation.');
  }

  try {
    const result = await runValidationLoop({
      graph: graph as ArchitectureGraph,
      projectName: projectName ?? (graph.project || 'Untitled'),
      doubts: Array.isArray(doubts) ? doubts : [],
      resolvedDoubts: resolvedDoubts ?? {},
      requirements: requirements ?? null,
      notes: Array.isArray(notes) ? notes : [],
    });

    res.status(200).json({
      ...result,
      persistenceEnabled: isPersistenceEnabled(),
    });
  } catch (error) {
    if (error instanceof Error) {
      throw ApiError.upstream(`Validation loop failed: ${error.message}`);
    }
    throw error;
  }
});

/**
 * GET /api/validation/dsa/:id
 *
 * Returns the stored Graph DSA PRD document by id.
 */
export const getGraphDSAEndpoint = asyncHandler(async (_req: Request, res: Response) => {
  if (!isPersistenceEnabled()) {
    throw ApiError.serviceUnavailable('Persistence is disabled. Set MONGO_URI to enable Graph DSA storage.');
  }

  const { id } = _req.params;
  if (!id) throw ApiError.badRequest('Graph DSA id is required.');

  const doc = await getGraphDSAById(id);
  if (!doc) throw ApiError.notFound('Graph DSA not found.');

  res.status(200).json({
    id,
    projectName: (doc as Record<string, unknown>).projectName,
    isPerfect: (doc as Record<string, unknown>).isPerfect,
    prdDocument: (doc as Record<string, unknown>).prdDocument,
    updatedAt: (doc as Record<string, unknown>).updatedAt,
  });
});

/**
 * GET /api/validation/dsa/perfect
 *
 * Lists all perfect (ready for agentic coding) Graph DSA entries.
 */
export const listPerfectGraphDSAsEndpoint = asyncHandler(async (_req: Request, res: Response) => {
  if (!isPersistenceEnabled()) {
    res.status(200).json({ perfectDSAs: [], persistenceEnabled: false, note: 'Persistence disabled.' });
    return;
  }

  const perfectDSAs = await listPerfectGraphDSAs();
  res.status(200).json({
    persistenceEnabled: true,
    count: perfectDSAs.length,
    perfectDSAs,
  });
});

/**
 * POST /api/validation/check-perfect
 *
 * Quick check whether a graph has reached "project data perfect" status.
 */
export const checkPerfectStatusEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const { graph, doubts, resolvedDoubts, requirements } = req.body ?? {};

  if (!graph) throw ApiError.badRequest('Graph is required.');

  const ragReport = buildRAGValidation(graph, requirements ?? null);
  const doubtsList = Array.isArray(doubts) ? doubts : [];
  const resolved = resolvedDoubts ?? {};
  const perfect = isProjectDataPerfect(ragReport, doubtsList, resolved);

  res.status(200).json({
    isPerfect: perfect,
    score: ragReport.score,
    blocking: ragReport.blocking,
    doubtsResolved: doubtsList.filter(
      (d: { id: string }) => d.id && Boolean(resolved?.[d.id])
    ).length,
    totalDoubts: doubtsList.length,
    summary: ragReport.summary,
  });
});
