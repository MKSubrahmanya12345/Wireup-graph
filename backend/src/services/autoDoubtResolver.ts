/**
 * Auto-Doubt Resolver — resolves doubts automatically when the
 * component catalog, engineering rules, or graph data provide a
 * clear, non-ambiguous answer. Keeps the human in the loop only
 * when the machine genuinely cannot decide.
 */
import { officialComponentCatalog, catalogMatches } from '../data/componentCatalog.js';
import { runEngineeringChecks, hasBlockingIssue } from '../data/engineeringRules.js';
import { resolvePart } from '../data/partLibrary.js';
import type { Question } from '../schemas/requirements.js';
import type { ArchitectureGraph } from '../schemas/architecture.js';

export interface AutoResolution {
  questionId: string;
  resolved: boolean;
  resolution: string;
  confidence: number; // 0-1
  reason: string;
}

/**
 * Try to resolve doubts automatically based on evidence.
 */
export function resolveDoubtsAutomatically(
  doubts: Question[],
  graph: ArchitectureGraph,
  requirements?: Record<string, unknown> | null,
): AutoResolution[] {
  const results: AutoResolution[] = [];

  // Retrieve catalog evidence once.
  const matchedRecords = catalogMatches(graph as unknown as Record<string, unknown>);
  const catalogEvidence = new Set(
    matchedRecords.flatMap((r) => [r.family, ...r.partNumbers]),
  );

  for (const doubt of doubts) {
    const resolution: AutoResolution = {
      questionId: doubt.id,
      resolved: false,
      resolution: '',
      confidence: 0,
      reason: '',
    };

    // If the doubt is about leg count and the graph already has servos,
    // compute from servo count / legCount from requirements.
    if (doubt.id.toLowerCase().includes('leg') || doubt.prompt.toLowerCase().includes('leg')) {
      const servoNodes = (graph.nodes ?? []).filter(
        (node: { type?: string }) => node?.type === 'actuator',
      );
      const legCount = requirements?.mechanical?.legCount ?? 4;
      if (servoNodes.length > 0) {
        const perLeg = servoNodes.length / (Number(legCount) || 4);
        if (perLeg >= 2) {
          resolution.resolved = true;
          resolution.resolution = String(Math.round(perLeg));
          resolution.confidence = 0.85;
          resolution.reason = `Graph has ${servoNodes.length} actuators across ${legCount} legs (${perLeg.toFixed(1)} per leg).`;
        }
      }
    }

    // If the doubt is about power source and there's a battery node,
    // resolve to battery.
    if (doubt.prompt.toLowerCase().includes('power') || doubt.prompt.toLowerCase().includes('source')) {
      const hasBattery = (graph.nodes ?? []).some(
        (node: { type?: string; name?: string; partNumber?: string }) =>
          node?.type === 'power' ||
          String(node?.name ?? '').toLowerCase().includes('battery') ||
          String(node?.partNumber ?? '').toLowerCase().includes('battery'),
      );
      if (hasBattery) {
        resolution.resolved = true;
        resolution.resolution = 'battery';
        resolution.confidence = 0.9;
        resolution.reason = 'Design contains a battery/power node; battery source is verified.';
      }
    }

    // If the doubt is about mobility and nodes indicate walking,
    // resolve to legged.
    if (doubt.prompt.toLowerCase().includes('mobility') || doubt.prompt.toLowerCase().includes('move')) {
      const hasLegNodes = (graph.nodes ?? []).some(
        (node: { name?: string }) =>
          String(node?.name ?? '').toLowerCase().includes('leg'),
      );
      if (hasLegNodes) {
        resolution.resolved = true;
        resolution.resolution = 'legged';
        resolution.confidence = 0.88;
        resolution.reason = 'Component names include leg-related parts; mobility is legged.';
      }
    }

    // If catalog evidence strongly supports a component identity,
    // resolve identity-related doubts.
    if (catalogEvidence.size > 0 && doubt.prompt.toLowerCase().includes('component')) {
      resolution.resolved = false; // Not enough info for full resolution
      resolution.confidence = 0.5;
      resolution.reason = `Evidence found (${catalogEvidence.size} catalog matches) but identity requires confirmation.`;
    }

    results.push(resolution);
  }

  return results;
}
