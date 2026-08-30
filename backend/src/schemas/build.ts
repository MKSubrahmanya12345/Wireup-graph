import { z } from 'zod';

/**
 * Zod contracts for the Agentic Build pipeline: firmware generation,
 * website-requirements analysis, and the MERN website build that assembles a
 * hardcoded scaffold with AI-generated device wiring.
 */

// ── shared null-tolerant helpers ──────────────────────────────────────────
// Bedrock models (Kimi, MiniMax, Nova…) emit explicit `null` for fields that
// don't apply; Zod's .default()/.optional() only treat `undefined` as absent.
// A union with the fallback value normalises null/non-string inputs without
// losing the inferred output type.
const optionalTextOrDefault = (fallback: string) =>
  z
    .union([z.string(), z.literal(null), z.undefined()])
    .transform((value) => (typeof value === 'string' && value.trim() ? value.trim() : fallback));

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

export const buildFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});
export type BuildFile = z.infer<typeof buildFileSchema>;

// ── Firmware ──────────────────────────────────────────────────────────────
export const firmwareFileSchema = z.object({
  path: optionalTextOrDefault(''),
  content: optionalTextOrDefault(''),
});

/**
 * Firmware file lists: non-arrays become [], non-object entries drop, and
 * entries without a usable path drop as well (a file with no path cannot be
 * written — keeping it would only crash the scaffold writer later).
 */
const firmwareFiles = z
  .union([z.array(z.any()), z.literal(null), z.undefined()])
  .transform((value) =>
    (Array.isArray(value) ? value : []).filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        typeof entry.path === 'string' &&
        !!entry.path.trim(),
    ),
  )
  .pipe(z.array(firmwareFileSchema))
  .default([]);

export const firmwareResultSchema = z.object({
  platform: optionalTextOrDefault('arduino'),
  board: optionalTextOrDefault('Arduino-compatible'),
  language: optionalTextOrDefault('C++'),
  framework: optionalTextOrDefault('Arduino'),
  files: firmwareFiles,
  buildSteps: stringArray,
  notes: stringArray,
});
export type FirmwareResult = z.infer<typeof firmwareResultSchema>;

// ── Website requirements ──────────────────────────────────────────────────
const optionalNumber = z
  .any()
  .transform((value) => {
    if (value === null || value === undefined || value === '') return undefined;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : undefined;
  });

export const readEndpointSchema = z.object({
  name: optionalTextOrDefault(''),
  path: optionalTextOrDefault(''),
  method: z.enum(['GET', 'POST', 'PUT']).catch('GET'),
  description: optionalTextOrDefault(''),
  dataType: optionalTextOrDefault('text'),
  unit: optionalText,
  sampleIntervalMs: optionalNumber,
});

export const controlEndpointSchema = z.object({
  name: optionalTextOrDefault(''),
  path: optionalTextOrDefault(''),
  method: z.enum(['GET', 'POST', 'PUT']).catch('POST'),
  description: optionalTextOrDefault(''),
  bodyType: optionalTextOrDefault('json'),
  commandOptions: stringArray,
});

export const dataFieldSchema = z.object({
  field: optionalTextOrDefault(''),
  type: optionalTextOrDefault(''),
  unit: optionalText,
  source: optionalTextOrDefault(''),
});

export const websiteRequirementsSchema = z.object({
  requested: z.boolean().catch(false),
  summary: optionalTextOrDefault(''),
  device: z
    .object({
      name: optionalTextOrDefault(''),
      connection: z
        .enum(['wifi', 'ethernet', 'serial', 'ble', 'cellular', 'other'])
        .catch('wifi'),
      localIpHint: optionalText,
      port: optionalNumber,
      protocol: optionalTextOrDefault('http'),
      endpointBase: optionalTextOrDefault(''),
      ssidHint: optionalText,
      credentialsRequired: z.boolean().catch(false),
    })
    .nullish()
    .transform((value) => value ?? {}),
  readEndpoints: objectArray(readEndpointSchema),
  controlEndpoints: objectArray(controlEndpointSchema),
  telemetry: z
    .object({
      livePath: optionalTextOrDefault('/api/telemetry/live'),
      historyPath: optionalTextOrDefault('/api/telemetry/history'),
      sampleRateMs: optionalNumber,
      retentionDays: optionalNumber,
    })
    .nullish()
    .transform((value) => value ?? {}),
  dataModel: objectArray(dataFieldSchema),
  security: stringArray,
  notes: stringArray,
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
  projectName: optionalTextOrDefault('wireup-device'),
  deviceSpecTs: optionalTextOrDefault(''),
  deviceEndpointsTs: optionalTextOrDefault(''),
  envExample: z
    .object({
      deviceIp: optionalText,
      devicePort: optionalNumber,
      deviceProtocol: optionalText,
      endpointsJson: optionalText,
    })
    .nullish()
    .transform((value) => value ?? {}),
  readmeSection: optionalTextOrDefault(''),
  buildNotes: stringArray,
});

export const websiteBuildBodySchema = z.object({
  projectName: z.string().trim().default('Untitled hardware system'),
  graph: z.unknown().optional(),
  websiteRequirements: websiteRequirementsSchema.nullish(),
  requirements: z.unknown().nullish(),
});

export type WebsiteBuildPlan = z.infer<typeof websiteBuildSchema>;
