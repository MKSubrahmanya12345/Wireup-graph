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
 *     - schema normalisation + question budget + globally-unique question ids (§2/§5)
 *     - question_queue / assumption_log as POINTERS into nodes, never copies (§2)
 *     - cross-node consistency validation: requires-integrity, cycles, rail
 *       voltage + power-budget, lineage integrity (§6)
 *     - shared-resource contention detection → `resource_allocation` nodes that
 *       genuinely RESOLVE the conflict (re-map / multiplexer / re-assign /
 *       re-balance) or surface it as a blocking issue — never a fake
 *       "resolved" claim (§6a)
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
  i2cAddressAlt: 'i2c_address_alt',
  addressConfigurable: 'address_configurable',
  spiChipSelect: 'spi_cs',
  gpioPins: 'gpio_pins',
  uartChannel: 'uart_channel',
  rfChannel: 'rf_channel',
  dmaChannel: 'dma_channel',
  irqLine: 'irq_line',
  busId: 'bus_id',
  busBandwidthPct: 'bus_bandwidth_pct',
  powerDrawMa: 'power_draw_ma',
  supplyRail: 'supply_rail',
  railBudgetMa: 'rail_budget_ma',
} as const;

/** Reserved for an I2C multiplexer introduced by §6a — never handed to a device. */
export const I2C_MUX_ADDRESS = '0x70';

/** §5 — questions are batched, at most this many per round. */
export const MAX_OPEN_QUESTIONS_PER_ROUND = 5;

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
 * §2 — the root manifest holds POINTERS into `node.open_questions`, never full
 * copies. Tolerates legacy full-question entries (a stale browser session) by
 * extracting whatever pointer can be derived; the queue is re-derived from the
 * nodes on every operation anyway, so input values are never trusted.
 */
const questionPointerList = z
  .union([z.array(z.any()), z.literal(null), z.undefined()])
  .transform((entries) =>
    (Array.isArray(entries) ? entries : [])
      .map((entry) => {
        const record = (entry ?? {}) as Record<string, unknown>;
        const nodeId = typeof record['node_id'] === 'string' ? record['node_id'] : '';
        const questionId =
          typeof record['question_id'] === 'string'
            ? record['question_id']
            : typeof record['id'] === 'string'
              ? record['id']
              : '';
        return { node_id: nodeId, question_id: questionId };
      })
      .filter((pointer) => pointer.node_id !== '' && pointer.question_id !== ''),
  )
  .default([]);

/** §2 — same rule for the assumption log: pointers, for audit/override. */
const assumptionPointerList = z
  .union([z.array(z.any()), z.literal(null), z.undefined()])
  .transform((entries) =>
    (Array.isArray(entries) ? entries : [])
      .map((entry) => {
        const record = (entry ?? {}) as Record<string, unknown>;
        const nodeId = typeof record['node_id'] === 'string' ? record['node_id'] : '';
        const index = Number.isFinite(Number(record['index'])) ? Number(record['index']) : 0;
        return { node_id: nodeId, index: Math.max(0, Math.trunc(index)) };
      })
      .filter((pointer) => pointer.node_id !== ''),
  )
  .default([]);

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
  question_queue: questionPointerList,
  assumption_log: assumptionPointerList,
  nodes: z.record(z.string(), specNodeSchema).nullish().transform((value) => value ?? {}),
});

export type SpecNode = z.infer<typeof specNodeSchema>;
export type SpecQuestion = z.infer<typeof specNodeQuestionSchema>;
export type SpecAssumption = z.infer<typeof specNodeAssumptionSchema>;
export type SpecValidationIssue = z.infer<typeof specNodeValidationIssueSchema>;
export type SpecGraphProject = z.infer<typeof specGraphProjectSchema>;

/** §2 — a question pointer: where in the graph the open question lives. */
export interface SpecQuestionPointer {
  node_id: string;
  question_id: string;
}

/** §2 — an assumption pointer: {node_id, index} into `node.assumptions`. */
export interface SpecAssumptionPointer {
  node_id: string;
  index: number;
}

/** A concrete re-assignment performed by a §6a allocator, for the audit trail. */
export interface ResourceMove {
  node_id: string;
  field: string;
  from: string;
  to: string;
}

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
  2. MULTI-VALUED, NO SAFE DEFAULT — >=2 materially different resolutions exist and silently
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

