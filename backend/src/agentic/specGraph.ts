/**
 * Hardware Project Spec Graph — AI-driven decomposition engine.
 *
 * This module implements the "Hardware Project Spec Graph — Format Design"
 * document. There is NO hardcoded domain list, NO per-project template and NO
 * deterministic fallback decomposition: the graph is invented by the LLM
 * (AWS Bedrock) from a free-text prompt, then *validated* deterministically.
 *
 * Split of responsibilities (the design doc's core idea):
 *
 *   LLM (decomposition, "freestyle"):
 *     - extract explicit requirements + infer implicit capabilities
 *     - spawn one node per capability gap with freeform `domain` strings
 *     - apply the 3-part ask/decide gate (§4): ask only when blocking AND
 *       multi-valued-with-no-safe-default AND not-inferable; otherwise
 *       resolve silently and log an assumption
 *     - record `requires` (dependency) vs `spawned` (lineage) separately (§1a)
 *     - record `known_uncertainty` (non-blocking) (§6)
 *
 *   Deterministic code (validation, never invention):
 *     - schema normalisation + question budget (§2/§5)
 *     - cross-node consistency validation (§6)
 *     - shared-resource contention detection → `resource_allocation` (§6a)
 *     - dirty propagation over the reverse `requires` graph (§6)
 *     - handoff readiness gate (§7)
 *
 * If the LLM is not configured, the API fails loudly (no fallback).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import type {
  ArchitectureConnection,
  ArchitectureGraph,
  ArchitectureNode,
} from '../schemas/architecture.js';
import { callLlm, LlmError, parseLlmJson, type LlmProvider } from '../services/llmService.js';
import { slugify } from './planResolver.js';

// ── Shared-resource vocabulary ──────────────────────────────────────────────
// The decomposition prompt instructs the model to put shared-resource facts
// under these keys inside `spec`. The deterministic contention detector (§6a)
// reads ONLY these keys — it never interprets freeform prose — so a collision
// is a collision by construction, not a heuristic guess.
export const SHARED_RESOURCE_KEYS = {
  i2cAddress: 'i2c_address',
  spiChipSelect: 'spi_cs',
  gpioPins: 'gpio_pins',
  uartChannel: 'uart_channel',
  rfChannel: 'rf_channel',
  dmaChannel: 'dma_channel',
  irqLine: 'irq_line',
  powerDrawMa: 'power_draw_ma',
  supplyRail: 'supply_rail',
  railBudgetMa: 'rail_budget_ma',
} as const;

// ── Zod schemas ─────────────────────────────────────────────────────────────
// Every schema is null-tolerant so a Bedrock model that emits `null` / blank /
// string-wrapped numbers for "not applicable" normalises instead of failing.

const optionalText = z
  .union([
    z.string().trim().transform((value) => (value ? value : undefined)),
    z.literal(null),
    z.undefined(),
  ])
  .transform((value) => (typeof value === 'string' ? value : undefined));

const textWithFallback = (fallback: string) =>
  z
    .union([z.string(), z.literal(null), z.undefined()])
    .transform((value) => (typeof value === 'string' && value.trim() ? value.trim() : fallback));

const stringList = z
  .union([z.array(z.any()), z.literal(null), z.undefined()])
  .transform((value) => (Array.isArray(value) ? value : []))
  .transform((entries) =>
    entries
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .default([]);

const objectArray = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .union([z.array(z.any()), z.literal(null), z.undefined()])
    .transform((value) =>
      (Array.isArray(value) ? value : []).filter(
        (entry): entry is Record<string, unknown> =>
          entry !== null && typeof entry === 'object' && !Array.isArray(entry),
      ),
    )
    .pipe(z.array(schema))
    .default([]);

export const specNodeAssumptionSchema = z.object({
  claim: textWithFallback(''),
  why: textWithFallback(''),
});

export const specNodeQuestionSchema = z.object({
  id: optionalText,
  q: textWithFallback(''),
  why_blocking: textWithFallback(''),
  options: stringList,
  default: optionalText,
});

export const specNodeValidationIssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']).catch('warning'),
  message: textWithFallback(''),
});

export const specNodeStatusSchema = z.enum([
  'unresolved',
  'assumed',
  'user_confirmed',
  'validated',
  'needs_revalidation',
]);

export const specNodeSchema = z.object({
  id: textWithFallback('node'),
  domain: textWithFallback('general'),
  title: textWithFallback('Component'),
  status: specNodeStatusSchema.catch('unresolved'),
  spec: z.record(z.string(), z.unknown()).nullish().transform((value) => value ?? {}),
  /** Dependency edges: "I need this node resolved before I can resolve." */
  requires: stringList,
  /** Lineage edges: "resolving me is why this node exists." Never walked for propagation. */
  spawned: stringList,
  assumptions: objectArray(specNodeAssumptionSchema),
  open_questions: objectArray(specNodeQuestionSchema),
  known_uncertainty: stringList,
  validation: z
    .object({
      checked: z.boolean().catch(false),
      issues: objectArray(specNodeValidationIssueSchema),
    })
    .nullish()
    .transform((value) => value ?? { checked: false, issues: [] }),
});

