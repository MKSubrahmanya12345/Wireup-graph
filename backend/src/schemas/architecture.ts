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

const propertySchema = z.object({
  label: z.string().default('property'),
  value: z.string().default(''),
});

const portSchema = z.object({
  id: z.string().default(''),
  label: z.string().default(''),
  direction: z.enum(PORT_DIRECTIONS).catch('in'),
  signal: z.enum(SIGNAL_TYPES).catch('other'),
});

// optional number preprocessor mirrors requirements.ts pattern.
// LLMs emit 0/null/"" to mean "unknown". We normalise those to undefined
// so they round-trip safely through Zod's .optional() (which rejects null).
const optionalFiniteNumber = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === '') return undefined;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : undefined;
  },
  z.number().optional(),
);

// 3-component vector: all fields preprocessed.
const vec3Schema = z.object({
  x: optionalFiniteNumber.default(0),
  y: optionalFiniteNumber.default(0),
  z: optionalFiniteNumber.default(0),
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
  dimensions: z.object({
    w: optionalFiniteNumber.default(0.05),
    h: optionalFiniteNumber.default(0.03),
    d: optionalFiniteNumber.default(0.05),
  }).optional(),
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
  modelRef: z.string().nullish().transform((v) => v ?? undefined),
  // parentId: kinematic mount (leg servo → body)
  parentId: z.string().nullish().transform((v) => v ?? undefined),
}).optional();

export const architectureNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(NODE_TYPES).catch('other'),
  name: z.string().min(1),
  partNumber: z.string().nullable().default(null),
  x: z.number().default(120),
  y: z.number().default(120),
  description: z.string().default(''),
  properties: z.array(propertySchema).default([]),
  ports: z.array(portSchema).default([]),
  details: z.array(z.string()).default([]),
  // optional 3D spatial fields; existing graphs without them still validate.
  spatial: spatialPlacementSchema,
});

export const architectureConnectionSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  fromPort: z.string().nullable().default(null),
  toPort: z.string().nullable().default(null),
  label: z.string().default('link'),
  kind: z.enum(CONNECTION_KINDS).catch('other'),
  details: z.string().default(''),
});

export const architectureDependencySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().default('other'),
  version: z.string().nullable().default(null),
  reason: z.string().default(''),
});

export const softwareItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().default('other'),
  version: z.string().nullable().default(null),
  details: z.string().default(''),
});

export const verificationStatusSchema = z.enum(['verified', 'review', 'blocked', 'unavailable']);

export const verificationCheckSchema = z.object({
  id: z.string().default(''),
  title: z.string().default('Check'),
  status: z.enum(['pass', 'review', 'fail']).catch('review'),
  detail: z.string().default(''),
  scope: z.enum(['node', 'connection', 'graph']).catch('graph'),
  targetId: z.string().optional(),
});

export const verificationSourceSchema = z.object({
  title: z.string().default('Source'),
  url: z.string().default(''),
  usedFor: z.string().default(''),
});

export const verificationReportSchema = z.object({
  status: verificationStatusSchema.default('review'),
  score: z.number().min(0).max(100).default(0),
  summary: z.string().default(''),
  checks: z.array(verificationCheckSchema).default([]),
  sources: z.array(verificationSourceSchema).default([]),
});

export const architectureGraphSchema = z.object({
  project: z.string().default('Untitled hardware system'),
  summary: z.string().default(''),
  nodes: z.array(architectureNodeSchema).default([]),
  connections: z.array(architectureConnectionSchema).default([]),
  dependencies: z.array(architectureDependencySchema).default([]),
  software: z.array(softwareItemSchema).default([]),
  notes: z.array(z.string()).default([]),
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
  feedback: z.array(z.string()).default([]),
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