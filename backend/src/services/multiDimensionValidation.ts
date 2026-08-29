/**
 * Multi-Dimension Validation — validates across electrical,
 * mechanical, thermal, and software dimensions independently.
 */
import { runEngineeringChecks, type Issue } from '../data/engineeringRules.js';
import { officialComponentCatalog, catalogMatches } from '../data/componentCatalog.js';
import { PARTS, resolvePart } from '../data/partLibrary.js';
import type { ArchitectureGraph } from '../schemas/architecture.js';

export interface DimensionResult {
  dimension: 'electrical' | 'mechanical' | 'thermal' | 'software';
  score: number; // 0-100
  blocking: boolean;
  issues: Issue[];
  evidence: string[];
}

/**
 * Validate across all dimensions.
 */
export function validateAllDimensions(
  graph: ArchitectureGraph,
): DimensionResult[] {
  const results: DimensionResult[] = [];

  // Electrical — existing engineering rules.
  const electricalIssues = runEngineeringChecks(graph, undefined);
  const electricalBlocking = electricalIssues.some((i) => i.severity === 'error');
  results.push({
    dimension: 'electrical',
    score: Math.max(0, 100 - electricalIssues.filter((i) => i.severity === 'error').length * 20 - electricalIssues.filter((i) => i.severity === 'warning').length * 5),
    blocking: electricalBlocking,
    issues: electricalIssues,
    evidence: ['engineering-rules-check', 'component-catalog-match'],
  });

  // Mechanical — check mechanical nodes, connections, and layout.
  const mechanicalIssues: Issue[] = [];
  const nodes = (graph.nodes ?? []) as Array<{ id: string; type: string; name: string; spatial?: { dimensions?: { w?: number; h?: number; d?: number } } }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const node of nodes) {
    if (node.type === 'mechanical' && !node.spatial?.dimensions) {
      mechanicalIssues.push({
        id: `mech-dim-${node.id}`,
        severity: 'warning',
        code: 'MECHANICAL_DIM_MISSING',
        title: 'Mechanical component has no dimensions',
        detail: `${node.name} needs dimensions for assembly.`,
        scope: 'node',
        targetId: node.id,
        remedy: 'Add dimensions (w/h/d) to the spatial block.',
      });
    }
  }
  const mechanicalConnections = (graph.connections ?? []).filter(
    (c) => c.kind === 'mechanical',
  );
  if (nodes.filter((n) => n.type === 'mechanical').length > 0 && mechanicalConnections.length === 0) {
    mechanicalIssues.push({
      id: 'mech-no-links',
      severity: 'warning',
      code: 'MECHANICAL_NO_LINKS',
      title: 'Mechanical components not linked',
      detail: 'Mechanical parts exist but have no mechanical connections.',
      scope: 'graph',
      remedy: 'Add mechanical connections between structural parts.',
    });
  }
  results.push({
    dimension: 'mechanical',
    score: Math.max(0, 100 - mechanicalIssues.length * 15),
    blocking: false,
    issues: mechanicalIssues,
    evidence: ['graph-spatial-data'],
  });

  // Thermal — basic thermal checks based on current draw and enclosure.
  const thermalIssues: Issue[] = [];
  const powerSources = nodes.filter((n) => n.type === 'power');
  const currentDrawNodes = nodes.filter((n) => n.type === 'actuator' || n.type === 'controller');
  const totalDraw = currentDrawNodes.length * 150; // rough estimate
  if (totalDraw > 1500 && powerSources.length === 1) {
    thermalIssues.push({
      id: 'thermal-high-draw',
      severity: 'warning',
      code: 'THERMAL_HIGH_DRAW',
      title: 'High current draw with single power source',
      detail: `Estimated ${totalDraw} mA draw may cause heating; check thermal design.`,
      scope: 'graph',
      remedy: 'Add thermal management or split loads.',
    });
  }
  results.push({
    dimension: 'thermal',
    score: Math.max(0, 100 - thermalIssues.length * 20),
    blocking: false,
    issues: thermalIssues,
    evidence: ['current-estimate', 'power-source-count'],
  });

  // Software — check dependencies, software items, and interfaces.
  const softwareIssues: Issue[] = [];
  const dependencies = (graph.dependencies ?? []) as Array<{ name?: string; kind?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const softwareItems = (graph.software ?? []) as Array<{ name?: string; version?: string | null }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (dependencies.length === 0 && softwareItems.length > 0) {
    softwareIssues.push({
      id: 'software-no-deps',
      severity: 'notice',
      code: 'SOFTWARE_MISSING_DEPS',
      title: 'Software items without declared dependencies',
      detail: 'Software components exist but have no dependency entries.',
      scope: 'graph',
      remedy: 'List firmware libraries, protocols, and build tools as dependencies.',
    });
  }
  if (dependencies.length > 0 && dependencies.every((d) => !d.name || d.name.trim() === '')) {
    softwareIssues.push({
      id: 'software-empty-deps',
      severity: 'warning',
      code: 'SOFTWARE_EMPTY_DEPS',
      title: 'Empty dependency names',
      detail: 'Dependencies exist but have no names.',
      scope: 'graph',
      remedy: 'Name each dependency (library, protocol, tool).',
    });
  }
  results.push({
    dimension: 'software',
    score: Math.max(0, 100 - softwareIssues.filter((i) => i.severity === 'warning').length * 10 - softwareIssues.filter((i) => i.severity === 'notice').length * 3),
    blocking: false,
    issues: softwareIssues,
    evidence: ['dependencies', 'software-items'],
  });

  return results;
}
