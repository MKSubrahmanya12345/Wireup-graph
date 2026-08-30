import { z } from 'zod';

import { requirementsSpecSchema } from './requirements.js';
export { requirementsSpecSchema };
/**
 * The canonical graph contract shared by the planner prompt, the verifier,
 * MongoDB and the frontend. One definition, used everywhere — this is what
 * stops the server/client shapes from drifting apart across edit turns.
 */

export const NODE_TYPES = [
  'controller',
  'sensor',
  'actuator',
  'power',
  'interface',
  'passive',
  'communication',
  'software',
  'mechanical',
  'other',
] as const;

export const CONNECTION_KINDS = [
  'power',
  'ground',
  'data',
  'analog',
  'mechanical',
  'dependency',
  'other',
] as const;

export const PORT_DIRECTIONS = ['in', 'out', 'bidirectional'] as const;

export const SIGNAL_TYPES = [
  'power',
  'ground',
  'digital',
  'analog',
  'i2c',
  'spi',
  'uart',
  'pwm',
  'mechanical',
  'other',
] as const;

/**
 * Null-tolerant string field.
 *
 * Bedrock models (Kimi, MiniMax, Nova…) emit explicit `null` for fields that
 * don't apply, where other providers omit the key. Zod's `.default()` only
 * fires on `undefined`, so a null string field would otherwise fail the whole
 * parse. A union with the fallback value normalises null/non-string inputs
 * without losing the inferred output type.
 */
const optionalTextOrDefault = (fallback: string) =>
  z
    .union([z.string(), z.literal(null), z.undefined()])
    .transform((value) => (typeof value === 'string' && value.trim() ? value.trim() : fallback));

/** Null-tolerant optional string: null / non-string / blank → undefined. */
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

/** Null-tolerant string array: non-arrays become [], non-string entries drop. */
const stringArray = z
  .union([z.array(z.any()), z.literal(null), z.undefined()])
  .transform((value) => (Array.isArray(value) ? value : []))
  .transform((entries) =>
    entries
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .default([]);

/** Nullable text: a blank/non-string value normalises to null (the "none" sentinel). */
const nullableText = z
  .union([z.string(), z.literal(null), z.undefined()])
  .transform((value) => (typeof value === 'string' && value.trim() ? value.trim() : null));

/** Null-tolerant object array: non-arrays become [], null/non-object entries drop. */
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

const propertySchema = z.object({
  label: optionalTextOrDefault('property'),
  value: optionalTextOrDefault(''),
});

const portSchema = z.object({
  id: optionalTextOrDefault(''),
  label: optionalTextOrDefault(''),
  direction: z.enum(PORT_DIRECTIONS).catch('in'),
  signal: z.enum(SIGNAL_TYPES).catch('other'),
});


/** Required number with a fallback: null / "" / non-numeric → `fallback`. */
const numberWithDefault = (fallback: number) =>
  z
    .union([z.number(), z.string(), z.literal(null), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined || value === '') return fallback;
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) ? num : fallback;
    });

// 3-component vector: all fields preprocessed.
const vec3Schema = z.object({
  x: numberWithDefault(0),
  y: numberWithDefault(0),
  z: numberWithDefault(0),
});

// SpatialPlacement: fully optional block on each node.
// position3d in metres, robot-local frame.
// rotation3d in euler radians (XYZ order).
// dimensions is the bounding box in metres (w/h/d).
// Fallback mapping (documented): when missing, callers derive
//   { x: (node.x - 400) / 200, y: 0, z: (node.y - 300) / 200 }
const spatialPlacementSchema = z.object({
  position3d: vec3Schema.optional(),
  rotation3d: vec3Schema.optional(),
  dimensions: z
    .object({
      w: numberWithDefault(0.05),
      h: numberWithDefault(0.03),
      d: numberWithDefault(0.05),
    })
    .nullish()
    .transform((value) => value ?? undefined),
  // massGrams: positive-only; 0 and null treated as unknown.
  massGrams: z.preprocess(
    (value) => {
      if (value === null || value === undefined || value === '') return undefined;
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) && num > 0 ? num : undefined;
    },
    z.number().positive().optional(),
  ),
  // modelRef: e.g. 'sg90' | '18650' | a gltf url
  modelRef: optionalText,
  // parentId: kinematic mount (leg servo → body)
  parentId: optionalText,
}).nullish().transform((value) => value ?? undefined);

export const architectureNodeSchema = z.object({
  id: optionalTextOrDefault('node'),
  type: z.enum(NODE_TYPES).catch('other'),
  name: optionalTextOrDefault('Component'),
  partNumber: nullableText,
  x: numberWithDefault(120),
  y: numberWithDefault(120),
  description: optionalTextOrDefault(''),
  properties: objectArray(propertySchema),
  ports: objectArray(portSchema),
  details: stringArray,
  // optional 3D spatial fields; existing graphs without them still validate.
  spatial: spatialPlacementSchema,
});