export const specGraphBranchSchema = z.object({
  id: textWithFallback('node'),
  domain: textWithFallback('general'),
  status: specNodeStatusSchema.catch('unresolved'),
});

/**
 * Flattened root manifest (design doc §2): project_id/title/raw_prompt live at
 * the top level, never nested. `nodes` rides along in-memory (it is the full
 * graph handed to the coding agent, §7); the per-node filesystem form is
 * produced by saveSpecGraphToDisk.
 */
export const specGraphProjectSchema = z.object({
  format: z.literal('wireup-spec-graph').default('wireup-spec-graph'),
  version: z.literal(1).default(1),
  project_id: textWithFallback('project'),
  title: textWithFallback('Embedded IoT System'),
  raw_prompt: textWithFallback(''),
  domain: textWithFallback('embedded-iot'),
  status: textWithFallback('draft'),
  branches: objectArray(specGraphBranchSchema),
  question_queue: objectArray(specNodeQuestionSchema),
  assumption_log: objectArray(
    z.object({
      node_id: textWithFallback(''),
      claim: textWithFallback(''),
      why: textWithFallback(''),
    }),
  ),
  nodes: z.record(z.string(), specNodeSchema).nullish().transform((value) => value ?? {}),
});

export type SpecNode = z.infer<typeof specNodeSchema>;
export type SpecQuestion = z.infer<typeof specNodeQuestionSchema>;
export type SpecAssumption = z.infer<typeof specNodeAssumptionSchema>;
export type SpecGraphProject = z.infer<typeof specGraphProjectSchema>;

export interface DecomposeInput {
  prompt: string;
  answers?: Record<string, string>;
  feedback?: string[];
  priorProject?: SpecGraphProject | null;
  provider?: LlmProvider;
  model?: string;
}

