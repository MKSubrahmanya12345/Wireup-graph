import { z } from 'zod';

/**
 * The intent contract — the shared artifact between human and AI.
 *
 * It is produced by the interpret pass, edited by the human, and then treated
 * as a hard constraint by the planner. Anything the graph violates here is a
 * deterministic conformance failure, not a matter of opinion.
 */

/**
 * Null-safe text.
 *
 * Bedrock models (Kimi, MiniMax, Nova…) signal "not applicable" with an
 * explicit `null` where other providers simply omit the key. Zod's
 * `.optional()` accepts undefined but REJECTS null, so every string field
 * that can come back from an LLM funnels through these helpers.
 *
 * A union with the fallback literal means a null (or any non-string) input
 * matches the second arm and normalises to the fallback, while valid strings
 * still get trimmed — all without losing the inferred output type.
 */
const optionalText = z
  .union([
    z
      .string()
      .trim()
      .transform((value) => (value ? value : undefined)),
    z.literal(null),
    z.undefined(),
  ])
  .transform((value) => (typeof value === 'string' ? value : undefined));

/** Null-safe text that always resolves to a (trimmed) string. */
const textWithFallback = (fallback: string) =>
  z
    .union([z.string(), z.literal(null), z.undefined()])
    .transform((value) => (typeof value === 'string' && value.trim() ? value.trim() : fallback));

/**
 * Null-safe optional number. LLMs emit 0/null/""/strings to mean "unknown";
 * null / "" / non-finite values map to undefined. Unlike the requirements-level
 * positive number preprocessors, this accepts 0 and negatives (e.g.
 * temperature ranges for sensor questions).
 */
const optionalNumber = z
  .union([z.number(), z.string(), z.literal(null), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === '') return undefined;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : undefined;
  });

/** Null-safe array: a non-array (null/object/string) becomes an empty list. */
const arrayOrEmpty = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .union([z.array(z.any()), z.literal(null), z.undefined()])
    .transform((value) => (Array.isArray(value) ? value : []))
    .pipe(z.array(schema))
    .default([]);

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

export const questionKindSchema = z.enum(['single', 'multi', 'number', 'boolean']);

const questionOptionSchema = z.object({
  value: textWithFallback(''),
  label: textWithFallback(''),
  hint: optionalText,
});

export const questionSchema = z.object({
  // Missing/blank ids are repaired in interpretService (stable slug per index).
  id: textWithFallback(''),
  /** What the human is actually asked. */
  prompt: textWithFallback(''),
  /** Why the AI cannot decide this itself. Shown as the justification. */
  why: textWithFallback(''),
  /** What changes depending on the answer. */
  impact: textWithFallback(''),
  kind: questionKindSchema.catch('single'),
  // Drop option entries that are not objects; the LLM occasionally emits
  // strings or nulls inside the options array.
  options: arrayOrEmpty(questionOptionSchema),
  /** Always populated so the human can accept with one click. */
  default: textWithFallback(''),
  unit: optionalText,
  min: optionalNumber,
  max: optionalNumber,
});

export const mechanicalRequirementsSchema = z.object({
  mobility: z.enum(['static', 'wheeled', 'legged', 'flying', 'other']).optional().catch(undefined),
  legCount: optionalPositiveInt,
  /** Below 2 a leg can swivel but cannot lift, so the gait degenerates. */
  minDofPerLeg: optionalPositiveNumber,
  gait: optionalText,
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

/** A list of strings the LLM may return with nulls/numbers mixed in. */
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
  assumptions: stringList,
  // Number(null) === 0, so coerce would silently turn a missing confidence
  // into "zero confidence"; normalise null/blank/out-of-range to 0.5 instead.
  confidence: z
    .union([z.number(), z.string(), z.literal(null), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined || value === '') return 0.5;
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) && num >= 0 && num <= 1 ? num : 0.5;
    }),
});

export const interpretBodySchema = z.object({
  brief: z.string().trim().min(1, 'A brief is required.'),
  /** Answers to a previous round of questions, keyed by question id. */
  answers: z
    .record(z.string(), z.string())
    .nullish()
    .transform((value) => value ?? {}),
  priorRequirements: requirementsSpecSchema.optional(),
  priorQuestions: arrayOrEmpty(questionSchema),
  /** Human feedback from the confirmation loop, oldest first. */
  feedback: stringList,
  graph: z.unknown().optional(),
});

export const interpretResponseSchema = z.object({
  // A missing/null requirements block would leave the planner with no
  // contract at all; recover with an empty contract rather than 500-ing.
  requirements: requirementsSpecSchema
    .nullish()
    .transform((value) => value ?? requirementsSpecSchema.parse({})),
  /** At most 5. Empty when the AI can decide everything. */
  questions: arrayOrEmpty(questionSchema),
  assumptions: stringList,
  /** True when no blocking questions remain and planning can start. */
  ready: z.boolean().catch(false),
  /**
   * The spec graph behind this interpretation — every node, the assumption
   * log, and the gate verdict on each question. Opaque to the schema on
   * purpose: it is the engine's artifact, rendered by the UI as a live graph.
   */
  specGraph: z.unknown().optional(),
});

export type Question = z.infer<typeof questionSchema>;
export type RequirementsSpec = z.infer<typeof requirementsSpecSchema>;
export type InterpretResponse = z.infer<typeof interpretResponseSchema>;
