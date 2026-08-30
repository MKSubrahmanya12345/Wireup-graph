/**
 * Validation Loop Service — manages the iterative validation loop
 * described by the user:
 *
 *   User -> prompt -> AI assumes all but asks doubts
 *   -> once cleared -> builds graph
 *   -> loop validation until "project data perfect"
 *   -> store verified data in Graph DSA format
 */
import { randomUUID } from 'node:crypto';
import { GraphDSA, type DSADoubtRecord, type DSAValidationLoopRecord } from '../models/GraphDSA.js';
import { buildRAGValidation, retrieveEvidenceForGraph } from './ragValidationService.js';
import { searchWebForComponents } from './ragWebSearchService.js';
import { resolveDoubtsAutomatically } from './autoDoubtResolver.js';
import { validateAllDimensions } from './multiDimensionValidation.js';
import { generateAgenticPRD } from './agenticPRDGenerator.js';
import { compareGraphs } from './loopDiffService.js';
import { isPersistenceEnabled } from '../config/db.js';
import { logger } from '../config/logger.js';
import type { ArchitectureGraph } from '../schemas/architecture.js';
import type { RequirementsSpec, Question } from '../schemas/requirements.js';

export interface ValidationLoopInput {
  graph: ArchitectureGraph;
  projectName?: string;
  requirements?: RequirementsSpec | null;
  doubts?: Question[];
  resolvedDoubts?: Record<string, string>;
  notes?: string[];
}

export interface ValidationLoopResult {
  graphDSAId?: string;
  loopId: string;
  status: 'in_progress' | 'perfect' | 'blocked';
  doubtsAsked: number;
  doubtsResolved: number;
  isPerfect: boolean;
  score: number;
  summary: string;
  doubts: DSADoubtRecord[];
  validationLoops: DSAValidationLoopRecord[];
}

/**
 * Execute one validation loop iteration.
 */
