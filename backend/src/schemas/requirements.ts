import { z } from 'zod';

/**
 * The intent contract — the shared artifact between human and AI.
 *
 * It is produced by the interpret pass, edited by the human, and then treated
 * as a hard constraint by the planner. Anything the graph violates here is a
 * deterministic conformance failure, not a matter of opinion.
 */

export const questionKindSchema = z.enum(['single', 'multi', 'number', 'boolean']);

export const questionSchema = z.object({
  id: z.string().min(1),
  /** What the human is actually asked. */
  prompt: z.string().min(1),
  /** Why the AI cannot decide this itself. Shown as the justification. */
  why: z.string().default(''),
  /** What changes depending on the answer. */
  impact: z.string().default(''),
  kind: questionKindSchema.catch('single'),
  options: z
    .array(z.object({ value: z.string(), label: z.string(), hint: z.string().default('') }))
    .default([]),
  /** Always populated so the human can accept with one click. */
  default: z.string().default(''),
  unit: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

/**
 * LLMs signal "not applicable" with 0 or null, not by omitting the key —
 * legCount: 0 on a sensor node is correct behaviour, not an error.
 *
 * Every optional numeric requirement therefore funnels through these, which
 * map 0 / null / "" / non-numeric to undefined. Absent means "no constraint",
 * which is exactly what the rules engine expects.
 */
const optionalPositiveNumber = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === '') return undefined;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) && num > 0 ? num : undefined;
  },
  z.number().positive().optional(),
);

const optionalPositiveInt = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === '') return undefined;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) && num > 0 ? Math.round(num) : undefined;
  },
  z.number().int().positive().optional(),
);

/** Null-safe optional text with a fallback. */
const textWithFallback = (fallback: string) =>
  z
    .string()
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : fallback;
    });

export const mechanicalRequirementsSchema = z.object({
  mobility: z.enum(['static', 'wheeled', 'legged', 'flying', 'other']).optional().catch(undefined),
  legCount: optionalPositiveInt,
  /** Below 2 a leg can swivel but cannot lift, so the gait degenerates. */
  minDofPerLeg: optionalPositiveNumber,
  gait: z.string().nullish().transform((value) => value?.trim() || undefined),
  payloadGrams: optionalPositiveNumber,
  legLengthCm: optionalPositiveNumber,
});

export const powerRequirementsSchema = z.object({
  source: z.enum(['battery', 'mains', 'usb', 'solar', 'other']).optional().catch(undefined),
  rechargeable: z.preprocess(
    (value) => {
      if (value === null || value === undefined || value === '') return undefined;
      return value === true || value === 'true';
    },
    z.boolean().optional(),
  ),
  targetRuntimeMinutes: optionalPositiveNumber,
});

export const requirementsSpecSchema = z.object({
  project: textWithFallback('Untitled hardware system'),
  /** One paragraph: what the AI believes the human wants. */
  intent: textWithFallback(''),
  domain: textWithFallback('general'),
  mechanical: mechanicalRequirementsSchema.nullish().transform((value) => value ?? {}),
  power: powerRequirementsSchema.nullish().transform((value) => value ?? {}),
  /** Escape hatch for anything domain specific. */
  constraints: z
    .record(z.string(), z.unknown())
    .nullish()
    .transform((value) => value ?? {}),
  /** Decisions the AI made on the human's behalf. Shown for override. */
  assumptions: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
});

export const interpretBodySchema = z.object({
  brief: z.string().trim().min(1, 'A brief is required.'),
  /** Answers to a previous round of questions, keyed by question id. */
  answers: z.record(z.string(), z.string()).default({}),
  priorRequirements: requirementsSpecSchema.optional(),
  priorQuestions: z.array(questionSchema).default([]),
  /** Human feedback from the confirmation loop, oldest first. */
  feedback: z.array(z.string()).default([]),
  graph: z.unknown().optional(),
});

export const interpretResponseSchema = z.object({
  requirements: requirementsSpecSchema,
  /** At most 5. Empty when the AI can decide everything. */
  questions: z.array(questionSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  /** True when no blocking questions remain and planning can start. */
  ready: z.boolean().default(false),
});

export type Question = z.infer<typeof questionSchema>;
export type RequirementsSpec = z.infer<typeof requirementsSpecSchema>;
export type InterpretResponse = z.infer<typeof interpretResponseSchema>;