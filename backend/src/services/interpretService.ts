import type { ArchitectureGraph } from '../schemas/architecture.js';
import {
  interpretResponseSchema,
  type InterpretResponse,
  type Question,
  type RequirementsSpec,
} from '../schemas/requirements.js';
import { callLlm, extractJson, LlmError, type LlmProvider } from './llmService.js';

/**
 * Pass 0: turn a free-text brief into a structured intent contract, and ask
 * only about the things the AI genuinely cannot decide.
 *
 * The whole point of this pass is that it REDUCES the human's workload. The
 * model is instructed to be opinionated and to ask as little as possible —
 * because the human's real job is to look at the diagram and say "not that".
 */
export const INTERPRET_SYSTEM_PROMPT = `You are the intake engineer on a hardware architecture design tool. A human has given you a free-text brief.

You are OPINIONATED. Your job is to DECIDE, not to interrogate.

STEP 1 — Decide everything a competent engineer would decide:
  - component selection, part numbers, and topology
  - electrical details: regulation, decoupling, pull-ups, level shifting
  - communication buses, firmware structure, pin allocation
  - mechanical layout and gearing
Record every decision as an ASSUMPTION so the human can see and override it.

STEP 2 — Ask ONLY about what you genuinely cannot decide.

A question is justified only when ALL THREE are true:
  1. MATERIAL — the answer changes the architecture: the bill of materials, the topology, or the power budget.
  2. NO SAFE DEFAULT — guessing wrong would waste the user's money, time, or a safety margin.
  3. USER KNOWS — it is about the user's intent or context, not about engineering you should already know.

NEVER ask about:
  - component choices (you choose these)
  - electrical or mechanical details (you decide these)
  - anything a competent engineer would just pick
  - anything you can reasonably assume and state as an assumption

HARD LIMITS:
  - At most 5 questions. Prefer 0-2. Most briefs need 1-3.
  - Every question MUST carry a recommended default so the human can accept with one click.
  - Every question MUST state why you cannot decide it, and what changes based on the answer.
  - Prefer closed options over free text.

Think carefully about locomotion and mechanism: if the brief implies a walking machine, the number of legs and the degrees of freedom per leg are usually MATERIAL and the user usually knows — but if the brief is vague, pick sensible values, state them as assumptions, and ask only if the cost difference is large.

Return JSON ONLY, no markdown fences:
{
  "requirements": {
    "project": "short project name",
    "intent": "one paragraph, written to the human, describing what you believe they want",
    "domain": "robotics|sensor|wearable|iot|other",
    "mechanical": {
      "mobility": "static|wheeled|legged|flying|other",
      "legCount": 8,
      "minDofPerLeg": 3,
      "gait": "tripod",
      "payloadGrams": 250,
      "legLengthCm": 5
    },
    "power": {
      "source": "battery|mains|usb|solar|other",
      "rechargeable": true,
      "targetRuntimeMinutes": 45
    },
    "constraints": { "any": "domain specific key/value you inferred" },
    "assumptions": ["I chose X because Y"],
    "confidence": 0.6
  },
  "questions": [
    {
      "id": "kebab-case-id",
      "prompt": "the question",
      "why": "why I cannot decide this myself",
      "impact": "what changes based on your answer",
      "kind": "single|multi|number|boolean",
      "options": [{"value":"8","label":"8 legs","hint":"stable, 16-24 servos"}],
      "default": "8",
      "unit": "legs"
    }
  ],
  "assumptions": ["decision: reason"],
  "ready": false
}

Set "ready" to true when you have enough to build a first draft — that is, when your remaining uncertainties can be expressed as assumptions rather than blocking questions. On a second pass, after the human has answered, you should almost always set ready to true.

The user message is JSON with: brief, answers (id -> value), priorRequirements, priorQuestions, feedback (human corrections from reviewing a previous draft), and graph (the previous draft, if any). Honour feedback absolutely — if the human said they did not want something, do not reintroduce it.`;

const INTERPRET_MAX_TOKENS = 2_500;