// ── Decomposition prompt ────────────────────────────────────────────────────
// This is the whole "freestyle" algorithm (§3) + the ask/decide gate (§4).
const SPEC_GRAPH_SYSTEM_PROMPT = `You are the hardware specification engineer inside Wireup. You turn one free-text brief into a
"Spec Graph": a dependency graph of spec nodes, each with a freeform domain, a resolved (or
partially resolved) spec, and — only where the rules below force it — open questions.

ALGORITHM (run to completion in one pass):

STEP 1 — Extract explicit requirements from the prompt (parts named, verbs requested).
STEP 2 — Infer IMPLICIT required capabilities those requirements force. Example: "external website
status" on an Arduino Uno forces a network-offload capability the Uno does not have.
STEP 3 — For each required capability, check whether what is explicitly given already satisfies it.
If not, that is a capability gap.
STEP 4 — Spawn ONE node per gap/domain. Domain strings are FREE-FORM — invent whatever fits
(power, connectivity, firmware, perception, flight_control, companion_compute, comms_link,
mechanical, signal_processing, ...). A drone prompt spawns flight_control/companion_compute
branches that an LED project never would. Recurse into each node the same way until nothing new
is implied. A domain NOT implied by any requirement must NOT be spawned (enclosure, regulatory,
branding — never unless the brief names them).
STEP 5 — For every fork a node could have, apply the ASK/DECIDE GATE. Add an open_question ONLY
if ALL THREE hold, otherwise resolve it yourself and log an assumption:
  1. BLOCKING — leaving it unresolved produces wrong or unbuildable output (wrong wiring, wrong
     firmware target, missing pin).
  2. MULTI-VALUED, NO SAFE DEFAULT — ≥2 materially different resolutions exist and silently
     picking one would be wrong for a meaningful fraction of users.
  3. NOT INFERABLE — not derivable from the prompt, from sibling/parent nodes, or from convention.
When you decide something yourself, log an assumption {claim, why} AND, when you rejected a real
alternative, mention the rejected alternative inside "why" so the user can override it later.

EDGES — two kinds, never conflate them:
  - "requires" (dependency): this node's spec depends on the target's resolved spec. Drives
    ordering and dirty propagation. A node can require a node that also spawned it.
  - "spawned" (lineage only): resolving THIS node is why the child exists. Provenance/audit only.
    Never used for propagation.

UNRESOLVABLE REAL-WORLD VARIANCE: for tuning/environment/physics facts no amount of spec-writing
can pin down (lighting robustness, noise floors, field-tuning thresholds), put a short phrase in
"known_uncertainty". These are disclosures, NOT questions, and never block validation.

SHARED-RESOURCE FACTS: when a node consumes a finite shared resource, record it under these exact
spec keys so downstream validation can detect collisions: i2c_address (e.g. "0x29"), spi_cs,
gpio_pins (array of pin names), uart_channel, rf_channel, dma_channel, irq_line, power_draw_ma
(number), supply_rail (e.g. "5V"), rail_budget_ma (number, on the supplying node).

OUTPUT — return JSON ONLY (no markdown), shaped exactly like this:
{
  "title": "short project title",
  "raw_prompt": "the prompt verbatim",
  "domain": "freeform domain tag for the whole project",
  "nodes": {
    "node_<domain>_01": {
      "id": "node_<domain>_01",
      "domain": "freeform",
      "title": "human-readable component name",
      "status": "unresolved | assumed | validated",
      "spec": { "freeform": "resolved facts", "shared_resource_keys": "as above" },
      "requires": ["id", "id"],
      "spawned": ["id"],
      "assumptions": [ { "claim": "what I decided", "why": "reasoning incl. rejected alternatives" } ],
      "open_questions": [ { "id": "kebab-case", "q": "the question", "why_blocking": "what changes with the answer", "options": ["opt A", "opt B"], "default": "opt A" } ],
      "known_uncertainty": ["short phrase"],
      "validation": { "checked": false, "issues": [] }
    }
  }
}

HARD LIMITS:
  - Ask AT MOST 5 questions total across the whole graph. Prefer 0-2. If you would ask more,
    resolve the weakest ones as assumptions.
  - A node with open questions has status "unresolved". A node you decided yourself is "assumed"
    (when you had to choose among real alternatives) or "validated" (when the choice is obvious).
  - Every "requires" target must exist in "nodes". Every node id must be unique.
  - Keep specs factual and structured — no code, no prose paragraphs in "spec".`;

const SPEC_GRAPH_MAX_TOKENS = 12_000;
const MAX_QUESTIONS = 5;

// ── Decomposition (LLM) ─────────────────────────────────────────────────────

