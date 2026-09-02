/**
 * Frontend mirror of the Wireup Spec Graph.
 *
 * This is the artifact the engine builds BEFORE any wiring exists: one node
 * per capability the brief implies, each carrying the facts a coding agent
 * needs, the assumptions the engine made on the human's behalf, and — only
 * when all three legs of the gate hold — the questions it could not answer.
 */

export type SpecNodeStatus =
  | 'unresolved'
  | 'assumed'
  | 'user_confirmed'
  | 'validated'
  | 'needs_revalidation';

export interface AskGateVerdict {
  ask: boolean;
  blocking: boolean;
  multi_valued_no_safe_default: boolean;
  not_inferable: boolean;
  verdict: 'ask' | 'assume';
  /** The audit trail: which legs passed, which failed, and what that means. */
  reason: string;
}

export interface SpecNodeQuestion {
  id?: string;
  q: string;
  why_blocking: string;
  options?: string[];
  default?: string;
  gate?: AskGateVerdict;
}

export interface SpecNodeAssumption {
  claim: string;
  why: string;
}

export interface SpecNode {
  id: string;
  domain: string;
  title: string;
  status: SpecNodeStatus;
  spec: Record<string, unknown>;
  requires: string[];
  produces: string[];
  assumptions: SpecNodeAssumption[];
  open_questions: SpecNodeQuestion[];
  validation: {
    checked: boolean;
    issues: { severity: 'error' | 'warning' | 'info'; message: string }[];
  };
}

export interface SpecGraphProject {
  format: string;
  version: number;
  project: {
    id: string;
    title: string;
    raw_prompt: string;
    domain: string;
    status: string;
  };
  question_queue: SpecNodeQuestion[];
  assumption_log: { node_id: string; claim: string; why: string }[];
  nodes: Record<string, SpecNode>;
}

/** One line of the engine's progress trail. */
export interface ProgressStep {
  stage: string;
  title: string;
  detail?: string;
  at: number;
}

/** The NDJSON events emitted by POST /api/architecture/interpret/stream. */
export type InterpretStreamEvent =
  | { type: 'stage'; stage: string; title: string; detail?: string }
  | { type: 'node'; node: SpecNode }
  | { type: 'assumption'; node_id: string; claim: string; why: string }
  | { type: 'question'; question: SpecNodeQuestion }
  | { type: 'refined'; questions: { id: string; prompt: string }[] }
  | { type: 'warn'; message: string }
  | {
      type: 'done';
      requirements: import('./session').RequirementsSpec;
      questions: import('./session').Question[];
      assumptions: string[];
      ready: boolean;
      specGraph?: SpecGraphProject;
    }
  | { type: 'error'; error: string };

/** Human-friendly labels for the statuses the engine can put a node in. */
export const STATUS_LABEL: Record<SpecNodeStatus, string> = {
  unresolved: 'waiting on you',
  assumed: 'decided for you',
  user_confirmed: 'your answer',
  validated: 'validated',
  needs_revalidation: 'needs re-check',
};
