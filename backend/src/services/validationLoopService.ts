/**
 * Validation Loop Service — manages the iterative validation loop
 * described by the user:
 *
 *   User -> prompt -> AI assumes all but asks doubts
 *   -> once cleared -> builds graph
 *   -> loop validation until "project data perfect"
 *   -> store verified data in Graph DSA format
 */
import { v4 as uuidv4 } from 'uuid';
import { GraphDSA, type DSADoubtRecord, type DSAValidationLoopRecord } from '../models/GraphDSA.js';
import { buildRAGValidation, retrieveEvidenceForGraph } from './ragValidationService.js';
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
  const loopId = uuidv4().slice(0, 8);
  const projectName = input.projectName ?? input.graph.project ?? 'Untitled project';
  const notes = input.notes ?? [];

  // Retrieve RAG evidence
  const evidence = retrieveEvidenceForGraph(input.graph);

  // Build validation report
  const ragReport = buildRAGValidation(input.graph, input.requirements, evidence);

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

  const resolvedCount = doubts.filter((d) => d.resolved).length;
  const totalDoubts = doubts.length;

  // Determine if "perfect"
  const isPerfect = !ragReport.blocking && ragReport.score >= 90 && resolvedCount >= totalDoubts && totalDoubts > 0 ? true : false;
  // Also allow perfect when no doubts remain and no blocking errors
  const perfectIfComplete = !ragReport.blocking && totalDoubts === 0 && ragReport.score >= 85;
  const finalPerfect = isPerfect || perfectIfComplete;

  // Build the loop record
  const loopRecord: DSAValidationLoopRecord = {
    loopId,
    startedAt: new Date(),
    completedAt: new Date(),
    status: finalPerfect ? 'perfect' : ragReport.blocking ? 'blocked' : 'in_progress',
    doubtsAsked: totalDoubts,
    doubtsResolved: resolvedCount,
    validationIssues: ragReport.issues.map((i) => i.id),
    ragEvidenceIds: evidence.map((e) => e.sourceId),
    notes,
  };

  // Build PRD document
  const prdDocument = {
    projectName,
    summary: input.graph.summary || '',
    architectureGraph: input.graph,
    verification: {
      status: ragReport.status,
      score: ragReport.score,
      summary: ragReport.summary,
      checks: ragReport.issues,
    },
    componentSources: ragReport.componentSources,
    ragEvidence: evidence.map((e) => ({
      sourceId: e.sourceId,
      sourceTitle: e.sourceTitle,
      sourceUrl: e.sourceUrl,
      snippet: e.contentSnippet,
      relevance: e.relevanceScore,
    })),
    validationLoop: loopRecord,
    doubts,
    isPerfect: finalPerfect,
    generatedAt: new Date().toISOString(),
    version: '1.0.0',
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
          engineeringIssues: ragReport.issues,
          ragEvidence: evidence,
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
              engineeringIssues: ragReport.issues,
              ragEvidence: evidence,
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
