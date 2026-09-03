/**
 * Frontend mirror of backend/src/agentic/specGraph.ts — the AI-driven
 * "Hardware Project Spec Graph" contract. Keep the two in sync.
 *
 * `requires` (dependency) and `spawned` (lineage) are two separate edge types;
 * only `requires` participates in dirty propagation.
 *
 * §2: the root manifest holds POINTERS (question_queue → node.open_questions,
 * assumption_log → node.assumptions), never full copies — the resolvers below
 * dereference them against the live nodes.
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

/** §2 — pointer into node.open_questions: where an open question lives. */
export interface SpecQuestionPointer {
  node_id: string;
  question_id: string;
}

/** §2 — pointer into node.assumptions: one auditable silent decision. */
export interface SpecAssumptionPointer {
  node_id: string;
  index: number;
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
  question_queue: SpecQuestionPointer[];
  assumption_log: SpecAssumptionPointer[];
  nodes: Record<string, SpecNode>;
}

export interface SpecGraphResponse {
  specGraph: SpecGraphProject;
  archGraph: ArchitectureGraph;
  isReady: boolean;
}

/** A dereferenced open question — the question plus the node that asked it. */
export interface ResolvedQuestion {
  node_id: string;
  question: SpecQuestion;
}

/** A dereferenced assumption — pointer + content, for the audit log UI. */
export interface ResolvedAssumption {
  node_id: string;
  claim: string;
  why: string;
}

/**
 * Dereference the manifest's question pointers against the live nodes.
 * A pointer whose question has since been answered (removed from the node)
 * resolves to nothing and is skipped — the queue can never show a stale copy.
 */
export function resolveQuestionQueue(specGraph: SpecGraphProject): ResolvedQuestion[] {
  const resolved: ResolvedQuestion[] = [];
  for (const pointer of specGraph.question_queue ?? []) {
    const node = specGraph.nodes?.[pointer.node_id];
    const question = node?.open_questions.find((q) => (q.id ?? '') === pointer.question_id);
    if (node && question) {
      resolved.push({ node_id: pointer.node_id, question });
    }
  }
  return resolved;
}

/** Dereference the manifest's assumption pointers for the audit/override log. */
export function resolveAssumptionLog(specGraph: SpecGraphProject): ResolvedAssumption[] {
  const resolved: ResolvedAssumption[] = [];
  for (const pointer of specGraph.assumption_log ?? []) {
    const entry = specGraph.nodes?.[pointer.node_id]?.assumptions?.[pointer.index];
    if (entry) {
      resolved.push({ node_id: pointer.node_id, claim: entry.claim, why: entry.why });
    }
  }
  return resolved;
}
