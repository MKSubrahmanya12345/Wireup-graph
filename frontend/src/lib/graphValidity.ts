import type { ArchitectureGraph, Issue, VerificationReport } from '../types/architecture';

/**
 * THE graph validity check — one implementation, used by page 02 (the
 * "Send to the agentic build" gate) and page 01 (the "Complete" gate).
 *
 * Keeping this in one place is the point: page 01 must never be able to let a
 * graph through that page 02 would reject.
 */
export interface GraphValidity {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  /** Why it is invalid, in words the human can act on. */
  reason: string;
}

export function evaluateGraphValidity(input: {
  graph: ArchitectureGraph;
  issues: Issue[];
  blocking: boolean;
  verification?: VerificationReport | null;
}): GraphValidity {
  const { graph, issues, blocking, verification } = input;
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;

  if (graph.nodes.length === 0) {
    return { valid: false, errorCount, warningCount, reason: 'No components identified yet.' };
  }
  if (blocking) {
    return {
      valid: false,
      errorCount,
      warningCount,
      reason: 'Blocking engineering issues must be resolved first.',
    };
  }
  if (errorCount > 0) {
    return {
      valid: false,
      errorCount,
      warningCount,
      reason: `${errorCount} engineering error(s) still open.`,
    };
  }
  if (verification?.status === 'blocked') {
    return {
      valid: false,
      errorCount,
      warningCount,
      reason: 'Structural verification is blocked.',
    };
  }
  return {
    valid: true,
    errorCount,
    warningCount,
    reason: warningCount > 0 ? `Graph valid (${warningCount} warning(s)).` : 'Graph valid.',
  };
}