SHARED-RESOURCE FACTS: when a node consumes or provides a finite shared resource, record it under
these exact spec keys so downstream validation can detect genuine contention. Never invent a
fixed identity a real part does not have:
  - i2c_address (e.g. "0x29") — the part's strapped/default address, when fixed.
  - i2c_address_alt (array) — addresses the part CAN be strapped to, when configurable.
  - address_configurable (true) — the part has strappable address options.
  - spi_cs, gpio_pins (array of pin names), uart_channel, rf_channel, dma_channel, irq_line.
  - bus_id + bus_bandwidth_pct (number, percent of that bus this node needs).
  - power_draw_ma (number) on every consumer; supply_rail (e.g. "5V") on consumers AND on the
    node that provides the rail; rail_budget_ma (number) ONLY on the node providing that rail.
  - voltage_v (number) — the node's logic/operating voltage.

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
      "open_questions": [ { "id": "kebab-case-globally-unique", "q": "the question", "why_blocking": "what changes with the answer", "options": ["opt A", "opt B"], "default": "opt A" } ],
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
    "user_confirmed" is set ONLY by the answer flow — never emit it yourself.
  - Every "requires" and "spawned" target must exist in "nodes". Every node id must be unique.
    Never list a node in its own "requires".
  - Keep specs factual and structured — no code, no prose paragraphs in "spec".`;

const SPEC_GRAPH_MAX_TOKENS = 12_000;

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

// ── Small spec-fact helpers ─────────────────────────────────────────────────

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

function railName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Voltage implied by a rail's name — "5v" → 5, "3v3"/"3.3v" → 3.3, "12v" → 12.
 * Used ONLY for consistency warnings/rebalance compatibility, never invention.
 */
function railVoltage(rail: string): number | undefined {
  const match = /^(\d+)(?:\.(\d+))?v(\d+)?$/.exec(rail.trim().toLowerCase());
  if (!match) return undefined;
  const whole = Number(match[1]);
  if (!Number.isFinite(whole)) return undefined;
  const fraction = match[2] ? Number(`0.${match[2]}`) : match[3] ? Number(`0.${match[3]}`) : 0;
  return whole + fraction;
}

// ── Question ids + pointer builders (§2/§5) ─────────────────────────────────

/**
 * Give every open question a globally-unique id. The LLM sometimes omits ids
 * or reuses one across nodes; a duplicate id would silently dedupe REAL
 * questions in the queue and misroute user answers, so uniqueness is enforced
 * here, deterministically: missing ids become `<node.id>-qN` and collisions
 * get the owning node's prefix.
 */
export function normaliseQuestionIds(nodes: Record<string, SpecNode>): void {
  const seen = new Set<string>();
  for (const node of Object.values(nodes)) {
    node.open_questions = node.open_questions.map((question, index) => {
      let id = question.id?.trim() || `${node.id}-q${index + 1}`;
      if (seen.has(id)) id = `${node.id}-${id}`;
      while (seen.has(id)) id = `${id}-x`;
      seen.add(id);
      return { ...question, id };
    });
  }
}

/**
 * §5/§2 — the question queue: deduped POINTERS into node.open_questions across
 * the whole graph, batched once, capped at MAX_OPEN_QUESTIONS_PER_ROUND. Any
 * questions beyond the cap stay open and surface in the next round — the
 * per-round budget is a hard server-side backstop on top of the prompt limit.
 */
export function collectQuestionQueue(nodes: Record<string, SpecNode>): SpecQuestionPointer[] {
  const queue: SpecQuestionPointer[] = [];
  const seen = new Set<string>();
  for (const node of Object.values(nodes)) {
    for (const question of node.open_questions) {
      const questionId = question.id ?? '';
      if (!questionId || seen.has(questionId)) continue;
      seen.add(questionId);
      queue.push({ node_id: node.id, question_id: questionId });
    }
  }
  return queue.slice(0, MAX_OPEN_QUESTIONS_PER_ROUND);
}

/**
 * §2 — the assumption log: POINTERS into every node's `assumptions`, derived
 * fresh on each pass so it can never drift out of sync with the nodes (and can
 * never contain a stale copy of an assumption the user has since overridden).
 */
export function buildAssumptionLog(nodes: Record<string, SpecNode>): SpecAssumptionPointer[] {
  const log: SpecAssumptionPointer[] = [];
  for (const node of Object.values(nodes)) {
    node.assumptions.forEach((_assumption, index) => {
      log.push({ node_id: node.id, index });
    });
  }
  return log;
}

// ── Reverse `requires` index (§6) ───────────────────────────────────────────

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

/**
 * Every node that can reach itself by walking `requires` — i.e. every node on
 * a dependency cycle. Resolution order and dirty propagation are undefined on
 * a cycle, so validation reports it as a hard error instead of looping.
 */
function findRequiresCycleNodes(nodes: Record<string, SpecNode>): Set<string> {
  const inCycle = new Set<string>();
  for (const start of Object.keys(nodes)) {
    const seen = new Set<string>([start]);
    const stack = [...(nodes[start]?.requires ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === start) {
        inCycle.add(start);
        break;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      for (const next of nodes[id]?.requires ?? []) stack.push(next);
    }
  }
  return inCycle;
}

// ── Power-rail accounting (§6) ──────────────────────────────────────────────

interface RailSupplier {
  node: SpecNode;
  budget: number;
}

interface RailConsumer {
  node: SpecNode;
  draw: number;
}

interface RailAuditEntry {
  rail: string;
  voltage: number | undefined;
  suppliers: RailSupplier[];
  consumers: RailConsumer[];
  /** max declared budget on this rail (parallel supplies → the strongest). */
  budget: number;
  draw: number;
}

/**
 * Deterministic rail accounting. Convention (also in the prompt): the node
 * PROVIDING a rail declares `supply_rail` + `rail_budget_ma`; consumers declare
 * `supply_rail` + `power_draw_ma`. A node declaring both is a supplier whose
 * budget is already net of its own draw. No domain-string fallbacks — the
 * budget belongs to whichever node declares it ON that rail.
 */
function auditRails(nodes: Record<string, SpecNode>): Map<string, RailAuditEntry> {
  const rails = new Map<string, RailAuditEntry>();
  const entryFor = (rail: string): RailAuditEntry => {
    const existing =
      rails.get(rail) ?? { rail, voltage: railVoltage(rail), suppliers: [], consumers: [], budget: 0, draw: 0 };
    rails.set(rail, existing);
    return existing;
  };

  for (const node of Object.values(nodes)) {
    const rail = railName(node.spec[SHARED_RESOURCE_KEYS.supplyRail]);
    if (!rail) continue;
    const entry = entryFor(rail);
    const budget = numberFromSpec(node.spec[SHARED_RESOURCE_KEYS.railBudgetMa]);
    const draw = numberFromSpec(node.spec[SHARED_RESOURCE_KEYS.powerDrawMa]);
    if (budget !== undefined) {
      entry.suppliers.push({ node, budget });
      entry.budget = Math.max(entry.budget, budget);
    } else if (draw !== undefined && draw > 0) {
      entry.consumers.push({ node, draw });
      entry.draw += draw;
    }
  }
  return rails;
}

// ── Cross-node consistency validation (§6) ──────────────────────────────────

/**
 * §6 — validation pass. Re-checks every node's spec against its `requires`
 * neighbours and against the shared-resource facts, deterministically:
 *
 *   - requires integrity (missing target, self-dependency)     → error
 *   - requires cycles (ordering/propagation undefined)         → error
 *   - voltage domain vs each requires neighbour                → warning
 *   - consumer voltage vs the rail it declares                 → warning
 *   - power budget: rail draw vs declared budget (§6's example:
 *     "power budget node sums draw from every leaf and checks
 *     against the chosen supply node")                         → error
 *   - lineage integrity (dangling `spawned` target)            → warning
 *   - §6a allocator that could not resolve its contention      → error
 *
 * `known_uncertainty` is NEVER consulted here — it is a disclosure, not a
 * defect, and never blocks validation (§6).
 */
export function runSpecValidationPass(nodes: Record<string, SpecNode>): void {
  const cycleNodes = findRequiresCycleNodes(nodes);
  const rails = auditRails(nodes);
  const cycleList = [...cycleNodes].sort().join(' → ');

  for (const node of Object.values(nodes)) {
    const issues: SpecValidationIssue[] = [];

    if (node.requires.includes(node.id)) {
      issues.push({
        severity: 'error',
        message: `${node.id} lists itself in requires — a self-dependency can never resolve.`,
      });
    }

    for (const reqId of node.requires) {
      const parent = nodes[reqId];
      if (!parent) {
        issues.push({ severity: 'error', message: `Missing required upstream node: ${reqId}` });
        continue;
      }
      const childV = numberFromSpec(node.spec['voltage_v']);
      const parentV = numberFromSpec(parent.spec['voltage_v']);
      if (childV !== undefined && parentV !== undefined && childV > parentV * 1.5) {
        issues.push({
          severity: 'warning',
          message: `Voltage domain mismatch: ${node.id} (${childV} V) draws above supply ${parent.id} (${parentV} V).`,
        });
      }
    }

    if (cycleNodes.has(node.id)) {
      issues.push({
        severity: 'error',
        message: `${node.id} sits in a requires cycle (${cycleList}) — resolution order and dirty propagation are undefined for a cycle.`,
      });
    }

    for (const childId of node.spawned) {
      if (!nodes[childId]) {
        issues.push({
          severity: 'warning',
          message: `Lineage edge points at a node that does not exist: spawned → ${childId}.`,
        });
      }
    }

    const rail = railName(node.spec[SHARED_RESOURCE_KEYS.supplyRail]);
    if (rail) {
      const entry = rails.get(rail);
      if (entry) {
        const nodeV = numberFromSpec(node.spec['voltage_v']);
        if (nodeV !== undefined && entry.voltage !== undefined && Math.abs(nodeV - entry.voltage) > 0.3) {
          issues.push({
            severity: 'warning',
            message: `Voltage mismatch: ${node.id} runs at ${nodeV} V but declares rail "${rail}" (${entry.voltage} V).`,
          });
        }
        // The budget error is attached once per rail, to its strongest
        // declared supplier — that is the node accountable for the budget.
        const owner = [...entry.suppliers].sort(
          (a, b) => b.budget - a.budget || a.node.id.localeCompare(b.node.id),
        )[0];
        if (owner && owner.node.id === node.id && entry.draw > entry.budget) {
          issues.push({
            severity: 'error',
            message: `Power budget overrun: rail "${rail}" draws ${Math.round(entry.draw)} mA against a ${entry.budget} mA budget.`,
          });
        }
      }
    }

    if (node.spec['resolution_status'] === 'unresolvable') {
      issues.push({
        severity: 'error',
        message: `Unresolvable shared-resource conflict: ${String(node.spec['resolution_blocker'] ?? 'see this node\'s spec')}`,
      });
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

// ── Shared-resource contention (§6a) ────────────────────────────────────────

type ContentionResolution =
  | {
      status: 'resolved';
      moves: ResourceMove[];
      summary: string;
      mux?: { part_class: string; i2c_address: string };
    }
  | {
      status: 'unresolvable';
      moves: ResourceMove[];
      blocker: string;
    };

/**
 * Every I2C address anyone has a claim on, mapped to the set of claiming node
 * ids — primary addresses, strappable alternates, and allocator multiplexers.
 * Provenance matters: an address is free for contender C iff nobody OTHER than
 * C claims it (C's own strapping options are options, not occupied addresses).
 */
function i2cAddressClaimants(nodes: Record<string, SpecNode>): Map<string, Set<string>> {
  const claims = new Map<string, Set<string>>();
  const claim = (address: string, claimant: string): void => {
    const hex = address.trim().toLowerCase();
    if (!hex) return;
    const set = claims.get(hex) ?? new Set<string>();
    set.add(claimant);
    claims.set(hex, set);
  };
  for (const node of Object.values(nodes)) {
    for (const address of stringSet(node.spec[SHARED_RESOURCE_KEYS.i2cAddress])) {
      claim(address, node.id);
    }
    for (const alt of stringSet(node.spec[SHARED_RESOURCE_KEYS.i2cAddressAlt])) {
      claim(alt, node.id);
    }
    const mux = node.spec['mux'];
    if (mux !== null && typeof mux === 'object' && !Array.isArray(mux)) {
      const address = (mux as Record<string, unknown>)['i2c_address'];
      if (typeof address === 'string') claim(address, `mux:${node.id}`);
    }
  }
  return claims;
}

/**
 * First free I2C address for `forNode`. With `acceptable`, only addresses the
 * part actually supports are considered. The multiplexer address is reserved
 * and never handed to a device.
 */
function firstFreeI2cAddress(
  claims: Map<string, Set<string>>,
  forNode: string,
  acceptable?: string[],
): string | null {
  const freeFor = (hex: string): boolean => {
    if (!hex || hex === I2C_MUX_ADDRESS) return false;
    const claimants = claims.get(hex);
    if (!claimants || claimants.size === 0) return true;
    // Only the contender's own strapping options may overlap its own claims.
    return claimants.size === 1 && claimants.has(forNode);
  };
  if (acceptable && acceptable.length > 0) {
    for (const candidate of acceptable) {
      const hex = candidate.trim().toLowerCase();
      if (freeFor(hex)) return hex;
    }
    return null;
  }
  for (let address = 0x08; address <= 0x77; address += 1) {
    const hex = `0x${address.toString(16).padStart(2, '0')}`;
    if (freeFor(hex)) return hex;
  }
  return null;
}

const NUMBERED_RESOURCE_MAX = 63;

/** "d2" → {prefix:"d", number:2}; "uart1" → {prefix:"uart", number:1}. */
function parseNumberedIdentity(identity: string): { prefix: string; number: number } | null {
  const match = /^(.*?)(\d+)$/.exec(identity.trim().toLowerCase());
  if (!match || !match[1]) return null;
  return { prefix: match[1], number: Number(match[2]) };
}

function firstFreeNumberedIdentity(
  nodes: Record<string, SpecNode>,
  key: string,
  identity: string,
): string | null {
  const parsed = parseNumberedIdentity(identity);
  if (!parsed) return null;
  const claimed = new Set<string>();
  for (const node of Object.values(nodes)) {
    for (const value of stringSet(node.spec[key])) {
      if (value.startsWith(parsed.prefix)) claimed.add(value);
    }
  }
  for (let number = 0; number <= NUMBERED_RESOURCE_MAX; number += 1) {
    const candidate = `${parsed.prefix}${number}`;
    if (!claimed.has(candidate)) return candidate;
  }
  return null;
}

/** Apply an identity re-assignment to a node's spec (array-aware for gpio_pins). */
function applyIdentityMove(node: SpecNode, key: string, from: string, to: string): void {
  const current = node.spec[key];
  if (Array.isArray(current)) {
    node.spec = {
      ...node.spec,
      [key]: current.map((entry) =>
        typeof entry === 'string' && entry.trim().toLowerCase() === from ? to : entry,
      ),
    };
  } else {
    node.spec = { ...node.spec, [key]: to };
  }
  if (node.status !== 'user_confirmed') node.status = 'needs_revalidation';
}

/**
 * Resolve an identity collision (same non-negotiable address/pin/channel).
 * Deterministic priority: re-map a configurable contender to an address it
 * actually supports → insert a multiplexer at the reserved address → for
 * numbered resources, re-assign to the first free identity in the same family.
 * The lowest-sorted contender always keeps the contested identity. When every
 * remaining contender can be re-sitted the conflict is resolved; otherwise it
 * is genuinely unresolvable at spec level and the caller records a blocker.
 */
function resolveIdentityContention(
  nodes: Record<string, SpecNode>,
  pool: string,
  key: string,
  identity: string,
  owners: SpecNode[],
): ContentionResolution {
  const ordered = [...owners].sort((a, b) => a.id.localeCompare(b.id));
  const keeper = ordered[0];
  const rest = ordered.slice(1);
  if (!keeper || rest.length === 0) {
    return { status: 'unresolvable', moves: [], blocker: `${pool} "${identity}" collides` };
  }
  const moves: ResourceMove[] = [];

  if (pool === 'i2c-address') {
    const claims = i2cAddressClaimants(nodes);
    for (const contender of rest) {
      const alternates = [...stringSet(contender.spec[SHARED_RESOURCE_KEYS.i2cAddressAlt])];
      const configurable = contender.spec[SHARED_RESOURCE_KEYS.addressConfigurable] === true;
      if (alternates.length === 0 && !configurable) continue;
      const free = firstFreeI2cAddress(claims, contender.id, alternates.length > 0 ? alternates : undefined);
      if (free === null) continue;
      const previous =
        typeof contender.spec[SHARED_RESOURCE_KEYS.i2cAddress] === 'string'
          ? railName(contender.spec[SHARED_RESOURCE_KEYS.i2cAddress])
          : identity;
      contender.spec = {
        ...contender.spec,
        [SHARED_RESOURCE_KEYS.i2cAddress]: free,
        i2c_address_previous: previous,
      };
      if (contender.status !== 'user_confirmed') contender.status = 'needs_revalidation';
      const claimants = claims.get(free) ?? new Set<string>();
      claimants.add(contender.id); // later contenders can't be handed the same address
      claims.set(free, claimants);
      moves.push({
        node_id: contender.id,
        field: SHARED_RESOURCE_KEYS.i2cAddress,
        from: previous,
        to: free,
      });
    }
    if (moves.length === rest.length) {
      const target = moves.map((move) => `${move.node_id} → ${move.to}`).join(', ');
      return {
        status: 'resolved',
        moves,
        summary: `re-mapped ${target} (${keeper.id} keeps ${identity}); every moved part declares the strapping options used`,
      };
    }
    // Nobody (left) is configurable — a multiplexer at the reserved address is
    // the standard fix, but only if that address is genuinely free.
    const muxClaimants = claims.get(I2C_MUX_ADDRESS);
    if (!muxClaimants || muxClaimants.size === 0) {
      return {
        status: 'resolved',
        moves,
        summary: `inserted an I2C multiplexer (TCA9548A class) at ${I2C_MUX_ADDRESS} so the fixed-address devices keep ${identity} on isolated bus segments`,
        mux: { part_class: 'TCA9548A', i2c_address: I2C_MUX_ADDRESS },
      };
    }
    return {
      status: 'unresolvable',
      moves,
      blocker: `fixed I2C address collision on ${identity} with no configurable contender and the multiplexer address ${I2C_MUX_ADDRESS} already occupied`,
    };
  }

  // gpio-pin / spi-cs / uart / rf / dma / irq — numbered identity families.
  for (const contender of rest) {
    const free = firstFreeNumberedIdentity(nodes, key, identity);
    if (free === null) {
      return {
        status: 'unresolvable',
        moves,
        blocker: `${pool} "${identity}" collides and no free ${pool} exists in the same family for ${contender.id}`,
      };
    }
    applyIdentityMove(contender, key, identity, free);
    moves.push({ node_id: contender.id, field: key, from: identity, to: free });
  }
  if (moves.length === rest.length) {
    const target = moves.map((move) => `${move.node_id} → ${move.to}`).join(', ');
    return {
      status: 'resolved',
      moves,
      summary: `re-assigned ${target} (${keeper.id} keeps ${identity})`,
    };
  }
  return { status: 'unresolvable', moves, blocker: `${pool} "${identity}" collides` };
}

/**
 * Resolve a power-rail overload by moving the smallest loads first onto rails
 * that (a) have a declared budget with headroom and (b) are voltage-compatible
 * with the load. Every move is applied to the node's spec and recorded. If the
 * rail is still over budget after every possible move, the contention is
 * genuinely unresolvable at spec level and must block handoff.
 */
function resolveRailOverload(
  entry: RailAuditEntry,
  allRails: Map<string, RailAuditEntry>,
): ContentionResolution {
  const moves: ResourceMove[] = [];
  let remaining = entry.draw;
  const movable = [...entry.consumers].sort(
    (a, b) => a.draw - b.draw || a.node.id.localeCompare(b.node.id),
  );

  for (const consumer of movable) {
    if (remaining <= entry.budget) break;
    const consumerV = numberFromSpec(consumer.node.spec['voltage_v']);
    const target = [...allRails.values()]
      .filter((other) => other.rail !== entry.rail && other.suppliers.length > 0)
      .map((other) => ({ rail: other, headroom: other.budget - other.draw }))
      .filter((candidate) => candidate.headroom >= consumer.draw)
      .filter((candidate) => {
        if (consumerV === undefined || candidate.rail.voltage === undefined) return true;
        return Math.abs(consumerV - candidate.rail.voltage) <= 0.3;
      })
      .sort((a, b) => b.headroom - a.headroom || a.rail.rail.localeCompare(b.rail.rail))[0];
    if (!target) continue; // this load cannot move — try the next one
    consumer.node.spec = {
      ...consumer.node.spec,
      [SHARED_RESOURCE_KEYS.supplyRail]: target.rail.rail,
    };
    if (consumer.node.status !== 'user_confirmed') consumer.node.status = 'needs_revalidation';
    target.rail.draw += consumer.draw;
    remaining -= consumer.draw;
    moves.push({
      node_id: consumer.node.id,
      field: SHARED_RESOURCE_KEYS.supplyRail,
      from: entry.rail,
      to: target.rail.rail,
    });
  }

  if (remaining <= entry.budget) {
    return {
      status: 'resolved',
      moves,
      summary: `re-balanced rail "${entry.rail}" by moving ${moves.length} load(s) (${moves
        .map((move) => `${move.node_id} → ${move.to}`)
        .join(', ')}) onto rails with declared headroom`,
    };
  }
  return {
    status: 'unresolvable',
    moves,
    blocker: `combined draw ${Math.round(remaining)} mA on rail "${entry.rail}" exceeds the ${entry.budget} mA budget and no voltage-compatible rail has headroom`,
  };
}

function nextAllocatorId(nodes: Record<string, SpecNode>): string {
  let max = 0;
  for (const node of Object.values(nodes)) {
    const match = /^node_resource_allocation_(\d+)$/.exec(node.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `node_resource_allocation_${String(max + 1).padStart(2, '0')}`;
}

interface ContentionParams {
  pool: string;
  identity: string;
  contenders: string[];
  reason: string;
  resolve: () => ContentionResolution;
}

/**
 * Spawn (or reuse) the generalized `resource_allocation` node for one
 * contention. Idempotent by contention signature — re-running detection after
 * user answers neither duplicates allocator nodes nor duplicates assumptions.
 * Lineage: the allocator is spawned by the cross-node validation pass, not by
 * any single device node, so its `spawned` list is empty and its spec records
 * `spawned_by: 'cross-node-validation'`.
 */
function spawnResourceAllocator(nodes: Record<string, SpecNode>, params: ContentionParams): void {
  if (params.contenders.length < 2) return;

  const signature = `${params.pool}|${params.identity}|${[...params.contenders].sort().join('+')}`;
  const existing = Object.values(nodes).some(
    (node) => node.domain === 'resource_allocation' && node.spec['contention_key'] === signature,
  );
  if (existing) return; // already allocated on a previous pass — idempotent

  const resolution = params.resolve();
  const id = nextAllocatorId(nodes);

  const spec: Record<string, unknown> = {
    shared_resource: params.pool,
    identity: params.identity,
    contention: params.reason,
    contention_key: signature,
    contenders: params.contenders,
    resolution_status: resolution.status,
    spawned_by: 'cross-node-validation',
  };
  if (resolution.status === 'resolved') {
    spec['resolution'] = resolution.summary;
    spec['moves'] = resolution.moves;
    if (resolution.mux) spec['mux'] = resolution.mux;
  } else {
    spec['resolution_blocker'] = resolution.blocker;
    if (resolution.moves.length > 0) spec['moves'] = resolution.moves;
  }

  nodes[id] = {
    id,
    domain: 'resource_allocation',
    title: `Shared-Resource Allocator — ${params.pool}`,
    status: resolution.status === 'resolved' ? 'assumed' : 'unresolved',
    spec,
    requires: params.contenders,
    spawned: [],
    assumptions:
      resolution.status === 'resolved'
        ? [
            {
              claim: resolution.summary,
              why: `${params.reason}. The conflict only exists as a relationship between ${params.contenders.join(', ')} — no single node owns it, so the cross-node validation pass spawned this allocator and resolved it deterministically.`,
            },
          ]
        : [],
    open_questions: [], // §6a: never asked — constraint-solving, not a user fork
    known_uncertainty: [],
    validation: { checked: false, issues: [] },
  };
}

/**
 * §6a — shared-resource contention detection.
 *
 * A `resource_allocation` node is spawned ONLY when ≥2 resolved nodes draw
 * from the same finite shared resource pool AND one of:
 *   - a fixed/non-negotiable identity within that pool collides,
 *   - combined demand can exceed the pool's declared capacity,
 *   - resolving the conflict requires a decision the individual nodes can't
 *     make on their own (who moves, who yields).
 * Two devices that merely share a bus/pool without colliding produce NO node —
 * that is just wiring, resolved inline in each device's own node.
 *
 * The allocator then genuinely resolves the conflict when a deterministic
 * resolution exists (re-map / multiplexer / re-assign / re-balance), recording
 * every move; when none exists, its `resolution_status: 'unresolvable'` makes
 * runSpecValidationPass raise a BLOCKING issue instead of silently shipping a
 * broken wiring diagram.
 */
export function detectResourceContention(nodes: Record<string, SpecNode>): void {
  // ── Identity pools ────────────────────────────────────────────────────────
  const pools = new Map<string, { pool: string; key: string; identity: string; owners: SpecNode[] }>();
  const addPool = (pool: string, key: string, identity: string, node: SpecNode): void => {
    if (!identity) return;
    const mapKey = `${pool}:${identity}`;
    const entry = pools.get(mapKey) ?? { pool, key, identity, owners: [] };
    entry.owners.push(node);
    pools.set(mapKey, entry);
  };

  for (const node of Object.values(nodes)) {
    if (node.domain === 'resource_allocation') continue; // allocators arbitrate, they don't consume
    for (const address of stringSet(node.spec[SHARED_RESOURCE_KEYS.i2cAddress])) {
      addPool('i2c-address', SHARED_RESOURCE_KEYS.i2cAddress, address, node);
    }
    for (const cs of stringSet(node.spec[SHARED_RESOURCE_KEYS.spiChipSelect])) {
      addPool('spi-cs', SHARED_RESOURCE_KEYS.spiChipSelect, cs, node);
    }
    for (const pin of stringSet(node.spec[SHARED_RESOURCE_KEYS.gpioPins])) {
      addPool('gpio-pin', SHARED_RESOURCE_KEYS.gpioPins, pin, node);
    }
    for (const channel of stringSet(node.spec[SHARED_RESOURCE_KEYS.uartChannel])) {
      addPool('uart-channel', SHARED_RESOURCE_KEYS.uartChannel, channel, node);
    }
    for (const channel of stringSet(node.spec[SHARED_RESOURCE_KEYS.rfChannel])) {
      addPool('rf-channel', SHARED_RESOURCE_KEYS.rfChannel, channel, node);
    }
    for (const channel of stringSet(node.spec[SHARED_RESOURCE_KEYS.dmaChannel])) {
      addPool('dma-channel', SHARED_RESOURCE_KEYS.dmaChannel, channel, node);
    }
    for (const line of stringSet(node.spec[SHARED_RESOURCE_KEYS.irqLine])) {
      addPool('irq-line', SHARED_RESOURCE_KEYS.irqLine, line, node);
    }
  }

  for (const entry of pools.values()) {
    const unique = entry.owners.filter(
      (node, index) => entry.owners.findIndex((other) => other.id === node.id) === index,
    );
    if (unique.length < 2) continue;
    spawnResourceAllocator(nodes, {
      pool: entry.pool,
      identity: entry.identity,
      contenders: unique.map((node) => node.id),
      reason: `${unique.length} nodes collide on ${entry.pool} "${entry.identity}" (non-negotiable identity)`,
      resolve: () => resolveIdentityContention(nodes, entry.pool, entry.key, entry.identity, unique),
    });
  }

  // ── Bus bandwidth ─────────────────────────────────────────────────────────
  const buses = new Map<string, { bus: string; load: number; owners: SpecNode[] }>();
  for (const node of Object.values(nodes)) {
    if (node.domain === 'resource_allocation') continue;
    const bus = railName(node.spec[SHARED_RESOURCE_KEYS.busId]);
    if (!bus) continue;
    const entry = buses.get(bus) ?? { bus, load: 0, owners: [] };
    entry.load += numberFromSpec(node.spec[SHARED_RESOURCE_KEYS.busBandwidthPct]) ?? 0;
    entry.owners.push(node);
    buses.set(bus, entry);
  }
  for (const entry of buses.values()) {
    const unique = entry.owners.filter(
      (node, index) => entry.owners.findIndex((other) => other.id === node.id) === index,
    );
    if (entry.load <= 100 || unique.length < 2) continue;
    spawnResourceAllocator(nodes, {
      pool: 'bus-bandwidth',
      identity: entry.bus,
      contenders: unique.map((node) => node.id),
      reason: `combined bus bandwidth ${Math.round(entry.load)}% of "${entry.bus}" exceeds 100%`,
      resolve: () => ({
        status: 'unresolvable',
        moves: [],
        blocker: `combined bus bandwidth ${Math.round(entry.load)}% of "${entry.bus}" exceeds 100% — which consumer yields (sample rate, resolution) is a trade-off no individual node can decide on its own, and no silent default exists`,
      }),
    });
  }

  // ── Power rails ───────────────────────────────────────────────────────────
  const rails = auditRails(nodes);
  for (const entry of rails.values()) {
    if (entry.suppliers.length === 0) continue;
    if (entry.draw <= entry.budget) continue;
    const contenders = [
      ...entry.consumers.map((consumer) => consumer.node.id),
      ...entry.suppliers.map((supplier) => supplier.node.id),
    ];
    spawnResourceAllocator(nodes, {
      pool: 'power-rail',
      identity: entry.rail,
      contenders,
      reason: `combined ${Math.round(entry.draw)} mA on rail "${entry.rail}" exceeds the ${entry.budget} mA budget`,
      resolve: () => resolveRailOverload(entry, rails),
    });
  }
}

// ── Deterministic finalisation ──────────────────────────────────────────────

/**
 * Normalise raw node objects (LLM output, a rehydrated client payload, or a
 * stale persisted graph) into fully-defaulted SpecNodes.
 *
 * `specNodeSchema` is null-tolerant by design — it turns a missing/blank
 * `requires`/`spawned`/`assumptions`/`open_questions`/`known_uncertainty`
 * into an empty array — so this is what guarantees every node has the arrays
 * the UI and the deterministic passes iterate over. Nodes that somehow cannot
 * be normalised are rebuilt with safe defaults instead of crashing the graph.
 * The record KEY wins over any inner `id` — every `requires`/`spawned`/queue
 * pointer references the key, so the key is the node's identity.
 */
function normaliseSpecNodes(nodes: unknown): Record<string, SpecNode> {
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) return {};

  const result: Record<string, SpecNode> = {};
  for (const [id, value] of Object.entries(nodes as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const parsed = specNodeSchema.safeParse({ ...(value as object), id });
    result[id] = parsed.success
      ? parsed.data
      : specNodeSchema.parse({
          id,
          domain: 'general',
          title: 'Component',
          status: 'unresolved',
        });
  }
  return result;
}

/**
 * Project-level status must agree with the §7 handoff gate, not just with the
 * question queue: a graph with no open questions but a blocking validation
 * issue (unresolvable contention, requires cycle, rail overrun) is NOT
 * ready_for_build — it is 'blocked', and the UI shows why on the node.
 */
function projectStatusFor(
  queue: SpecQuestionPointer[],
  nodes: Record<string, SpecNode>,
): 'awaiting_user' | 'blocked' | 'ready_for_build' {
  if (queue.length > 0) return 'awaiting_user';
  const clean = Object.values(nodes).every(
    (node) =>
      node.status !== 'unresolved' &&
      node.status !== 'needs_revalidation' &&
      !node.validation.issues.some((issue) => issue.severity === 'error'),
  );
  return clean ? 'ready_for_build' : 'blocked';
}

function branchesOf(nodes: Record<string, SpecNode>): SpecGraphProject['branches'] {
  return Object.values(nodes).map((node) => ({ id: node.id, domain: node.domain, status: node.status }));
}

/** Deterministic finalisation: unique question ids, §6a contention, §6 validation, pointer queues. */
export function finalizeSpecGraph(graph: SpecGraphProject): SpecGraphProject {
  // Raw LLM output / stale payloads become fully-defaulted nodes first — every
  // array the passes below iterate over is guaranteed to exist.
  const nodes = normaliseSpecNodes(graph.nodes ?? {});

  normaliseQuestionIds(nodes);
  detectResourceContention(nodes);
  runSpecValidationPass(nodes);

  const questionQueue = collectQuestionQueue(nodes);

  return {
    ...graph,
    project_id: graph.project_id || `proj_${slugify(graph.title).slice(0, 24) || 'system'}`,
    nodes,
    branches: branchesOf(nodes),
    question_queue: questionQueue,
    assumption_log: buildAssumptionLog(nodes),
    status: projectStatusFor(questionQueue, nodes),
  };
}

// ── Answer application + dirty propagation (§5/§6) ──────────────────────────

/**
 * Match an answer key to a question EXACTLY — by question id first, then by
 * the verbatim question text. Substring matching misroutes answers (a key that
 * happens to appear inside another question's text) and is never used.
 */
function matchQuestion(node: SpecNode, key: string): SpecQuestion | undefined {
  return node.open_questions.find(
    (question) => (question.id !== undefined && question.id === key) || question.q === key,
  );
}

export function applyUserAnswersToSpecGraph(
  specGraph: SpecGraphProject,
  answers: Record<string, string>,
): SpecGraphProject {
  // Normalise AND copy in one pass: the /answer endpoint receives whatever the
  // client persisted (which may predate every normalisation pass), and parsing
  // produces fresh, fully-defaulted objects — so the caller's graph is never
  // mutated by an answer round either.
  const nodes: Record<string, SpecNode> = normaliseSpecNodes(specGraph.nodes ?? {});
  const changedNodeIds = new Set<string>();

  // 1. Write each answer into the node whose open question it answers, flip
  //    that node to user_confirmed, and record the decision as an assumption
  //    ON the node (so the pointer-based log picks it up like every other
  //    silent decision — the user can audit and override it later).
  for (const [key, rawValue] of Object.entries(answers)) {
    if (typeof rawValue !== 'string' || !rawValue.trim()) continue;
    const value = rawValue.trim();
    for (const node of Object.values(nodes)) {
      const question = matchQuestion(node, key);
      if (!question) continue;
      const specKey = question.id ?? key;
      node.spec = { ...node.spec, [specKey]: value };
      node.assumptions = [
        ...node.assumptions,
        { claim: `${specKey} = ${value}`, why: `User-confirmed answer to: ${question.q}` },
      ];
      node.open_questions = node.open_questions.filter((candidate) => candidate !== question);
      node.status = 'user_confirmed';
      changedNodeIds.add(node.id);
    }
  }

  // 2. Dirty propagation over the reverse `requires` graph ONLY (§6).
  //    `spawned` edges are lineage, never walked for propagation.
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

  // 3. New resource contention may emerge from the answers (§6a) — idempotent,
  //    so previously allocated contentions are neither re-spawned nor duplicated.
  detectResourceContention(nodes);

  // 4. Re-validate everything.
  runSpecValidationPass(nodes);

  // 5. Re-derive the (still-open) question queue and the assumption log.
  const questionQueue = collectQuestionQueue(nodes);

  return {
    ...specGraph,
    nodes,
    branches: branchesOf(nodes),
    question_queue: questionQueue,
    assumption_log: buildAssumptionLog(nodes),
    status: projectStatusFor(questionQueue, nodes),
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
 * Cycles are depth-capped at 0 so layout can never loop.
 */
function layoutSpecNodes(specGraph: SpecGraphProject): Map<string, { x: number; y: number }> {
  const entries = Object.values(specGraph.nodes);
  const positions = new Map<string, { x: number; y: number }>();

  const depth = new Map<string, number>();
  const computeDepth = (id: string, stack: Set<string>): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
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

  const columnGap = 300;
  const rowGap = 130;

  for (const layer of [...byDepth.keys()].sort((a, b) => a - b)) {
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

  // §2 pointers dereferenced for the twin's notes — resolved assumptions only.
  const notes: string[] = [];
  for (const pointer of buildAssumptionLog(specGraph.nodes)) {
    const assumption = specGraph.nodes[pointer.node_id]?.assumptions[pointer.index];
    if (assumption) notes.push(`[${pointer.node_id}] ${assumption.claim} (${assumption.why})`);
  }

  return {
    project: specGraph.title,
    summary: specGraph.raw_prompt,
    nodes,
    connections,
    dependencies: [],
    software: [],
    notes,
  };
}

// ── File-based persistence (design doc §2) ──────────────────────────────────
// Root manifest never holds full content; each node is its own file so the
// AI can load one branch + its `requires` neighbours, not the whole graph.

export function saveSpecGraphToDisk(specGraph: SpecGraphProject, targetDir: string): void {
  fs.mkdirSync(path.join(targetDir, 'nodes'), { recursive: true });

  const manifest = {
    format: 'wireup-spec-graph',
    version: 1,
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

    // §2's tractability rule in action: load the branch plus its DIRECT
    // `requires` neighbours only — never the whole graph. (`spawned` is
    // lineage and never loads data.)
    for (const reqId of mainNode.requires) {
      const reqPath = path.join(projectDir, 'nodes', `${reqId}.json`);
      if (fs.existsSync(reqPath)) {
        branchNodes[reqId] = JSON.parse(fs.readFileSync(reqPath, 'utf-8')) as SpecNode;
      }
    }
  }
  return { manifest, branchNodes };
}
