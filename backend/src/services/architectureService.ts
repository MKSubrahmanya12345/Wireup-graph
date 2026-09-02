import {
  catalogAsPrompt,
  catalogMatches,
  catalogSources,
  officialComponentCatalog,
} from '../data/componentCatalog.js';
import { runStructuralChecks } from '../data/architectureVerifier.js';
import { runEngineeringChecks, hasBlockingIssue, type Issue } from '../data/engineeringRules.js';
import { repairGraph, type RepairRecord } from '../data/repairGraph.js';
import { logger } from '../config/logger.js';
import {
  verificationReportSchema,
  type ArchitectureGraph,
  type VerificationReport,
} from '../schemas/architecture.js';
import type { RequirementsSpec } from '../schemas/requirements.js';
import {
  PLANNER_SYSTEM_PROMPT,
  VERIFIER_SYSTEM_PROMPT,
} from './plannerPrompts.js';
import { callLlm, extractJson, LlmError, parseLlmJson, type LlmProvider } from './llmService.js';

export interface PlanResult {
  graph: ArchitectureGraph;
  verification: VerificationReport;
  issues: Issue[];
  blocking: boolean;
  /** What the deterministic repair pass had to fix in the model's output. */
  repairs: RepairRecord[];
}

export interface PlanOptions {
  requirements?: RequirementsSpec | null;
  feedback?: string[];
  provider?: LlmProvider;
  model?: string;
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
  options: PlanOptions = {},
): Promise<PlanResult> {
  const trimmedRequest = request.slice(0, MAX_REQUEST_CHARS);
  const { requirements } = options;

  const plannerContent = await callLlm(
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
    {
      provider: options.provider,
      model: options.model,
      maxTokens: PLANNER_MAX_TOKENS,
      jsonResponse: true,
    },
  );

  // Repair before validating. The model's JSON is almost right — port names
  // instead of ids, a reused id, an endpoint it forgot to emit — and every one
  // of those silently detaches an edge in the UI. Fix it deterministically and
  // say what was fixed, rather than shipping a graph that quietly disagrees
  // with its own connection list.
  let nextGraph: ArchitectureGraph;
  let repairs: RepairRecord[];
  try {
    ({ graph: nextGraph, repairs } = repairGraph(extractJson(plannerContent)));
  } catch (error) {
    if (error instanceof LlmError) throw error;
    throw new LlmError(
      `Planner output could not be turned into a graph: ${error instanceof Error ? error.message : String(error)}`,
      502,
      options.provider,
    );
  }

  const issues = runEngineeringChecks(nextGraph, requirements);
  const blocking = hasBlockingIssue(issues);

  const structuralChecks = runStructuralChecks(nextGraph, officialComponentCatalog);
  const matchedSources = catalogMatches(nextGraph as unknown as Record<string, unknown>);

  let verification: VerificationReport;
  try {
    const verifierContent = await callLlm(
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
      {
        provider: options.provider,
        model: options.model,
        maxTokens: VERIFIER_MAX_TOKENS,
        jsonResponse: true,
      },
    );

    // parseLlmJson throws LlmError on malformed output; the surrounding catch
    // falls back to the 'unavailable' verification report, exactly as it does
    // for a network failure.
    const candidate = parseLlmJson(verifierContent, verificationReportSchema, {
      label: 'Architecture verification response',
      provider: options.provider,
    });
    // The reviewer may cite any catalog URL — including parts that are not in
    // this design (a DHT22 plan citing the BME280 "for interface patterns").
    // Only evidence matching a part actually in the graph is kept; if nothing
    // survives, fall back to the parts that ARE here.
    const relevantSources = filterSourcesToGraph(candidate.sources, nextGraph, matchedSources);
    verification = {
      ...candidate,
      // Structural checks are the floor — the model may add, never subtract.
      checks: mergeChecks(structuralChecks, candidate.checks),
      sources: relevantSources,
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

  return { graph: nextGraph, verification, issues, blocking, repairs };
}

/**
 * Keeps only evidence that is relevant to this graph: a source URL must match
 * a part record that actually appears among the nodes. This kills the
 * "BME280 cited for a DHT22 design" class of noise — the model is told to
 * cite catalog URLs only, but it also cited *irrelevant* catalog parts.
 */
function filterSourcesToGraph(
  sources: VerificationReport['sources'],
  graph: ArchitectureGraph,
  matched: ReturnType<typeof catalogMatches>,
): VerificationReport['sources'] {
  const relevantUrls = new Set(matched.map((record) => record.officialUrl.toLowerCase()));
  const kept = sources.filter((source) => relevantUrls.has(source.url.toLowerCase()));
  return kept.length > 0 ? kept : catalogSources(matched);
}

/**
 * Keeps every structural check, appending model checks that target something
 * new. Dedupes on id AND on (title, scope, targetId) — the reviewer model
 * often re-states a structural check verbatim under its own id, which used to
 * surface as the same "Connection endpoints resolve" entry three times.
 */
function mergeChecks(
  structural: VerificationReport['checks'],
  modelChecks: VerificationReport['checks'],
): VerificationReport['checks'] {
  const seenIds = new Set(structural.map((check) => check.id));
  const seenSubstance = new Set(
    structural.map((check) => `${check.title}|${check.scope}|${check.targetId ?? ''}`),
  );
  return [
    ...structural,
    ...modelChecks.filter(
      (check) =>
        !seenIds.has(check.id) &&
        !seenSubstance.has(`${check.title}|${check.scope}|${check.targetId ?? ''}`),
    ),
  ];
}