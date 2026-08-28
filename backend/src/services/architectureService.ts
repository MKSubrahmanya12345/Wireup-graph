import {
  catalogAsPrompt,
  catalogMatches,
  catalogSources,
  officialComponentCatalog,
} from '../data/componentCatalog.js';
import { runStructuralChecks } from '../data/architectureVerifier.js';
import { runEngineeringChecks, hasBlockingIssue, type Issue } from '../data/engineeringRules.js';
import { logger } from '../config/logger.js';
import {
  architectureGraphSchema,
  verificationReportSchema,
  type ArchitectureGraph,
  type VerificationReport,
} from '../schemas/architecture.js';
import type { RequirementsSpec } from '../schemas/requirements.js';
import {
  PLANNER_SYSTEM_PROMPT,
  VERIFIER_SYSTEM_PROMPT,
  callGroq,
  extractJson,
} from './groqService.js';

export interface PlanResult {
  graph: ArchitectureGraph;
  verification: VerificationReport;
  // ??$$$ — issues and blocking were missing from PlanResult; controller expected them.
  issues: Issue[];
  blocking: boolean;
}

// ??$$$ — Options arg added to match the controller call signature.
export interface PlanOptions {
  requirements?: RequirementsSpec | null;
  feedback?: string[];
}

const MAX_REQUEST_CHARS = 12_000;
const PLANNER_MAX_TOKENS = 6_000;
const VERIFIER_MAX_TOKENS = 4_500;

/**
 * The two-pass pipeline:
 *   1. planner  — builds/updates the graph using the component evidence bank
 *   2. verifier — an independent reviewer that never saw pass 1's reasoning
 *
 * Pass 2 failing degrades the report to 'unavailable'; it never fails the
 * whole request, because a graph without a review beats no graph at all.
 */
export async function planAndVerify(
  request: string,
  graph: ArchitectureGraph,
  // ??$$$ — 3rd arg added; was missing, causing TS2554 in controller.
  options: PlanOptions = {},
): Promise<PlanResult> {
  const trimmedRequest = request.slice(0, MAX_REQUEST_CHARS);
  const { requirements } = options;

  const plannerContent = await callGroq(
    [
      {
        role: 'system',
        content: `${PLANNER_SYSTEM_PROMPT}\n\nOfficial component bank. Use these records as evidence when selecting or retaining parts:\n${catalogAsPrompt()}`,
      },
      {
        role: 'user',
        content: JSON.stringify({ request: trimmedRequest, graph }),
      },
    ],
    PLANNER_MAX_TOKENS,
  );

  const nextGraph = architectureGraphSchema.parse(extractJson(plannerContent));

  // ??$$$ — run deterministic engineering rules (was missing from planAndVerify)
  const issues = runEngineeringChecks(nextGraph, requirements);
  const blocking = hasBlockingIssue(issues);

  const structuralChecks = runStructuralChecks(nextGraph, officialComponentCatalog);
  const matchedSources = catalogMatches(nextGraph as unknown as Record<string, unknown>);

  let verification: VerificationReport;
  try {
    const verifierContent = await callGroq(
      [
        { role: 'system', content: VERIFIER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            request: trimmedRequest,
            proposedGraph: nextGraph,
            structuralChecks,
            officialComponentBank: officialComponentCatalog,
          }),
        },
      ],
      VERIFIER_MAX_TOKENS,
    );

    const candidate = verificationReportSchema.parse(extractJson(verifierContent));
    verification = {
      ...candidate,
      // Structural checks are the floor — the model may add, never subtract.
      checks: mergeChecks(structuralChecks, candidate.checks),
      sources: candidate.sources.length ? candidate.sources : catalogSources(matchedSources),
    };
  } catch (error) {
    logger.error({ err: error }, 'Independent architecture verification failed');
    verification = {
      status: 'unavailable',
      score: 0,
      summary:
        'The architecture was generated, but the independent verification pass is unavailable. Review every connection against the cited data sheets.',
      checks: structuralChecks,
      sources: catalogSources(matchedSources),
    };
  }

  return { graph: nextGraph, verification, issues, blocking };
}

/** Keeps every structural check, appending model checks that target something new. */
function mergeChecks(
  structural: VerificationReport['checks'],
  modelChecks: VerificationReport['checks'],
): VerificationReport['checks'] {
  const seen = new Set(structural.map((check) => check.id));
  return [...structural, ...modelChecks.filter((check) => !seen.has(check.id))];
}