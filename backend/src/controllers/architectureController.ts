import mongoose from 'mongoose';

import * as fs from 'node:fs';
import * as path from 'node:path';

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

// ??$$$ SpecGraph engine imports — AI-powered decomposition, no deterministic fallback.
import {
  decomposePromptToSpecGraph,
  applyUserAnswersToSpecGraph,
  specGraphToArchitectureGraph,
  isSpecGraphReadyForHandoff,
  saveSpecGraphToDisk,
  loadSpecGraphBranchFromDisk,
  specGraphProjectSchema,
} from '../agentic/specGraph.js';

/**
 * §2 — persisted spec-graph storage. Every generate/answer call writes the
 * full §2 layout (manifest.json + nodes/*.json); the GET endpoints read it
 * back without ever handing the client a graph it did not ask for.
 */
const SPEC_GRAPH_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function specGraphDirFor(projectId: string): string {
  return path.join(env.SPEC_GRAPH_DIR, projectId);
}

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

// ??$$$ POST /api/architecture/spec-graph — AI decomposition of a prompt into a spec graph.
export const generateSpecGraph = asyncHandler(async (req: Request, res: Response) => {
  const { prompt, answers } = (req.body ?? {}) as { prompt?: unknown; answers?: unknown };
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw ApiError.badRequest('A prompt string is required.');
  }

  const provider = (req.body.provider as LlmProvider | undefined) ?? env.LLM_PROVIDER;
  const model = req.body.model as string | undefined;

  // HARD RULE: the decomposition is AI-powered. No LLM configured = loud
  // upstream failure, never a silent deterministic fallback.
  if (!isLlmAvailable(provider)) {
    throw ApiError.upstream(
      'Spec-graph decomposition requires an LLM (AWS Bedrock). Configure AWS credentials to continue.',
    );
  }

  const specGraph = await decomposePromptToSpecGraph({
    prompt: prompt.trim(),
    answers: (answers ?? {}) as Record<string, string>,
    provider,
    model,
  });

  // §2 — persist manifest + per-node files (the durable §7 handoff artifact).
  saveSpecGraphToDisk(specGraph, specGraphDirFor(specGraph.project_id));

  const archGraph = specGraphToArchitectureGraph(specGraph);
  const isReady = isSpecGraphReadyForHandoff(specGraph);

  res.status(200).json({ specGraph, archGraph, isReady });
});

// ??$$$ POST /api/architecture/spec-graph/answer — apply user answers, dirty propagation + re-validation.
export const answerSpecGraph = asyncHandler(async (req: Request, res: Response) => {
  const { specGraph, answers } = (req.body ?? {}) as { specGraph?: unknown; answers?: unknown };
  if (!specGraph || !answers || typeof answers !== 'object') {
    throw ApiError.badRequest('Both specGraph project object and answers map are required.');
  }

  // The graph comes from the client — normalise it through the schema instead
  // of casting, so a malformed or stale payload is a 400, never a guess.
  const parsedGraph = specGraphProjectSchema.safeParse(specGraph);
  if (!parsedGraph.success) {
    throw ApiError.badRequest(
      'The specGraph payload is not a valid wireup-spec-graph project.',
      parsedGraph.error.flatten(),
    );
  }

  const updatedSpecGraph = applyUserAnswersToSpecGraph(
    parsedGraph.data,
    answers as Record<string, string>,
  );

  // §2 — the persisted graph always reflects the latest resolved state.
  saveSpecGraphToDisk(updatedSpecGraph, specGraphDirFor(updatedSpecGraph.project_id));

  const archGraph = specGraphToArchitectureGraph(updatedSpecGraph);
  const isReady = isSpecGraphReadyForHandoff(updatedSpecGraph);

  res.status(200).json({
    specGraph: updatedSpecGraph,
    archGraph,
    isReady,
  });
});

// ??$$$ GET /api/architecture/spec-graph/:projectId — the persisted root manifest (§2).
// The manifest NEVER holds full node content — pointers only, by construction.
export const getSpecGraphManifest = asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId ?? '');
  if (!SPEC_GRAPH_ID_PATTERN.test(projectId)) {
    throw ApiError.badRequest('Invalid spec-graph project id.');
  }
  const dir = specGraphDirFor(projectId);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new ApiError(404, `No spec graph is persisted for project "${projectId}".`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  res.status(200).json({ projectId, dir, manifest });
});

// ??$$$ GET /api/architecture/spec-graph/:projectId/nodes/:branchId — ONE branch
// plus its direct `requires` neighbours ONLY (§2's tractability rule: the AI
// loads the branch it is working on, never the whole graph).
export const getSpecGraphBranch = asyncHandler(async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId ?? '');
  const branchId = String(req.params.branchId ?? '');
  if (!SPEC_GRAPH_ID_PATTERN.test(projectId) || !SPEC_GRAPH_ID_PATTERN.test(branchId)) {
    throw ApiError.badRequest('Invalid spec-graph project or branch id.');
  }
  const dir = specGraphDirFor(projectId);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    throw new ApiError(404, `No spec graph is persisted for project "${projectId}".`);
  }
  const { manifest, branchNodes } = loadSpecGraphBranchFromDisk(dir, branchId);
  if (!(branchId in branchNodes)) {
    throw new ApiError(404, `No node "${branchId}" in project "${projectId}".`);
  }
  res.status(200).json({ projectId, branchId, manifest, branchNodes });
});

/** Kept exported for parity with the frontend client, which never calls it. */
export { extractJson };