export async function decomposePromptToSpecGraph(input: DecomposeInput): Promise<SpecGraphProject> {
  const prompt = input.prompt.trim().slice(0, 8_000);
  if (!prompt) {
    throw new LlmError('A prompt is required to decompose a spec graph.', 400, 'bedrock');
  }

  const payload = {
    prompt,
    answers: input.answers ?? {},
    feedback: (input.feedback ?? []).slice(-5),
    priorProject: input.priorProject ?? null,
  };

  const content = await callLlm(
    [
      { role: 'system', content: SPEC_GRAPH_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    {
      provider: input.provider,
      model: input.model,
      maxTokens: SPEC_GRAPH_MAX_TOKENS,
      jsonResponse: true,
    },
  );

  // No fallback: a model that returns malformed output is an upstream failure.
  const raw = parseLlmJson(content, z.record(z.string(), z.unknown()), {
    label: 'Spec graph decomposition',
    provider: input.provider ?? 'bedrock',
  }) as Record<string, unknown>;

  const project = finalizeSpecGraph({
    format: 'wireup-spec-graph',
    version: 1,
    project_id: `proj_${slugify((raw.title as string) ?? prompt).slice(0, 24) || 'system'}`,
    title: (raw.title as string) ?? 'Embedded IoT System',
    raw_prompt: prompt,
    domain: (raw.domain as string) ?? 'embedded-iot',
    status: 'draft',
    branches: [],
    question_queue: [],
    assumption_log: [],
    nodes: (raw.nodes as Record<string, unknown>) ?? {},
  } as SpecGraphProject);

  return project;
}

// ── Deterministic finalisation + validation ─────────────────────────────────

function questionId(question: SpecQuestion, index: number): string {
  return question.id || `question-${index + 1}`;
}

/** Stable, deduplicated, budget-capped question queue (design doc §2/§5). */
function collectQuestionQueue(nodes: Record<string, SpecNode>): SpecQuestion[] {
  const queue: SpecQuestion[] = [];
  const seen = new Set<string>();

  for (const node of Object.values(nodes)) {
    for (const question of node.open_questions) {
      const id = questionId(question, queue.length + 1);
      const key = question.id || question.q.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        queue.push({ ...question, id });
      }
    }
  }

  return queue.slice(0, MAX_QUESTIONS);
}

/** §6 — cross-node consistency checks, run over every node's `requires` neighbours. */
export function runSpecValidationPass(nodes: Record<string, SpecNode>): void {
  for (const node of Object.values(nodes)) {
    const issues: z.infer<typeof specNodeValidationIssueSchema>[] = [];

    for (const reqId of node.requires) {
      const parent = nodes[reqId];
      if (!parent) {
        issues.push({ severity: 'error', message: `Missing required upstream node: ${reqId}` });
        continue;
      }

      // Voltage-domain consistency: a child demanding notably more voltage than
      // its declared supply is a red flag worth surfacing.
      const childV = numberFromSpec(node.spec.voltage_v);
      const parentV = numberFromSpec(parent.spec.voltage_v);
      if (childV !== undefined && parentV !== undefined && childV > parentV * 1.5) {
        issues.push({
          severity: 'warning',
          message: `Voltage domain mismatch: ${node.id} (${childV}V) draws above supply ${parent.id} (${parentV}V).`,
        });
      }
    }

    node.validation = { checked: true, issues };

    if (issues.some((issue) => issue.severity === 'error')) {
      node.status = 'needs_revalidation';
    } else if (node.open_questions.length > 0) {
      node.status = 'unresolved';
    } else if (node.status === 'unresolved' || node.status === 'needs_revalidation') {
      node.status = 'validated';
    }
  }
}

/** Reverse `requires` index — the lookup the dirty-propagation walk uses (§6). */
export function buildRequiredByIndex(nodes: Record<string, SpecNode>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const node of Object.values(nodes)) {
    for (const reqId of node.requires) {
      const list = index.get(reqId) ?? [];
      list.push(node.id);
      index.set(reqId, list);
    }
  }
  return index;
}

function numberFromSpec(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function stringSet(value: unknown): Set<string> {
  const set = new Set<string>();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) set.add(entry.trim().toLowerCase());
    }
  } else if (typeof value === 'string' && value.trim()) {
    set.add(value.trim().toLowerCase());
  }
  return set;
}

/**
 * §6a — shared-resource contention detection.
 *
 * Spawns a generalized `resource_allocation` node ONLY when ≥2 resolved nodes
 * draw from the same finite shared resource pool AND there is a genuine
 * contention: a non-negotiable identity collision (two parts fixed to the same
 * I2C address / pin / CS line) or combined demand exceeding a declared pool
 * budget. Two devices that merely share a bus type but do not collide produce
 * no node — that is just wiring, resolved inline.
 */