export const architectureConnectionSchema = z.object({
  id: optionalTextOrDefault('link'),
  from: optionalTextOrDefault(''),
  to: optionalTextOrDefault(''),
  fromPort: nullableText,
  toPort: nullableText,
  label: optionalTextOrDefault('link'),
  kind: z.enum(CONNECTION_KINDS).catch('other'),
  details: optionalTextOrDefault(''),
});

export const architectureDependencySchema = z.object({
  // ids are also backfilled deterministically in repairGraph; the fallback
  // here only keeps the schema from 500-ing on raw model output.
  id: optionalTextOrDefault('dependency'),
  name: optionalTextOrDefault('Dependency'),
  kind: optionalTextOrDefault('other'),
  version: nullableText,
  reason: optionalTextOrDefault(''),
});

export const softwareItemSchema = z.object({
  id: optionalTextOrDefault('software'),
  name: optionalTextOrDefault('Software'),
  kind: optionalTextOrDefault('other'),
  version: nullableText,
  details: optionalTextOrDefault(''),
});

export const verificationStatusSchema = z.enum(['verified', 'review', 'blocked', 'unavailable']);

export const verificationCheckSchema = z.object({
  id: optionalTextOrDefault(''),
  title: optionalTextOrDefault('Check'),
  status: z.enum(['pass', 'review', 'fail']).catch('review'),
  detail: optionalTextOrDefault(''),
  scope: z.enum(['node', 'connection', 'graph']).catch('graph'),
  targetId: optionalText,
});

export const verificationSourceSchema = z.object({
  title: optionalTextOrDefault('Source'),
  url: optionalTextOrDefault(''),
  usedFor: optionalTextOrDefault(''),
});

export const verificationReportSchema = z.object({
  status: verificationStatusSchema.catch('review'),
  score: z.coerce.number().min(0).max(100).catch(0),
  summary: optionalTextOrDefault(''),
  checks: objectArray(verificationCheckSchema),
  sources: objectArray(verificationSourceSchema),
});

export const architectureGraphSchema = z.object({
  project: optionalTextOrDefault('Untitled hardware system'),
  summary: optionalTextOrDefault(''),
  nodes: objectArray(architectureNodeSchema),
  connections: objectArray(architectureConnectionSchema),
  dependencies: objectArray(architectureDependencySchema),
  software: objectArray(softwareItemSchema),
  notes: stringArray,
});

/** POST /api/architecture/plan */
export const planArchitectureBodySchema = z.object({
  request: z.string().trim().min(1, 'A non-empty request is required.'),
  graph: z.unknown().optional(),
  // The client always sends this key, and it is null until a project is saved.
  // Zod's .optional() accepts undefined only — null must be allowed explicitly.
  projectId: z.string().nullish(),
  // Confirmed intent contract from the interpret pass.
  requirements: requirementsSpecSchema.nullish(),
  // Human feedback from the confirmation loop ("not that, because…").
  feedback: stringArray,
});

export const createProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(120).default('Untitled hardware system'),
  summary: z.string().trim().max(600).default(''),
});

export type ArchitectureNode = z.infer<typeof architectureNodeSchema>;
export type ArchitectureConnection = z.infer<typeof architectureConnectionSchema>;
export type ArchitectureDependency = z.infer<typeof architectureDependencySchema>;
export type SoftwareItem = z.infer<typeof softwareItemSchema>;
export type ArchitectureGraph = z.infer<typeof architectureGraphSchema>;
export type VerificationReport = z.infer<typeof verificationReportSchema>;
export type VerificationCheck = z.infer<typeof verificationCheckSchema>;
export type VerificationSource = z.infer<typeof verificationSourceSchema>;

export function emptyGraph(): ArchitectureGraph {
  return {
    project: 'Untitled hardware system',
    summary: '',
    nodes: [],
    connections: [],
    dependencies: [],
    software: [],
    notes: [],
  };
}

/**
 * Lenient parse of an incoming graph.
 *
 * `repaired` is false when the payload was not graph-shaped at all. Callers
 * must not treat that as "empty on purpose": the planner is told to update the
 * graph in place, so silently substituting an empty one makes it rebuild from
 * scratch and quietly discard a saved design. Surface the fallback instead.
 */
export function normaliseGraph(input: unknown): { graph: ArchitectureGraph; repaired: boolean } {
  const result = architectureGraphSchema.safeParse(input ?? {});
  if (result.success) return { graph: result.data, repaired: false };
  return { graph: emptyGraph(), repaired: true };
}