import { z } from 'zod';

/**
 * Zod contracts for the Agentic Build pipeline: firmware generation,
 * website-requirements analysis, and the MERN website build that assembles a
 * hardcoded scaffold with AI-generated device wiring.
 */

export const buildFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});
export type BuildFile = z.infer<typeof buildFileSchema>;

// ── Firmware ──────────────────────────────────────────────────────────────
export const firmwareFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const firmwareResultSchema = z.object({
  platform: z.string().default('arduino'),
  board: z.string().default('Arduino-compatible'),
  language: z.string().default('C++'),
  framework: z.string().default('Arduino'),
  files: z.array(firmwareFileSchema).default([]),
  buildSteps: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});
export type FirmwareResult = z.infer<typeof firmwareResultSchema>;

export const firmwareBodySchema = z.object({
  brief: z.string().trim().default(''),
  projectName: z.string().trim().default('Untitled hardware system'),
  graph: z.unknown().optional(),
  requirements: z.unknown().nullish(),
});

// ── Website requirements ──────────────────────────────────────────────────
export const readEndpointSchema = z.object({
  name: z.string().default(''),
  path: z.string().default(''),
  method: z.enum(['GET', 'POST', 'PUT']).catch('GET'),
  description: z.string().default(''),
  dataType: z.string().default('text'),
  unit: z.string().optional(),
  sampleIntervalMs: z.number().optional(),
});

export const controlEndpointSchema = z.object({
  name: z.string().default(''),
  path: z.string().default(''),
  method: z.enum(['GET', 'POST', 'PUT']).catch('POST'),
  description: z.string().default(''),
  bodyType: z.string().default('json'),
  commandOptions: z.array(z.string()).default([]),
});

export const dataFieldSchema = z.object({
  field: z.string().default(''),
  type: z.string().default(''),
  unit: z.string().optional(),
  source: z.string().default(''),
});

export const websiteRequirementsSchema = z.object({
  requested: z.boolean().default(false),
  summary: z.string().default(''),
  device: z
    .object({
      name: z.string().default(''),
      connection: z
        .enum(['wifi', 'ethernet', 'serial', 'ble', 'cellular', 'other'])
        .catch('wifi'),
      localIpHint: z.string().nullish(),
      port: z.number().optional(),
      protocol: z.string().default('http'),
      endpointBase: z.string().default(''),
      ssidHint: z.string().nullish(),
      credentialsRequired: z.boolean().default(false),
    })
    .default({}),
  readEndpoints: z.array(readEndpointSchema).default([]),
  controlEndpoints: z.array(controlEndpointSchema).default([]),
  telemetry: z
    .object({
      livePath: z.string().default('/api/telemetry/live'),
      historyPath: z.string().default('/api/telemetry/history'),
      sampleRateMs: z.number().optional(),
      retentionDays: z.number().optional(),
    })
    .default({}),
  dataModel: z.array(dataFieldSchema).default([]),
  security: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});
export type WebsiteRequirements = z.infer<typeof websiteRequirementsSchema>;

export const websiteRequirementsBodySchema = z.object({
  brief: z.string().trim().default(''),
  projectName: z.string().trim().default('Untitled hardware system'),
  graph: z.unknown().optional(),
  requirements: z.unknown().nullish(),
});

// ── Website build ─────────────────────────────────────────────────────────
export const websiteBuildSchema = z.object({
  projectName: z.string().default('wireup-device'),
  deviceSpecTs: z.string().min(1),
  deviceEndpointsTs: z.string().min(1),
  envExample: z
    .object({
      deviceIp: z.string().nullish(),
      devicePort: z.number().optional(),
      deviceProtocol: z.string().optional(),
      endpointsJson: z.string().nullish(),
    })
    .default({}),
  readmeSection: z.string().default(''),
  buildNotes: z.array(z.string()).default([]),
});

export const websiteBuildBodySchema = z.object({
  projectName: z.string().trim().default('Untitled hardware system'),
  graph: z.unknown().optional(),
  websiteRequirements: websiteRequirementsSchema.nullish(),
  requirements: z.unknown().nullish(),
});

export type WebsiteBuildPlan = z.infer<typeof websiteBuildSchema>;
