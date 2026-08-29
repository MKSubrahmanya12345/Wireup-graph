/**
 * Agentic PRD Generator — produces a complete Product Requirements
 * Document from the verified Graph DSA data, structured specifically
 * for agentic coding agents (file structure, build steps, wiring,
 * BOM, test plan, etc.).
 */
import type { ArchitectureGraph } from '../schemas/architecture.js';
import type { VerificationReport } from '../schemas/architecture.js';
import type { DSAEvidenceRecord, DSADoubtRecord, DSAValidationLoopRecord } from '../models/GraphDSA.js';

export interface AgenticPRD {
  version: string;
  generatedAt: string;
  projectName: string;
  summary: string;
  status: 'draft' | 'verified' | 'perfect';
  // Sections for the agentic agent.
  architectureGraph: ArchitectureGraph;
  verificationReport: VerificationReport | null;
  componentBillOfMaterials: ComponentBOMItem[];
  wiringInstructions: string[];
  buildSteps: string[];
  testPlan: string[];
  fileStructure: FileStructureItem[];
  dependencies: DependencyItem[];
  notes: string[];
  ragEvidence: DSAEvidenceRecord[];
  doubts: DSADoubtRecord[];
  validationLoops: DSAValidationLoopRecord[];
}

export interface ComponentBOMItem {
  id: string;
  name: string;
  partNumber: string | null;
  quantity: number;
  specifications: string;
  sourceUrl: string | null;
  notes: string[];
}

export interface FileStructureItem {
  path: string;
  purpose: string;
  contents: string[]; // high-level content descriptions
}

export interface DependencyItem {
  name: string;
  version: string | null;
  kind: string;
  reason: string;
  sourceUrl?: string;
}

/**
 * Generate the full agentic PRD.
 */
export function generateAgenticPRD(
  projectName: string,
  summary: string,
  graph: ArchitectureGraph,
  verification: VerificationReport | null,
  ragEvidence: DSAEvidenceRecord[],
  doubts: DSADoubtRecord[],
  validationLoops: DSAValidationLoopRecord[],
  isPerfect: boolean,
): AgenticPRD {
  // Build BOM from nodes.
  const nodeCounts = new Map<string, { node: unknown; count: number }>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const node of (graph.nodes ?? []) as unknown[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const n = node as { id?: string; name?: string; partNumber?: string | null; type?: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const key = n.id ?? n.name ?? 'unknown';
    if (!nodeCounts.has(key)) {
      nodeCounts.set(key, { node, count: 1 });
    } else {
      nodeCounts.get(key)!.count += 1;
    }
  }

  const bom: ComponentBOMItem[] = [];
  for (const [key, { node, count }] of nodeCounts) {
    const n = node as { id?: string; name?: string; partNumber?: string | null; type?: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const evidence = ragEvidence.find((e) => e.sourceId === `part-spec-${n.partNumber?.toLowerCase()}` || e.sourceTitle.toLowerCase().includes(String(n.name ?? '').toLowerCase()));
    bom.push({
      id: String(n.id ?? key),
      name: String(n.name ?? 'Unnamed component'),
      partNumber: n.partNumber ? String(n.partNumber) : null,
      quantity: count,
      specifications: evidence?.contentSnippet ?? `Type: ${n.type ?? 'other'}`,
      sourceUrl: evidence?.sourceUrl ?? null,
      notes: [`Count in design: ${count}`],
    });
  }

  // Wiring instructions derived from connections.
  const connections = (graph.connections ?? []) as Array<{ from?: string; to?: string; fromPort?: string | null; toPort?: string | null; label?: string; kind?: string; details?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const wiringInstructions = connections.map((c) => {
    const fromPort = c.fromPort ? ` (${c.fromPort})` : '';
    const toPort = c.toPort ? ` (${c.toPort})` : '';
    return `${String(c.from ?? '?')}${fromPort} → ${String(c.to ?? '?')}${toPort} [${c.kind ?? 'other'}] — ${c.label ?? 'link'}${c.details ? ': ' + c.details : ''}`;
  });

  // Build steps — standard sequence.
  const buildSteps = [
    '1. Gather all components listed in BOM.',
    '2. Verify voltage levels and current ratings against specifications.',
    '3. Assemble mechanical structure (if mechanical nodes present).',
    '4. Wire connections according to wiring instructions.',
    '5. Add pull-ups, capacitors, and protection as specified.',
    '6. Program controller with firmware (refer to software dependencies).',
    '7. Test each subsystem individually before full integration.',
    '8. Run full validation loop and resolve remaining doubts.',
    '9. Generate final image render and confirm design.',
  ];

  // Test plan — derived from verification checks.
  const testPlan: string[] = [];
  if (verification?.checks) {
    for (const check of verification.checks as Array<{ title?: string; status?: string; detail?: string }>) { // eslint-disable-line @typescript-eslint/no-explicit-any
      testPlan.push(`Test: ${check.title ?? 'Check'} (${check.status ?? 'unknown'}) — ${check.detail ?? ''}`);
    }
  } else {
    testPlan.push('Test electrical connections and voltage levels.',
      'Test mechanical assembly stability.',
      'Test thermal performance under load.',
      'Test software interfaces and protocols.');
  }

  // File structure — standard agentic coding output.
  const fileStructure: FileStructureItem[] = [
    { path: 'README.md', purpose: 'Project overview and build instructions', contents: ['Overview', 'BOM reference', 'Build steps'] },
    { path: 'hardware/', purpose: 'Physical design files', contents: ['Schematic (if available)', 'PCB layout (if available)', '3D model references'] },
    { path: 'firmware/', purpose: 'Embedded code', contents: ['Main application', 'Driver modules', 'Configuration files'] },
    { path: 'tests/', purpose: 'Validation and test scripts', contents: ['Unit tests', 'Integration tests', 'Validation scripts'] },
    { path: 'docs/', purpose: 'Documentation', contents: ['Wiring diagram', 'Assembly instructions', 'PRD (this file)'] },
  ];

  return {
    version: 'agentic-prd-v1.0.0',
    generatedAt: new Date().toISOString(),
    projectName,
    summary,
    status: isPerfect ? 'perfect' : verification?.status === 'verified' ? 'verified' : 'draft',
    architectureGraph: graph,
    verificationReport: verification,
    componentBillOfMaterials: bom,
    wiringInstructions,
    buildSteps,
    testPlan,
    fileStructure,
    dependencies: (graph.dependencies ?? []).map((d) => {
      const dep = d as { id?: string; name?: string; kind?: string; version?: string | null; reason?: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
      return {
        name: String(dep.name ?? dep.id ?? 'Unknown'),
        version: dep.version ? String(dep.version) : null,
        kind: String(dep.kind ?? 'other'),
        reason: String(dep.reason ?? ''),
      };
    }),
    notes: [
      'This PRD is generated from verified Graph DSA data.',
      isPerfect ? 'Project data is perfect — ready for agentic coding agent.' : 'Some doubts or issues remain. Resolve before sending to agent.',
      'All component references include official sources when available.',
    ],
    ragEvidence,
    doubts,
    validationLoops,
  };
}
