import mongoose from 'mongoose';

import { isPersistenceEnabled } from '../config/db.js';
import { Project } from '../models/Project.js';
import { planAndVerify } from '../services/architectureService.js';
import { interpretBrief as runInterpretation } from '../services/interpretService.js';
import { GroqError, extractJson } from '../services/groqService.js';
import { env } from '../config/env.js';
import {
  normaliseGraph,
  planArchitectureBodySchema,
} from '../schemas/architecture.js';
import { interpretBodySchema } from '../schemas/requirements.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import type { Request, Response } from 'express';

/**
 * POST /api/architecture/plan
 *
 * Body: { request, graph?, projectId?, requirements?, feedback? }
 * Returns: { ...graph, verification, issues, blocking, projectId, revisionId }
 */
export const planArchitecture = asyncHandler(async (req: Request, res: Response) => {
  const parsed = planArchitectureBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest(
      'Request must include a non-empty request and a graph object.',
      parsed.error.flatten(),
    );
  }

  if (!env.GROQ_API_KEY) {
    throw new ApiError(
      500,
      'Groq is not configured. Add GROQ_API_KEY to backend/.env.',
    );
  }

  const { request, projectId, requirements, feedback } = parsed.data;

  let project = null;
  if (isPersistenceEnabled() && projectId) {
    if (!mongoose.isValidObjectId(projectId)) throw ApiError.badRequest('Invalid projectId.');
    project = await Project.findById(projectId);
    if (!project) throw ApiError.notFound('Project not found.');
  }

  // An explicitly supplied graph wins; otherwise continue from the saved one.
  const baseGraph = normaliseGraph(parsed.data.graph ?? project?.graph ?? {});

  let result;
  try {
    result = await planAndVerify(request, baseGraph, { requirements, feedback });
  } catch (error) {
    if (error instanceof GroqError) throw ApiError.upstream(`Architecture planning failed: ${error.message}`);
    // A zod/parse failure from extractJson surfaces as a plain Error.
    if (error instanceof Error && error.message.includes('non-JSON')) {
      throw ApiError.upstream(`Architecture planning failed: ${error.message}`);
    }
    throw error;
  }

  const { graph, verification, issues, blocking } = result;

  if (!isPersistenceEnabled()) {
    res.status(200).json({ ...graph, verification, issues, blocking, projectId: null, revisionId: null });
    return;
  }

  if (!project) {
    project = await Project.create({ name: graph.project, summary: graph.summary });
  }

  const revision = {
    request,
    graph: graph as unknown as Record<string, unknown>,
    verification: verification as unknown as Record<string, unknown>,
    createdAt: new Date(),
  };

  project.name = graph.project;
  project.summary = graph.summary;
  project.graph = graph as unknown as Record<string, unknown>;
  project.verification = verification as unknown as Record<string, unknown>;
  project.revisions.push(revision);

  if (project.revisions.length > env.MAX_REVISIONS) {
    project.revisions = project.revisions.slice(-env.MAX_REVISIONS);
  }

  await project.save();
  const savedRevision = project.revisions[project.revisions.length - 1];

  res.status(200).json({
    ...graph,
    verification,
    issues,
    blocking,
    projectId: String(project._id),
    revisionId: savedRevision ? String(savedRevision._id) : null,
  });
});

/**
 * POST /api/architecture/interpret
 *
 * Body: { brief, answers?, priorRequirements?, priorQuestions?, feedback?, graph? }
 * Returns: { requirements, questions, assumptions, ready }
 *
 * Pass 0 of the loop. The model decides everything it can and returns only the
 * questions it genuinely cannot answer, each with a recommended default.
 */
export const interpretBrief = asyncHandler(async (req: Request, res: Response) => {
  const parsed = interpretBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest('A non-empty brief is required.', parsed.error.flatten());
  }

  if (!env.GROQ_API_KEY) {
    throw new ApiError(500, 'Groq is not configured. Add GROQ_API_KEY to backend/.env.');
  }

  const { brief, answers, priorRequirements, priorQuestions, feedback, graph } = parsed.data;

  try {
    const result = await runInterpretation({
      brief,
      answers,
      priorRequirements,
      priorQuestions,
      feedback,
      graph,
    });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof GroqError) {
      throw ApiError.upstream(`Could not interpret the brief: ${error.message}`);
    }
    throw error;
  }
});

/** Kept exported for parity with the frontend client, which never calls it. */
export { extractJson };