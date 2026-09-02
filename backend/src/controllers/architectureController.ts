import mongoose from 'mongoose';

import { isPersistenceEnabled } from '../config/db.js';
import { Project } from '../models/Project.js';
import { claimOwnership } from './projectController.js';
import { planAndVerify } from '../services/architectureService.js';
import { interpretBrief as runInterpretation } from '../services/interpretService.js';
import { extractJson, isLlmAvailable, LlmError, type LlmProvider } from '../services/llmService.js';
import { env } from '../config/env.js';
import {
  normaliseGraph,
  planArchitectureBodySchema,
} from '../schemas/architecture.js';
import { interpretBodySchema } from '../schemas/requirements.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { deterministicPlan, interpretDeterministically } from '../agentic/architect.js';
import {
  catalogMatches,
  catalogSources,
  officialComponentCatalog,
} from '../data/componentCatalog.js';
import { runStructuralChecks } from '../data/architectureVerifier.js';
import { hasBlockingIssue, runEngineeringChecks } from '../data/engineeringRules.js';
import { repairGraph } from '../data/repairGraph.js';
import type { Request, Response } from 'express';
import { z } from 'zod';

/**
 * POST /api/architecture/plan
 *
 * Body: { request, graph?, projectId?, requirements?, feedback?, provider?, model? }
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

  const { request, projectId, requirements, feedback } = parsed.data;
  
  // Optional LLM provider/model selection
  const provider = (req.body.provider as LlmProvider | undefined) ?? env.LLM_PROVIDER;
  const model = req.body.model as string | undefined;

  let project = null;
  if (isPersistenceEnabled() && projectId) {
    if (!mongoose.isValidObjectId(projectId)) throw ApiError.badRequest('Invalid projectId.');
    // Scoped to the caller: another account's id (or a stale one from a
    // different browser profile) resolves to null and simply starts a fresh
    // project below instead of writing into someone else's design.
    project = await Project.findOne({
      _id: projectId,
      $or: [
        { ownerId: req.user?.sub ?? '' },
        { ownerId: '' },
        { ownerId: { $exists: false } },
      ],
    });
  }

  // An explicitly supplied graph wins; otherwise continue from the saved one.
  const { graph: baseGraph, repaired: clientGraphWasUnusable } = normaliseGraph(
    parsed.data.graph ?? project?.graph ?? {},
  );

  let result;
  if (!isLlmAvailable(provider)) {
    // Knowledge-engine path — the planner never needed an API key to be right.
    result = deterministicPlan(request, {}, requirements);
  } else try {
    result = await planAndVerify(request, baseGraph, { requirements, feedback, provider, model });
  } catch (error) {
    if (error instanceof LlmError) throw ApiError.upstream(`Architecture planning failed: ${error.message}`);
    // A zod/parse failure from extractJson surfaces as a plain Error.
    if (error instanceof Error && error.message.includes('non-JSON')) {
      throw ApiError.upstream(`Architecture planning failed: ${error.message}`);
    }
    throw error;
  }

  const { graph, verification, issues, blocking, repairs } = result;

  // If the incoming graph was unusable we had to start from empty, which makes
  // the planner rebuild rather than edit. That is visible, not silent.
  const allRepairs = clientGraphWasUnusable
    ? [
        {
          code: 'GRAPH_REPLACED' as const,
          severity: 'warning' as const,
          message:
            'The graph sent to the planner was not readable, so this draft was rebuilt from your brief instead of edited in place.',
        },
        ...repairs,
      ]
    : repairs;

  if (!isPersistenceEnabled()) {
    res
      .status(200)
      .json({ ...graph, verification, issues, blocking, repairs: allRepairs, projectId: null, revisionId: null });
    return;
  }

  if (!project) {
    project = await Project.create({
      name: graph.project,
      summary: graph.summary,
      ownerId: req.user?.sub ?? '',
    });
  } else {
    // A legacy (pre-account) doc is claimed by the first session that saves to it.
    claimOwnership(project, req);
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
    repairs: allRepairs,
    projectId: String(project._id),
    revisionId: savedRevision ? String(savedRevision._id) : null,
  });
});

/**
 * POST /api/architecture/interpret
 *
 * Body: { brief, answers?, priorRequirements?, priorQuestions?, feedback?, graph?, provider?, model? }
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

  const { brief, answers, priorRequirements, priorQuestions, feedback, graph } = parsed.data;
  
  // Optional LLM provider/model selection
  const provider = (req.body.provider as LlmProvider | undefined) ?? env.LLM_PROVIDER;
  const model = req.body.model as string | undefined;

  if (!isLlmAvailable(provider)) {
    const result = interpretDeterministically({ brief, answers, priorQuestions });
    res.status(200).json(result);
    return;
  }

  try {
    const result = await runInterpretation({
      brief,
      answers,
      priorRequirements,
      priorQuestions,
      feedback,
      graph,
      provider,
      model,
    });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof LlmError) {
      throw ApiError.upstream(`Could not interpret the brief: ${error.message}`);
    }
    throw error;
  }
});

/**
 * POST /api/architecture/repair
 *
 * Body: { graph, requirements? }
 *
 * The deterministic repair loop for page 02. No LLM, no credits: structure is
 * normalised (rail labels, dangling ports, duplicate ids), then the graph is
 * re-run through the engineering rules and structural checks. The UI calls
 * this so fixable issues are fixed — with the repairs listed — instead of
 * freezing the page on a blocking banner. Anything genuinely unfixable
 * without a design decision stays visible as a remaining issue.
 */
export const repairArchitecture = asyncHandler(async (req: Request, res: Response) => {
  const body = z
    .object({
      graph: z.unknown(),
      requirements: z.unknown().nullable().optional(),
    })
    .safeParse(req.body ?? {});
  if (!body.success) {
    throw ApiError.badRequest('Repair requires a graph object.', body.error.flatten());
  }

  const { graph: baseGraph, repaired: clientGraphWasUnusable } = normaliseGraph(body.data.graph ?? {});
  const { graph, repairs } = repairGraph(baseGraph);

  const issues = runEngineeringChecks(graph, null);
  const blocking = hasBlockingIssue(issues);
  const structuralChecks = runStructuralChecks(graph, officialComponentCatalog);
  const matchedSources = catalogMatches(graph as unknown as Record<string, unknown>);

  const passCount = structuralChecks.filter((check) => check.status === 'pass').length;
  const verification = {
    status: (blocking ? 'blocked' : issues.some((issue) => issue.severity === 'warning') ? 'review' : 'verified') as
      | 'blocked'
      | 'review'
      | 'verified',
    score: Math.round((passCount / Math.max(1, structuralChecks.length)) * 100),
    summary:
      'Deterministic repair pass: structure normalised (rail labels, endpoints, ids) and re-checked by the engineering rules. No LLM was involved.',
    checks: structuralChecks,
    sources: catalogSources(matchedSources),
  };

  const allRepairs = clientGraphWasUnusable
    ? [
        {
          code: 'GRAPH_REPLACED' as const,
          severity: 'warning' as const,
          message:
            'The graph sent for repair was not readable, so repair ran from an empty graph — replan from the brief instead.',
        },
        ...repairs,
      ]
    : repairs;

  res.status(200).json({
    ...graph,
    verification,
    issues,
    blocking,
    repairs: allRepairs,
    projectId: null,
    revisionId: null,
  });
});

/** Kept exported for parity with the frontend client, which never calls it. */
export { extractJson };