export function detectResourceContention(
  nodes: Record<string, SpecNode>,
  assumptionLog: { node_id: string; claim: string; why: string }[],
): void {
  // Bucket by shared-resource identity. Key = `<pool>:<identity>`.
  const pools = new Map<string, { key: string; pool: string; owners: SpecNode[] }>();

  const addPool = (pool: string, identity: string, node: SpecNode) => {
    if (!identity) return;
    const key = `${pool}:${identity}`;
    const entry = pools.get(key) ?? { key, pool, owners: [] };
    entry.owners.push(node);
    pools.set(key, entry);
  };

  for (const node of Object.values(nodes)) {
    const spec = node.spec;
    for (const addr of stringSet(spec[SHARED_RESOURCE_KEYS.i2cAddress])) addPool('i2c-address', addr, node);
    for (const cs of stringSet(spec[SHARED_RESOURCE_KEYS.spiChipSelect])) addPool('spi-cs', cs, node);
    for (const pin of stringSet(spec[SHARED_RESOURCE_KEYS.gpioPins])) addPool('gpio-pin', pin, node);
    for (const ch of stringSet(spec[SHARED_RESOURCE_KEYS.uartChannel])) addPool('uart-channel', ch, node);
    for (const ch of stringSet(spec[SHARED_RESOURCE_KEYS.rfChannel])) addPool('rf-channel', ch, node);
    for (const ch of stringSet(spec[SHARED_RESOURCE_KEYS.dmaChannel])) addPool('dma-channel', ch, node);
    for (const ch of stringSet(spec[SHARED_RESOURCE_KEYS.irqLine])) addPool('irq-line', ch, node);
  }

  // Capacity check per supply rail: sum consumers vs the rail's declared budget.
  const railConsumers = new Map<string, { owners: SpecNode[]; drawMa: number }>();
  for (const node of Object.values(nodes)) {
    const rail = typeof node.spec[SHARED_RESOURCE_KEYS.supplyRail] === 'string'
      ? (node.spec[SHARED_RESOURCE_KEYS.supplyRail] as string).trim().toLowerCase()
      : '';
    if (!rail) continue;
    const entry = railConsumers.get(rail) ?? { owners: [], drawMa: 0 };
    entry.owners.push(node);
    entry.drawMa += numberFromSpec(node.spec[SHARED_RESOURCE_KEYS.powerDrawMa]) ?? 0;
    railConsumers.set(rail, entry);
  }

  let allocationIndex = 0;

  const spawnAllocation = (
    owners: SpecNode[],
    reason: string,
    resolution: string,
  ): void => {
    const contenders = owners.map((owner) => owner.id);
    if (contenders.length < 2) return;

    const id = `node_resource_allocation_${String(allocationIndex + 1).padStart(2, '0')}`;
    allocationIndex += 1;

    const claim = resolution;
    const why = `Auto-spawned by the cross-node validation pass: ${reason}. The conflict only exists as a relationship between ${contenders.join(', ')} — no single node owns it.`;

    nodes[id] = {
      id,
      domain: 'resource_allocation',
      title: 'Shared-Resource Allocator',
      status: 'assumed',
      spec: { contention: reason, resolution, contenders },
      requires: contenders,
      spawned: [],
      assumptions: [{ claim, why }],
      open_questions: [],
      known_uncertainty: [],
      validation: { checked: false, issues: [] },
    };
    assumptionLog.push({ node_id: id, claim, why });
  };

  for (const entry of pools.values()) {
    const uniqueOwners = entry.owners.filter(
      (node, index) => entry.owners.findIndex((other) => other.id === node.id) === index,
    );
    if (uniqueOwners.length >= 2) {
      spawnAllocation(
        uniqueOwners,
        `${uniqueOwners.length} nodes collide on ${entry.pool} "${entry.key}" (non-negotiable identity)`,
        `Resolved via ${entry.pool.startsWith('i2c') ? 'I2C multiplexer or address re-map' : entry.pool.startsWith('gpio') ? 'pin re-assignment' : 'resource re-allocation'}; verified against remaining budget.`,
      );
    }
  }

  for (const [rail, entry] of railConsumers) {
    // The budget is declared on the node that supplies the rail.
    const budgetNode = Object.values(nodes).find((node) => {
      const budget = numberFromSpec(node.spec[SHARED_RESOURCE_KEYS.railBudgetMa]);
      if (budget === undefined) return false;
      const suppliedRail = typeof node.spec[SHARED_RESOURCE_KEYS.supplyRail] === 'string'
        ? (node.spec[SHARED_RESOURCE_KEYS.supplyRail] as string).trim().toLowerCase()
        : '';
      return suppliedRail === rail || node.domain === 'power' || node.domain === 'resource_allocation';
    });
    const budget = budgetNode ? numberFromSpec(budgetNode.spec[SHARED_RESOURCE_KEYS.railBudgetMa]) : undefined;
    if (budget !== undefined && entry.drawMa > budget) {
      spawnAllocation(
        entry.owners,
        `combined ${entry.drawMa} mA on rail "${rail}" exceeds the ${budget} mA budget`,
        `Resolved via power budget re-balance (move a load to another rail or up-size the supply).`,
      );
    }
  }
}

/**
 * Normalise raw node objects (LLM output, a rehydrated client payload, or a
 * stale persisted graph) into fully-defaulted SpecNodes.
 *
 * `specNodeSchema` is null-tolerant by design — it turns a missing/blank
 * `requires`/`spawned`/`assumptions`/`open_questions`/`known_uncertainty` into
 * an empty array — so this is what guarantees every node has the arrays the UI
 * and the deterministic passes iterate over. Nodes that somehow cannot be
 * normalised are rebuilt with safe defaults instead of crashing the graph.
 */
function normalizeSpecNodes(nodes: unknown): Record<string, SpecNode> {
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) return {};

  const result: Record<string, SpecNode> = {};
  for (const [id, value] of Object.entries(nodes as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const parsed = specNodeSchema.safeParse(value);
    result[id] = parsed.success
      ? parsed.data
      : {
          id,
          domain: 'general',
          title: 'Component',
          status: 'unresolved',
          spec: {},
          requires: [],
          spawned: [],
          assumptions: [],
          open_questions: [],
          known_uncertainty: [],
          validation: { checked: false, issues: [] },
        };
  }
  return result;
}

