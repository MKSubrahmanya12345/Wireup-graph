/** Frontend mirror of the backend intent contract + issue model. */

import type { SpecGraphProject } from './specGraph';

export type QuestionKind = 'single' | 'multi' | 'number' | 'boolean';

export interface QuestionOption {
  value: string;
  label: string;
  hint?: string;
}

export interface Question {
  id: string;
  prompt: string;
  why: string;
  impact: string;
  kind: QuestionKind;
  options: QuestionOption[];
  default: string;
  unit?: string;
  min?: number;
  max?: number;
}

export interface MechanicalRequirements {
  mobility?: 'static' | 'wheeled' | 'legged' | 'flying' | 'other';
  legCount?: number;
  minDofPerLeg?: number;
  gait?: string;
  payloadGrams?: number;
  legLengthCm?: number;
}

export interface PowerRequirements {
  source?: 'battery' | 'mains' | 'usb' | 'solar' | 'other';
  rechargeable?: boolean;
  targetRuntimeMinutes?: number;
}

export interface RequirementsSpec {
  project: string;
  intent: string;
  domain: string;
  mechanical: MechanicalRequirements;
  power: PowerRequirements;
  constraints: Record<string, unknown>;
  assumptions: string[];
  confidence: number;
}

export interface InterpretResponse {
  requirements: RequirementsSpec;
  questions: Question[];
  assumptions: string[];
  ready: boolean;
  /**
   * The spec graph behind this interpretation: one node per capability the
   * brief implied, every assumption the engine made, and the gate verdict on
   * each question. Present on the deterministic path and on the stream.
   */
  specGraph?: SpecGraphProject | null;
}

/** Re-exported so callers can import graph types from one place. */
export type { SpecGraphProject, SpecNode, SpecNodeQuestion } from './specGraph';

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

/**
 * The loop. The human spends their attention on `reviewing`, not on
 * `questioning` — that is the whole point.
 */
export type Stage =
  | 'idle'          // writing the brief
  | 'interpreting'  // AI is deciding what it can
  | 'questioning'   // AI asks only what it genuinely cannot decide
  | 'planning'      // building the graph
  | 'reviewing'     // human looks at the diagram
  | 'accepted';     // human clicked "Perfect!"