/**
 * Frontend mirror of backend/src/schemas/architecture.ts.
 * Keep the two in sync — this is THE canonical graph contract.
 */

export const NODE_TYPES = [
  'controller', 'sensor', 'actuator', 'power', 'interface',
  'passive', 'communication', 'software', 'mechanical', 'other',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const CONNECTION_KINDS = [
  'power', 'ground', 'data', 'analog', 'mechanical', 'dependency', 'other',
] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export type PortDirection = 'in' | 'out' | 'bidirectional';

export interface NodePort {
  id: string;
  label: string;
  direction: PortDirection;
  signal: string;
}

export interface NodeProperty {
  label: string;
  value: string;
}

// ??$$$ — Optional 3D placement. All fields are optional so existing graphs
// without 3D data remain valid. 2D → 3D fallback mapping (documented contract):
//   position3d = { x: (node.x - 400) / 200, y: 0, z: (node.y - 300) / 200 }
//   dimensions  = default per node type (see partGeometry.ts)
export interface SpatialPlacement {
  position3d?: { x: number; y: number; z: number };   // metres, robot-local frame
  rotation3d?: { x: number; y: number; z: number };   // euler radians, XYZ order
  dimensions?: { w: number; h: number; d: number };   // metres, bounding box
  massGrams?: number;
  modelRef?: string;   // 'sg90' | '18650' | gltf url
  parentId?: string;   // kinematic mount (leg servo → body)
}

export interface ArchitectureNode {
  id: string;
  type: NodeType;
  name: string;
  partNumber: string | null;
  x: number;
  y: number;
  description: string;
  properties: NodeProperty[];
  ports: NodePort[];
  details: string[];
  // ??$$$ — optional 3D spatial fields; absent = use 2D fallback
  spatial?: SpatialPlacement;
}

export interface ArchitectureConnection {
  id: string;
  from: string;
  to: string;
  fromPort: string | null;
  toPort: string | null;
  label: string;
  kind: ConnectionKind;
  details: string;
}

export interface ArchitectureDependency {
  id: string;
  name: string;
  kind: string;
  version: string | null;
  reason: string;
}

export interface SoftwareItem {
  id: string;
  name: string;
  kind: string;
  version: string | null;
  details: string;
}

export type VerificationStatus = 'verified' | 'review' | 'blocked' | 'unavailable';
export type CheckStatus = 'pass' | 'review' | 'fail';

export interface VerificationCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  scope: 'node' | 'connection' | 'graph';
  targetId?: string;
}

export interface VerificationSource {
  title: string;
  url: string;
  usedFor: string;
}

export interface VerificationReport {
  status: VerificationStatus;
  score: number;
  summary: string;
  checks: VerificationCheck[];
  sources: VerificationSource[];
}

export interface ArchitectureGraph {
  project: string;
  summary: string;
  nodes: ArchitectureNode[];
  connections: ArchitectureConnection[];
  dependencies: ArchitectureDependency[];
  software: SoftwareItem[];
  notes: string[];
}

export type IssueSeverity = 'error' | 'warning' | 'notice';

export interface Issue {
  id: string;
  severity: IssueSeverity;
  code: string;
  title: string;
  detail: string;
  scope: 'node' | 'connection' | 'graph';
  targetId?: string;
  remedy?: string;
  evidence?: Record<string, string | number>;
}

export interface PlanResponse extends ArchitectureGraph {
  verification?: VerificationReport | null;
  /** Deterministic engineering violations. Never LLM-generated. */
  issues?: Issue[];
  blocking?: boolean;
  projectId?: string | null;
  revisionId?: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  summary: string;
  nodeCount: number;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  graph: ArchitectureGraph;
  verification: VerificationReport | null;
  revisions: { id: string; request: string; createdAt: string }[];
}

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

export function nodeLabel(node: ArchitectureNode): string {
  return node.name || node.id;
}