/** Deterministic finalisation: question budget, branches, validation, contention. */
export function finalizeSpecGraph(graph: SpecGraphProject): SpecGraphProject {
  const nodes = normalizeSpecNodes(graph.nodes ?? {});

  // Normalise every node once before any cross-node logic runs.
  for (const node of Object.values(nodes)) {
    node.open_questions = node.open_questions.map((question, index) => ({
      ...question,
      id: questionId(question, index + 1),
    }));
  }

  const assumptionLog = [...(graph.assumption_log ?? [])];

  // §6a — spawn resource_allocation nodes only on genuine contention.
  detectResourceContention(nodes, assumptionLog);

  // §6 — consistency validation.
  runSpecValidationPass(nodes);

  const questionQueue = collectQuestionQueue(nodes);

  const branches = Object.values(nodes).map((node) => ({
    id: node.id,
    domain: node.domain,
    status: node.status,
  }));

  return {
    ...graph,
    project_id: graph.project_id || `proj_${slugify(graph.title).slice(0, 24) || 'system'}`,
    nodes,
    branches,
    question_queue: questionQueue,
    assumption_log: assumptionLog,
    status: questionQueue.length > 0 ? 'awaiting_user' : 'ready_for_build',
  };
}

// ── Answer application + dirty propagation (§5/§6) ──────────────────────────

export function applyUserAnswersToSpecGraph(
  specGraph: SpecGraphProject,
  answers: Record<string, string>,
): SpecGraphProject {
  // Re-normalise the incoming graph: the /answer endpoint receives whatever the
  // client persisted, which may predate the normalisation pass above.
  const nodes: Record<string, SpecNode> = normalizeSpecNodes(specGraph.nodes ?? {});
  const assumptionLog = [...(specGraph.assumption_log ?? [])];
  const changedNodeIds = new Set<string>();

  // 1. Write answers into the nodes that asked for them.
  for (const [key, value] of Object.entries(answers)) {
    for (const node of Object.values(nodes)) {
      const ownsQuestion = node.open_questions.some(
        (question) => (question.id ?? question.q) === key || question.q.includes(key),
      );
      if (node.id === key || ownsQuestion) {
        node.spec = { ...node.spec, [key]: value };
        node.status = 'user_confirmed';
        node.open_questions = node.open_questions.filter(
          (question) => (question.id ?? question.q) !== key && !question.q.includes(key),
        );
        changedNodeIds.add(node.id);
        assumptionLog.push({
          node_id: node.id,
          claim: `${key} = ${value}`,
          why: 'User-confirmed answer applied to the spec.',
        });
      }
    }
  }

  // 2. Dirty propagation over the reverse `requires` graph ONLY (§6).
  // `spawned` edges are lineage, never walked for propagation.
  const requiredBy = buildRequiredByIndex(nodes);
  const dirty = new Set<string>(changedNodeIds);
  const visited = new Set<string>();

  while (dirty.size > 0) {
    const next: string[] = [];
    for (const id of dirty) {
      if (visited.has(id)) continue;
      visited.add(id);
      for (const dependentId of requiredBy.get(id) ?? []) {
        const dependent = nodes[dependentId];
        if (dependent && dependent.status !== 'user_confirmed') {
          dependent.status = 'needs_revalidation';
          next.push(dependentId);
        }
      }
    }
    dirty.clear();
    for (const id of next) dirty.add(id);
  }

  // 3. New resource contention may emerge from the answers (§6a).
  detectResourceContention(nodes, assumptionLog);

  // 4. Re-validate everything.
  runSpecValidationPass(nodes);

  // 5. Re-collect the (still-open) question queue.
  const questionQueue = collectQuestionQueue(nodes);

  const branches = Object.values(nodes).map((node) => ({
    id: node.id,
    domain: node.domain,
    status: node.status,
  }));

  return {
    ...specGraph,
    nodes,
    branches,
    question_queue: questionQueue,
    assumption_log: assumptionLog,
    status: questionQueue.length > 0 ? 'awaiting_user' : 'ready_for_build',
  };
}

// ── Handoff readiness (§7) ──────────────────────────────────────────────────

