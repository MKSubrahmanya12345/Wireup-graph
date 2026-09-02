import mongoose from 'mongoose';

import { isPersistenceEnabled } from '../config/db.js';
import { Project } from '../models/Project.js';
import { claimOwnership } from './projectController.js';
import { planAndVerify } from '../services/architectureService.js';
import { interpretBrief as runInterpretation } from '../services/interpretService.js';
import { extractJson, isLlmAvailable, LlmError, type LlmProvider } from '../services/llmService.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  normaliseGraph,
  planArchitectureBodySchema,
} from '../schemas/architecture.js';
import { interpretBodySchema, type InterpretResponse } from '../schemas/requirements.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import {
  deterministicPlan,
  interpretDeterministically,
  specGraphToInterpretResponse,
} from '../agentic/architect.js';
import { decomposePromptToSpecGraph } from '../agentic/specGraph.js';
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
    return;
  } catch (error) {
    // A model that is unreachable, slow, or returns nonsense must not cost the
    // human their session. Fall back to the knowledge base and say so in the
    // assumption log — a degraded answer beats a 502 and a dead end.
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ provider, model, message }, 'interpret: LLM unavailable, using knowledge base');
    const fallback = interpretDeterministically({ brief, answers, priorQuestions });
    res.status(200).json({
      ...fallback,
      assumptions: [
        `The model could not be reached (${message}). Everything below was decided by the Wireup knowledge base instead.`,
        ...fallback.assumptions,
      ],
    });
  }
});

/**
 * POST /api/architecture/interpret/stream
 *
 * Same contract as /interpret, delivered as NDJSON so the graph the engine is
 * building is visible WHILE it is being built:
 *
 *   {type:'stage',      stage, title, detail}
 *   {type:'node',       node}            // one spec-graph node, as spawned
 *   {type:'assumption', node_id, claim, why}
 *   {type:'question',   question}        // survived the ask/assume gate
 *   {type:'refined',    questions}       // the model rewrote the question set
 *   {type:'warn',       message}
 *   {type:'done',       requirements, questions, assumptions, ready, specGraph}
 *   {type:'error',      error}
 *
 * The deterministic pass always runs and always streams first — it is
 * instantaneous and needs no credentials — so the human sees a graph
 * immediately. If Bedrock is configured, the model's questions then replace
 * the deterministic ones via `refined`; if the model is slow or fails, the
 * human still has a complete, honest result instead of a spinner.
 */
export async function interpretBriefStream(req: Request, res: Response): Promise<void> {
  const parsed = interpretBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A non-empty brief is required.' });
    return;
  }

  const { brief, answers, priorRequirements, priorQuestions, feedback, graph } = parsed.data;
  const provider = (req.body.provider as LlmProvider | undefined) ?? env.LLM_PROVIDER;
  const model = req.body.model as string | undefined;

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  // Defeat proxy buffering — nginx/Fly will otherwise hold the whole stream.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event: Record<string, unknown>): void => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    send({
      type: 'stage',
      stage: 'extract',
      title: 'Reading the brief',
      detail: 'Matching what you named against the Wireup device knowledge base.',
    });

    // ── Deterministic pass: streamed node by node, as each is spawned ───────
    const spec = decomposePromptToSpecGraph(
      { prompt: brief, answers },
      (node) => send({ type: 'node', node }),
    );

    send({
      type: 'stage',
      stage: 'validate',
      title: 'Checking the graph',
      detail: `${Object.keys(spec.nodes).length} node(s) — validating dependencies and propagating changes.`,
    });

    for (const entry of spec.assumption_log) {
      send({ type: 'assumption', ...entry });
    }
    for (const question of spec.question_queue) {
      send({ type: 'question', question });
    }

    let result: InterpretResponse = specGraphToInterpretResponse(spec, answers);

    // ── Optional model refinement ───────────────────────────────────────────
    if (isLlmAvailable(provider)) {
      send({
        type: 'stage',
        stage: 'llm',
        title: 'Refining with the model',
        detail: `${provider}${model ? ` · ${model}` : ''} is re-reading the brief for anything the knowledge base missed.`,
      });
      try {
        const llm = await runInterpretation({
          brief,
          answers,
          priorRequirements,
          priorQuestions,
          feedback,
          graph,
          provider,
          model,
        });
        result = {
          requirements: llm.requirements,
          questions: llm.questions,
          assumptions: llm.assumptions,
          ready: llm.ready,
          // Keep the deterministic graph: the model refines the questions, it
          // does not get to rewrite the wiring the rules engine validated.
          specGraph: spec,
        };
        send({ type: 'refined', questions: llm.questions });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send({
          type: 'warn',
          message: `The model could not be reached (${message}). Keeping the knowledge-base result — you can still build from it.`,
        });
      }
    } else {
      send({
        type: 'stage',
        stage: 'llm',
        title: 'No model configured',
        detail: 'Running on the Wireup knowledge base — deterministic, no API key needed.',
      });
    }

    send({ type: 'done', ...result });
  } catch (error) {
    send({
      type: 'error',
      error: error instanceof Error ? error.message : 'Could not interpret the brief.',
    });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

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