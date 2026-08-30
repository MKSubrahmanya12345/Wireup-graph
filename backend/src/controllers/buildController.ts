import type { Request, Response } from 'express';

import { env } from '../config/env.js';
import { normaliseGraph, type ArchitectureGraph } from '../schemas/architecture.js';
import {
  firmwareBodySchema,
  websiteBuildBodySchema,
  websiteRequirementsBodySchema,
  type FirmwareResult,
} from '../schemas/build.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';
import { generateFirmware } from '../services/firmwareGenerator.js';
import {
  firmwareSummaryFrom,
  generateWebsiteRequirements,
} from '../services/websiteRequirementsGenerator.js';
import { buildWebsite } from '../services/websiteBuilder.js';
import { loadScaffold } from '../services/scaffoldService.js';
import { GroqError } from '../services/groqService.js';

/** Throws the standard "Groq not configured" error once. */
function requireGroq(): void {
  if (!env.GROQ_API_KEY) {
    throw new ApiError(500, 'Groq is not configured. Add GROQ_API_KEY to backend/.env.');
  }
}

function toApiError(error: unknown): Error {
  if (error instanceof GroqError) {
    return ApiError.upstream(`Agentic build failed: ${error.message}`);
  }
  if (error instanceof Error && error.message.includes('non-JSON')) {
    return ApiError.upstream(`Agentic build failed: ${error.message}`);
  }
  return error instanceof Error ? error : new ApiError(500, 'Agentic build failed.');
}

/** POST /api/build/scaffold — returns the hardcoded template (no LLM call). */
export const getScaffold = asyncHandler(async (_req: Request, res: Response) => {
  const scaffold = await loadScaffold();
  res.status(200).json({ root: 'scaffolds/website', files: scaffold });
});

/** POST /api/build/firmware — the hardware part, generated first. */
export const buildFirmwareEndpoint = asyncHandler(async (req: Request, res: Response) => {
  requireGroq();
  const parsed = firmwareBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest('Invalid firmware build request.', parsed.error.flatten());
  }
  const { brief, projectName, graph } = parsed.data;
  const { graph: normalised } = normaliseGraph(graph ?? {});
  try {
    const firmware = await generateFirmware(brief, projectName, normalised);
    res.status(200).json(firmware);
  } catch (error) {
    throw toApiError(error);
  }
});

/** POST /api/build/website-requirements — after firmware, the Website Requirements section. */
export const websiteRequirementsEndpoint = asyncHandler(async (req: Request, res: Response) => {
  requireGroq();
  const parsed = websiteRequirementsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest('Invalid website-requirements request.', parsed.error.flatten());
  }
  const { brief, projectName, graph } = parsed.data;
  const { graph: normalised } = normaliseGraph(graph ?? {});

  // Optionally accept a previously generated firmware result so the analyser
  // can align its endpoints with the firmware that was actually produced.
  const firmware = (req.body as { firmware?: unknown }).firmware as
    | (FirmwareResult & { content?: unknown })
    | undefined;

  try {
    const requirements = await generateWebsiteRequirements({
      brief,
      projectName,
      graph: normalised,
      firmwareSummary: firmwareSummaryFrom(firmware ?? null),
    });
    res.status(200).json(requirements);
  } catch (error) {
    throw toApiError(error);
  }
});

/** POST /api/build/website — assemble the MERN codebase from scaffold + AI wiring. */
export const buildWebsiteEndpoint = asyncHandler(async (req: Request, res: Response) => {
  requireGroq();
  const parsed = websiteBuildBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest('Invalid website build request.', parsed.error.flatten());
  }
  const { projectName, graph, websiteRequirements } = parsed.data;
  const { graph: normalised } = normaliseGraph(graph ?? {});

  const firmware = (req.body as { firmware?: unknown }).firmware as
    | (FirmwareResult & { content?: unknown })
    | undefined;

  try {
    const result = await buildWebsite({
      projectName,
      graph: normalised,
      websiteRequirements: websiteRequirements ?? null,
      firmwareSummary: firmwareSummaryFrom(firmware ?? null),
    });
    res.status(200).json(result);
  } catch (error) {
    throw toApiError(error);
  }
});

/**
 * POST /api/build/all — run the full agentic pipeline in order:
 * firmware → website requirements → website build.
 */
export const buildAllEndpoint = asyncHandler(async (req: Request, res: Response) => {
  if (!env.GROQ_API_KEY) {
    // Agentic engine path — same response shape, no LLM required.
    const { agenticBufferedEndpoint } = await import('./agenticController.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return agenticBufferedEndpoint(req as any, res as any, (() => undefined) as any);
  }
  requireGroq();
  const parsed = websiteRequirementsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest('Invalid build request.', parsed.error.flatten());
  }
  const { brief, projectName, graph } = parsed.data;
  const { graph: normalised } = normaliseGraph(graph ?? {});
  const graphForBuild: ArchitectureGraph = normalised;

  try {
    const firmware = await generateFirmware(brief, projectName, graphForBuild);
    const requirements = await generateWebsiteRequirements({
      brief,
      projectName,
      graph: graphForBuild,
      firmwareSummary: firmwareSummaryFrom(firmware),
    });
    const website = await buildWebsite({
      projectName,
      graph: graphForBuild,
      websiteRequirements: requirements.requested ? requirements : null,
      firmwareSummary: firmwareSummaryFrom(firmware),
    });

    res.status(200).json({
      projectName,
      order: ['firmware', 'websiteRequirements', 'website'],
      firmware,
      websiteRequirements: requirements,
      website: requirements.requested ? website : null,
      websiteRequested: requirements.requested,
    });
  } catch (error) {
    throw toApiError(error);
  }
});