/**
 * Ready when the graph is internally consistent and complete enough to hand
 * to a coding agent: no open questions, no unresolved/needs_revalidation node,
 * no error-severity validation issues. `known_uncertainty` entries NEVER block
 * this — they are disclosures, not defects (design doc §6).
 */
export function isSpecGraphReadyForHandoff(specGraph: SpecGraphProject): boolean {
  if (specGraph.question_queue.length > 0) return false;
  for (const node of Object.values(specGraph.nodes)) {
    if (node.status === 'unresolved' || node.status === 'needs_revalidation') return false;
    if (node.validation?.issues.some((issue) => issue.severity === 'error')) return false;
  }
  return true;
}

// ── Conversion: SpecGraph ⇄ ArchitectureGraph (page 02 twin) ────────────────

const DOMAIN_TYPE_HINTS: Array<[RegExp, ArchitectureNode['type']]> = [
  [/\b(controller|compute|mcu|micro|processor|flight_control|flight_stack|board)\b/, 'controller'],
  [/\b(sensor|perception|camera|vision|rangefinder|input)\b/, 'sensor'],
  [/\b(actuator|motor|propulsion|servo|relay|pump|output|led)\b/, 'actuator'],
  [/\b(power|rail|battery|supply|buck|bec|regulator|resource_allocation|allocation)\b/, 'power'],
  [/\b(software|firmware|autonomy|dashboard|app|os|stack)\b/, 'software'],
  [/\b(comm|network|link|connectivity|wifi|radio|bus|bridge|ground_station)\b/, 'communication'],
  [/\b(mechanical|airframe|frame|chassis|structure|enclosure)\b/, 'mechanical'],
  [/\b(interface|display|hmi|screen)\b/, 'interface'],
];

/** Presentation-only mapping: the LLM invents domains, we pick a render type. */
export function domainToNodeType(domain: string): ArchitectureNode['type'] {
  for (const [pattern, type] of DOMAIN_TYPE_HINTS) {
    if (pattern.test(domain)) return type;
  }
  return 'other';
}

/**
 * Layered, dependency-aware layout for the 2D twin (presentation, not content).
 * Sources (nodes with no `requires`) sit left; dependents fan right by depth.
 * `spawned`-only or disconnected nodes are placed beside their spawner.
 */
function layoutSpecNodes(specGraph: SpecGraphProject): Map<string, { x: number; y: number }> {
  const entries = Object.values(specGraph.nodes);
  const positions = new Map<string, { x: number; y: number }>();

  const depth = new Map<string, number>();
  const computeDepth = (id: string, stack: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (stack.has(id)) {
      depth.set(id, 0);
      return 0;
    }
    stack.add(id);
    const node = specGraph.nodes[id];
    const deps = node?.requires ?? [];
    const result =
      deps.length === 0 ? 0 : 1 + Math.max(...deps.map((depId) => computeDepth(depId, stack)));
    stack.delete(id);
    depth.set(id, result);
    return result;
  };
  for (const node of entries) computeDepth(node.id, new Set());

  const byDepth = new Map<number, SpecNode[]>();
  for (const node of entries) {
    const layer = depth.get(node.id) ?? 0;
    const list = byDepth.get(layer) ?? [];
    list.push(node);
    byDepth.set(layer, list);
  }

  const maxDepth = Math.max(0, ...byDepth.keys());
  const layers = [...byDepth.keys()].sort((a, b) => a - b);

  const columnGap = 300;
  const rowGap = 130;

  for (const layer of layers) {
    const members = byDepth.get(layer) ?? [];
    // Centre the column vertically around the vertical middle of the canvas.
    const startY = ((members.length - 1) * rowGap) / 2;
    members.forEach((node, index) => {
      positions.set(node.id, {
        x: 80 + layer * columnGap,
        y: 340 - startY + index * rowGap,
      });
    });
  }

  // Nodes that are neither a source nor reachable by requires (isolated or
  // spawned-only) get placed beside their spawner where possible.
  for (const node of entries) {
    if (positions.has(node.id)) continue;
    const spawner = entries.find((other) => other.spawned.includes(node.id));
    const anchor = spawner ? positions.get(spawner.id) : undefined;
    positions.set(node.id, {
      x: anchor ? anchor.x + columnGap : 80 + maxDepth * columnGap,
      y: anchor ? anchor.y + rowGap : entries.length * rowGap,
    });
  }

  return positions;
}