export async function runValidationLoop(
  input: ValidationLoopInput,
): Promise<ValidationLoopResult> {
  const loopId = randomUUID().slice(0, 8);
  const projectName = input.projectName ?? input.graph.project ?? 'Untitled project';
  const notes = input.notes ?? [];

  // Retrieve RAG evidence from catalog + web search
  const catalogEvidence = retrieveEvidenceForGraph(input.graph);
  const webEvidence = await searchWebForComponents(input.graph);
  const allEvidence = [...catalogEvidence, ...webEvidence.map((e) => ({
    sourceId: e.url,
    sourceTitle: e.title,
    sourceUrl: e.url,
    retrievedAt: e.retrievedAt,
    contentSnippet: e.snippet,
    relevanceScore: 0.85,
  }))];

  // Auto-resolve doubts where possible
  const autoResolutions = resolveDoubtsAutomatically(
    input.doubts ?? [],
    input.graph,
    input.requirements ?? null,
  );

  // Build multi-dimension validation
  const dimensionResults = validateAllDimensions(input.graph);

  // Build validation report
  const ragReport = buildRAGValidation(input.graph, input.requirements, allEvidence);

  // Convert doubts to DSADoubtRecord format
  const doubts: DSADoubtRecord[] = (input.doubts ?? []).map((q) => ({
    id: q.id,
    prompt: q.prompt,
    whyMaterial: q.why,
    impact: q.impact,
    kind: q.kind,
    options: q.options,
    defaultValue: q.default,
    resolved: Boolean(input.resolvedDoubts?.[q.id]),
    resolution: input.resolvedDoubts?.[q.id] ?? undefined,
    resolvedAt: input.resolvedDoubts?.[q.id] ? new Date() : undefined,
  }));

  // Apply auto-resolutions to doubts
  for (const auto of autoResolutions) {
    const doubt = doubts[doubts.findIndex((d) => d.id === auto.questionId)];
    if (doubt && auto.resolved) {
      doubt.resolved = true;
      doubt.resolution = auto.resolution;
      doubt.resolvedAt = new Date();
    }
  }

  const resolvedCount = doubts.filter((d) => d.resolved).length;
  const totalDoubts = doubts.length;

  // Determine if "perfect"
  const isPerfect = !ragReport.blocking && ragReport.score >= 90 && resolvedCount >= totalDoubts && totalDoubts > 0 ? true : false;
  // Also allow perfect when no doubts remain and no blocking errors
  const perfectIfComplete = !ragReport.blocking && totalDoubts === 0 && ragReport.score >= 85;
  // Compute perfect status considering multi-dimension results
  const anyDimensionBlocking = dimensionResults.some((d) => d.blocking);
  const avgDimensionScore = dimensionResults.reduce((sum, d) => sum + d.score, 0) / Math.max(1, dimensionResults.length);
  const finalPerfect = !ragReport.blocking && !anyDimensionBlocking && ragReport.score >= 85 && avgDimensionScore >= 80 && (resolvedCount >= totalDoubts || totalDoubts === 0);

  // Build the loop record
  const loopRecord: DSAValidationLoopRecord = {
    loopId,
    startedAt: new Date(),
    completedAt: new Date(),
    status: finalPerfect ? 'perfect' : ragReport.blocking ? 'blocked' : 'in_progress',
    doubtsAsked: totalDoubts,
    doubtsResolved: resolvedCount,
    validationIssues: ragReport.issues.map((i) => i.id),
    ragEvidenceIds: allEvidence.map((e) => e.sourceId),
    notes,
  };

  // Build agentic PRD (the validation report is a richer shape than the
  // generic verification report the PRD consumes, so adapt it explicitly).
  const agenticPRD = generateAgenticPRD(
    projectName,
    input.graph.summary || '',
    input.graph,
    ragReport as unknown as import('../schemas/architecture.js').VerificationReport,
    allEvidence,
    doubts,
    [loopRecord],
    finalPerfect,
  );

  // Build PRD document (enhanced with agentic sections)
  const prdDocument = {
    ...agenticPRD,
    multiDimensionResults: dimensionResults,
    loopDiff: null,
    generatedAt: new Date().toISOString(),
  };

  // Save to DB if persistence enabled
  let savedId: string | undefined;
  if (isPersistenceEnabled()) {
    try {
      // Find or create by project name
      let doc = await GraphDSA.findOne({ projectName }).sort({ updatedAt: -1 }).lean();
      if (!doc) {
        doc = await GraphDSA.create({
          projectName,
          summary: input.graph.summary || '',
          architectureGraph: input.graph,
          verification: ragReport,
          engineeringIssues: ragReport.issues as unknown as Record<string, unknown>[],
          ragEvidence: allEvidence,
          validationLoops: [loopRecord],
          doubts,
          isPerfect: finalPerfect,
          prdDocument,
          componentSources: ragReport.componentSources,
        });
        savedId = String((doc as unknown as { _id?: { toString(): string } })._id);
      } else {
        // Update existing
        await GraphDSA.updateOne(
          { _id: (doc as unknown as { _id: import('mongoose').Types.ObjectId })._id },
          {
            $set: {
              architectureGraph: input.graph,
              verification: ragReport,
              engineeringIssues: ragReport.issues as unknown as Record<string, unknown>[],
              ragEvidence: allEvidence,
              doubts,
              isPerfect: finalPerfect,
              prdDocument,
              componentSources: ragReport.componentSources,
              updatedAt: new Date(),
            },
            $push: {
              validationLoops: loopRecord,
            },
          },
        );
        savedId = String((doc as unknown as { _id: { toString(): string } })._id);
      }
      logger.info({ loopId, savedId, isPerfect: finalPerfect }, 'Graph DSA validation loop saved');
    } catch (error) {
      logger.error({ err: error, loopId }, 'Failed to save Graph DSA');
    }
  }

  return {
    graphDSAId: savedId,
    loopId,
    status: loopRecord.status,
    doubtsAsked: loopRecord.doubtsAsked,
    doubtsResolved: loopRecord.doubtsResolved,
    isPerfect: finalPerfect,
    score: ragReport.score,
    summary: ragReport.summary,
    doubts,
    validationLoops: [loopRecord], // Return the current loop
  };
}

/**
 * Check if a Graph DSA entry is perfect and retrieve its PRD.
 */
export async function getGraphDSAById(id: string) {
  if (!isPersistenceEnabled()) return null;
  return await GraphDSA.findById(id).lean();
}

/**
 * List all perfect Graph DSA entries (ready for agentic coding).
 */
export async function listPerfectGraphDSAs() {
  if (!isPersistenceEnabled()) return [];
  return await GraphDSA.find({ isPerfect: true })
    .sort({ updatedAt: -1 })
    .select('projectName summary isPerfect updatedAt prdDocument')
    .lean();
}

/**
 * Check if the graph has reached "project data perfect" status.
 */
export function isProjectDataPerfect(
  ragReport: { blocking: boolean; score: number },
  doubts: DSADoubtRecord[],
  resolvedDoubts: Record<string, string>,
): boolean {
  const resolvedCount = doubts.filter(
    (d) => d.resolved || Boolean(resolvedDoubts?.[d.id])
  ).length;
  return !ragReport.blocking && ragReport.score >= 90 && resolvedCount >= doubts.length && doubts.length > 0;
}
