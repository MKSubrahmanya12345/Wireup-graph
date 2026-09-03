/**
 * Frontend mirror of backend/src/agentic/specGraph.ts — the AI-driven
 * "Hardware Project Spec Graph" contract. Keep the two in sync.
 *
 * `requires` (dependency) and `spawned` (lineage) are two separate edge types;
 * only `requires` participates in dirty propagation.
 */

import type { ArchitectureGraph } from './architecture';

export type SpecNodeStatus =
  | 'unresolved'
  | 'assumed'
  | 'user_confirmed'
  | 'validated'
  | 'needs_revalidation';

export interface SpecAssumption {
  claim: string;
  why: string;
}

export interface SpecQuestion {
  id?: string;
  q: string;
  why_blocking: string;
  options?: string[];
  default?: string;
}

export interface SpecValidationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface SpecNode {
  id: string;
  domain: string;
  title: string;
  status: SpecNodeStatus;
  spec: Record<string, unknown>;
  /** Dependency edges — the node needs these resolved before it can validate. */
  requires: string[];
  /** Lineage edges — resolving this node is why these children exist. */
  spawned: string[];
  assumptions: SpecAssumption[];
  open_questions: SpecQuestion[];
  known_uncertainty: string[];
  validation: { checked: boolean; issues: SpecValidationIssue[] };
}

export interface SpecBranch {
  id: string;
  domain: string;
  status: SpecNodeStatus;
}

export interface SpecGraphProject {
  format: 'wireup-spec-graph';
  version: number;
  project_id: string;
  title: string;
  raw_prompt: string;
  domain: string;
  status: string;
  branches: SpecBranch[];
  question_queue: SpecQuestion[];
  assumption_log: { node_id: string; claim: string; why: string }[];
  nodes: Record<string, SpecNode>;
}

export interface SpecGraphResponse {
  specGraph: SpecGraphProject;
  archGraph: ArchitectureGraph;
  isReady: boolean;
}