export function specGraphToArchitectureGraph(specGraph: SpecGraphProject): ArchitectureGraph {
  const positions = layoutSpecNodes(specGraph);
  const nodes: ArchitectureNode[] = [];
  const connections: ArchitectureConnection[] = [];

  const entryList = Object.values(specGraph.nodes);

  for (const specNode of entryList) {
    const position = positions.get(specNode.id) ?? { x: 80, y: 120 };

    const properties = Object.entries(specNode.spec).map(([label, value]) => ({
      label,
      value: typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value),
    }));

    nodes.push({
      id: specNode.id,
      name: specNode.title,
      type: domainToNodeType(specNode.domain),
      partNumber: typeof specNode.spec['part'] === 'string' ? (specNode.spec['part'] as string) : null,
      description: specNode.assumptions.map((a) => a.claim).join('; ') || specNode.title,
      x: position.x,
      y: position.y,
      properties,
      ports: [
        { id: 'vcc', label: 'VCC', direction: 'in', signal: 'power' },
        { id: 'gnd', label: 'GND', direction: 'in', signal: 'ground' },
        { id: 'data', label: 'DATA', direction: 'bidirectional', signal: 'digital' },
      ],
      details: [
        ...specNode.assumptions.map((a) => `${a.claim}: ${a.why}`),
        ...specNode.known_uncertainty.map((u) => `known uncertainty: ${u}`),
      ],
    });

    // `requires` — dependency: arrow from the dependent node to what it needs.
    specNode.requires.forEach((reqId, index) => {
      if (!specGraph.nodes[reqId]) return;
      connections.push({
        id: `link_req_${specNode.id}_${reqId}_${index}`,
        from: specNode.id,
        to: reqId,
        fromPort: 'data',
        toPort: 'data',
        label: 'requires',
        kind: 'dependency',
        details: `${specNode.title} requires ${specGraph.nodes[reqId]?.title ?? reqId}`,
      });
    });

    // `spawned` — lineage: arrow from the spawner to the spawned child.
    specNode.spawned.forEach((childId, index) => {
      if (!specGraph.nodes[childId]) return;
      connections.push({
        id: `link_spawn_${specNode.id}_${childId}_${index}`,
        from: specNode.id,
        to: childId,
        fromPort: 'data',
        toPort: 'data',
        label: 'spawned',
        kind: 'other',
        details: `${specNode.title} spawned ${specGraph.nodes[childId]?.title ?? childId}`,
      });
    });
  }

  return {
    project: specGraph.title,
    summary: specGraph.raw_prompt,
    nodes,
    connections,
    dependencies: [],
    software: [],
    notes: specGraph.assumption_log.map((a) => `[${a.node_id}] ${a.claim} (${a.why})`),
  };
}

// ── File-based persistence (design doc §2) ──────────────────────────────────
// Root manifest never holds full content; each node is its own file so the
// AI can load one branch + its `requires` neighbours, not the whole graph.

export function saveSpecGraphToDisk(specGraph: SpecGraphProject, targetDir: string): void {
  fs.mkdirSync(path.join(targetDir, 'nodes'), { recursive: true });

  const manifest = {
    project_id: specGraph.project_id,
    title: specGraph.title,
    raw_prompt: specGraph.raw_prompt,
    domain: specGraph.domain,
    status: specGraph.status,
    branches: specGraph.branches,
    question_queue: specGraph.question_queue,
    assumption_log: specGraph.assumption_log,
  };
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  for (const [nodeId, node] of Object.entries(specGraph.nodes)) {
    fs.writeFileSync(
      path.join(targetDir, 'nodes', `${nodeId}.json`),
      JSON.stringify(node, null, 2),
      'utf-8',
    );
  }
}

export function loadSpecGraphBranchFromDisk(
  projectDir: string,
  branchId: string,
): { manifest: Record<string, unknown>; branchNodes: Record<string, SpecNode> } {
  const manifestRaw = fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf-8');
  const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;

  const branchNodes: Record<string, SpecNode> = {};
  const mainNodePath = path.join(projectDir, 'nodes', `${branchId}.json`);
  if (fs.existsSync(mainNodePath)) {
    const mainNode = JSON.parse(fs.readFileSync(mainNodePath, 'utf-8')) as SpecNode;
    branchNodes[branchId] = mainNode;

    for (const reqId of mainNode.requires) {
      const reqPath = path.join(projectDir, 'nodes', `${reqId}.json`);
      if (fs.existsSync(reqPath)) {
        branchNodes[reqId] = JSON.parse(fs.readFileSync(reqPath, 'utf-8')) as SpecNode;
      }
    }
  }
  return { manifest, branchNodes };
}