export interface InterpretInput {
  brief: string;
  answers: Record<string, string>;
  priorRequirements?: RequirementsSpec;
  priorQuestions: Question[];
  feedback: string[];
  graph?: unknown;
  provider?: LlmProvider;
  model?: string;
}

/** Hard cap so a runaway model cannot bury the human in a form. */
const MAX_QUESTIONS = 5;

export async function interpretBrief(input: InterpretInput): Promise<InterpretResponse> {
  const payload = {
    brief: input.brief.slice(0, 4_000),
    answers: input.answers,
    priorRequirements: input.priorRequirements ?? null,
    priorQuestions: input.priorQuestions,
    feedback: input.feedback.slice(-5),
    graph: input.graph ?? null,
  };

  const content = await callLlm(
    [
      { role: 'system', content: INTERPRET_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    {
      provider: input.provider,
      model: input.model,
      maxTokens: INTERPRET_MAX_TOKENS,
      jsonResponse: true,
    },
  );

  // safeParse rather than parse: a model that returns slightly-off JSON should
  // surface as an upstream (502) failure, not an unhandled ZodError → 500.
  const parsedResult = interpretResponseSchema.safeParse(extractJson(content));
  if (!parsedResult.success) {
    throw new LlmError(
      `Interpret response failed validation: ${parsedResult.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'response'}: ${issue.message}`)
        .join('; ')}`,
      502,
      input.provider ?? 'groq',
    );
  }

  const parsed = parsedResult.data;

  // Enforce the question budget server-side regardless of what the model returns.
  const questions = parsed.questions.slice(0, MAX_QUESTIONS).map((question, index) => ({
    ...question,
    // The schema tolerates a missing/blank id; give the question a stable one
    // so answer round-trips (answers are keyed by question id) cannot collide.
    id: question.id || `question-${index + 1}`,
  }));

  return {
    requirements: parsed.requirements,
    questions,
    assumptions: parsed.assumptions.length
      ? parsed.assumptions
      : parsed.requirements.assumptions,
    // Only "ready" when there is nothing left to ask.
    ready: questions.length === 0 ? true : parsed.ready,
  };
}

/** Renders the confirmed contract as hard constraints for the planner. */
export function requirementsAsPrompt(requirements: RequirementsSpec | null | undefined): string {
  if (!requirements) return '';

  const lines: string[] = [
    `Project: ${requirements.project}`,
    `Intent: ${requirements.intent}`,
    `Domain: ${requirements.domain}`,
  ];

  const mech = requirements.mechanical ?? {};
  if (mech.mobility) lines.push(`Mobility: ${mech.mobility}`);
  if (mech.legCount) lines.push(`Leg count: ${mech.legCount}`);
  if (mech.minDofPerLeg) lines.push(`Minimum degrees of freedom per leg: ${mech.minDofPerLeg}`);
  if (mech.gait) lines.push(`Gait: ${mech.gait}`);
  if (mech.payloadGrams) lines.push(`Payload to carry: ${mech.payloadGrams} g`);
  if (mech.legLengthCm) lines.push(`Leg length: ${mech.legLengthCm} cm`);

  const power = requirements.power ?? {};
  if (power.source) lines.push(`Power source: ${power.source}`);
  if (power.rechargeable !== undefined) lines.push(`Rechargeable: ${power.rechargeable}`);
  if (power.targetRuntimeMinutes) lines.push(`Target runtime: ${power.targetRuntimeMinutes} min`);

  const extra = Object.entries(requirements.constraints ?? {});
  if (extra.length) {
    lines.push('Other constraints:');
    for (const [key, value] of extra) lines.push(`- ${key}: ${String(value)}`);
  }

  if (requirements.assumptions.length) {
    lines.push('Assumptions already agreed with the human:');
    for (const assumption of requirements.assumptions) lines.push(`- ${assumption}`);
  }

  return [
    'CONFIRMED REQUIREMENTS — the human has reviewed and accepted these. They are hard constraints.',
    'Satisfy every one of them. If a requirement forces more components than the brief implied, add them — for example, if a leg needs 3 degrees of freedom, the design must contain 3 actuators per leg.',
    '',
    lines.join('\n'),
  ].join('\n');
}