/**
 * RAG Validation Service — retrieves from component catalog and rules,
 * builds evidence, and validates architecture graphs against verified sources.
 */
import { officialComponentCatalog, catalogMatches, catalogSources } from '../data/componentCatalog.js';
import { runEngineeringChecks, hasBlockingIssue, type Issue } from '../data/engineeringRules.js';
import { PARTS, resolvePart, isPowerSource, usableTorque } from '../data/partLibrary.js';
import { logger } from '../config/logger.js';
import type { DSAEvidenceRecord } from '../models/GraphDSA.js';
import type { ArchitectureGraph } from '../schemas/architecture.js';
import type { RequirementsSpec } from '../schemas/requirements.js';

/**
 * Retrieve relevant evidence from the component catalog and rules for a graph.
 */
export function retrieveEvidenceForGraph(
  graph: ArchitectureGraph,
): DSAEvidenceRecord[] {
  const evidence: DSAEvidenceRecord[] = [];

  // Retrieve from component catalog (official component bank)
  const matchedRecords = catalogMatches(graph as unknown as Record<string, unknown>);
  for (const record of matchedRecords) {
    evidence.push({
      sourceId: record.id,
      sourceTitle: `${record.manufacturer} ${record.family}`,
      sourceUrl: record.officialUrl,
      retrievedAt: new Date(),
      contentSnippet: JSON.stringify(record.facts).slice(0, 300),
      relevanceScore: 0.95,
    });
  }

  // Retrieve from part library (machine-readable specs)
  const nodes = (graph.nodes ?? []) as Array<{
    id: string;
    name: string;
    partNumber: string | null;
    type: string;
  }>;

  for (const node of nodes) {
    const spec = resolvePart(node.partNumber);
    if (spec) {
      evidence.push({
        sourceId: `part-spec-${spec.id}`,
        sourceTitle: `Part spec: ${spec.family} (${spec.manufacturer ?? 'unknown'})`,
        sourceUrl: spec.officialUrl ?? `https://internal/part-spec/${spec.id}`,
        retrievedAt: new Date(),
        contentSnippet: `kind=${spec.kind}, supply=${spec.supplyMinV ?? '?'}-${spec.supplyMaxV ?? '?'}V, ` +
          `current=${spec.currentTypMa ?? '?'}mA, outputMax=${spec.outputMaxMa ?? '?'}mA`,
        relevanceScore: 0.9,
      });
    }
  }

  // Retrieve from engineering rules (evidence for checks performed)
  const issues = runEngineeringChecks(graph, undefined);
  if (issues.length > 0) {
    evidence.push({
      sourceId: 'engineering-rules-check',
      sourceTitle: 'Engineering Rules Validation',
      sourceUrl: 'https://internal/engineering-rules',
      retrievedAt: new Date(),
      contentSnippet: `Performed ${issues.length} engineering checks. ` +
        `Blocking errors: ${issues.filter((i) => i.severity === 'error').length}`,
      relevanceScore: 1.0,
    });
  }

  return evidence;
}

/**
 * Build RAG-enhanced validation report combining retrieved evidence
 * with engineering checks.
 */
export function buildRAGValidation(
  graph: ArchitectureGraph,
  requirements?: RequirementsSpec | null,
  evidence?: DSAEvidenceRecord[],
) {
  const retrievedEvidence = evidence ?? retrieveEvidenceForGraph(graph);
  const issues = runEngineeringChecks(graph, requirements);
  const blocking = hasBlockingIssue(issues);

  const componentSources = retrievedEvidence
    .filter((e) => e.sourceId.startsWith('part-spec-') || e.sourceId.startsWith('nordic-') || e.sourceId.startsWith('bosch-') || e.sourceId.startsWith('texas-') || e.sourceId.startsWith('winbond-'))
    .map((e) => ({
      title: e.sourceTitle,
      url: e.sourceUrl,
      usedFor: e.contentSnippet.slice(0, 120),
    }))
    .filter((v, i, arr) => arr.findIndex((x) => x.url === v.url) === i);

  // Compute validation score based on evidence quality + issue severity
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const evidenceScore = Math.min(retrievedEvidence.length * 5, 100);
  const issuePenalty = errorCount * 20 + warningCount * 5;
  const score = Math.max(0, Math.min(100, evidenceScore - issuePenalty + 50));

  // Build RAG-enhanced summary
  const summaryLines: string[] = [];
  if (blocking) {
    summaryLines.push('BLOCKED: Blocking engineering errors found. ');
  } else {
    summaryLines.push('VALIDATED: No blocking errors. ');
  }
  summaryLines.push(`Evidence retrieved: ${retrievedEvidence.length} sources. `);
  summaryLines.push(`Score: ${Math.round(score)}/100.`);

  return {
    status: blocking ? 'blocked' : 'verified',
    score: Math.round(score),
    summary: summaryLines.join(''),
    issues,
    blocking,
    evidence: retrievedEvidence,
    componentSources,
  };
}
