/**
 * Loop Diff Service — compares architecture graphs between loop
 * iterations so the user sees exactly what changed.
 */
import type { ArchitectureGraph, ArchitectureNode, ArchitectureConnection } from '../schemas/architecture.js';

export interface GraphDiff {
  loopId: string;
  addedNodes: ArchitectureNode[];
  removedNodes: ArchitectureNode[];
  modifiedNodes: Array<{ before: ArchitectureNode; after: ArchitectureNode; changes: string[] }>;
  addedConnections: ArchitectureConnection[];
  removedConnections: ArchitectureConnection[];
  modifiedConnections: Array<{ before: ArchitectureConnection; after: ArchitectureConnection; changes: string[] }>;
  summary: string;
}

function nodeKey(node: ArchitectureNode): string {
  return node.id ?? node.name ?? 'unknown';
}

function connectionKey(conn: ArchitectureConnection): string {
  return `${conn.from}-${conn.to}-${conn.fromPort ?? ''}-${conn.toPort ?? ''}-${conn.kind}`;
}

/**
 * Compare two graphs and return structured differences.
 */
export function compareGraphs(
  before: ArchitectureGraph,
  after: ArchitectureGraph,
  loopId: string,
): GraphDiff {
  const beforeNodes = (before.nodes ?? []) as ArchitectureNode[];
  const afterNodes = (after.nodes ?? []) as ArchitectureNode[];
  const beforeConnections = (before.connections ?? []) as ArchitectureConnection[];
  const afterConnections = (after.connections ?? []) as ArchitectureConnection[];

  const beforeNodeMap = new Map(beforeNodes.map((n) => [nodeKey(n), n]));
  const afterNodeMap = new Map(afterNodes.map((n) => [nodeKey(n), n]));

  const addedNodes = afterNodes.filter((n) => !beforeNodeMap.has(nodeKey(n)));
  const removedNodes = beforeNodes.filter((n) => !afterNodeMap.has(nodeKey(n)));

  const modifiedNodes: GraphDiff['modifiedNodes'] = [];
  for (const afterNode of afterNodes) {
    const beforeNode = beforeNodeMap.get(nodeKey(afterNode));
    if (!beforeNode) continue;
    const changes: string[] = [];
    if (beforeNode.name !== afterNode.name) changes.push(`name: "${beforeNode.name}" → "${afterNode.name}"`);
    if (beforeNode.type !== afterNode.type) changes.push(`type: ${beforeNode.type} → ${afterNode.type}`);
    if (beforeNode.partNumber !== afterNode.partNumber) changes.push(`part: ${beforeNode.partNumber ?? 'null'} → ${afterNode.partNumber ?? 'null'}`);
    if (changes.length > 0) {
      modifiedNodes.push({ before: beforeNode, after: afterNode, changes });
    }
  }

  const beforeConnMap = new Map(beforeConnections.map((c) => [connectionKey(c), c]));
  const afterConnMap = new Map(afterConnections.map((c) => [connectionKey(c), c]));

  const addedConnections = afterConnections.filter((c) => !beforeConnMap.has(connectionKey(c)));
  const removedConnections = beforeConnections.filter((c) => !afterConnMap.has(connectionKey(c)));

  const modifiedConnections: GraphDiff['modifiedConnections'] = [];
  for (const afterConn of afterConnections) {
    const beforeConn = beforeConnMap.get(connectionKey(afterConn));
    if (!beforeConn) continue;
    const connChanges: string[] = [];
    if (beforeConn.fromPort !== afterConn.fromPort) connChanges.push(`fromPort: ${beforeConn.fromPort ?? 'null'} → ${afterConn.fromPort ?? 'null'}`);
    if (beforeConn.toPort !== afterConn.toPort) connChanges.push(`toPort: ${beforeConn.toPort ?? 'null'} → ${afterConn.toPort ?? 'null'}`);
    if (beforeConn.label !== afterConn.label) connChanges.push(`label: ${beforeConn.label} → ${afterConn.label}`);
    if (beforeConn.details !== afterConn.details) connChanges.push('details changed');
    if (connChanges.length > 0) {
      modifiedConnections.push({ before: beforeConn, after: afterConn, changes: connChanges });
    }
  }

  const changes: string[] = [];
  if (addedNodes.length) changes.push(`+${addedNodes.length} nodes`);
  if (removedNodes.length) changes.push(`-${removedNodes.length} nodes`);
  if (modifiedNodes.length) changes.push(`~${modifiedNodes.length} nodes`);
  if (addedConnections.length) changes.push(`+${addedConnections.length} links`);
  if (removedConnections.length) changes.push(`-${removedConnections.length} links`);

  return {
    loopId,
    addedNodes,
    removedNodes,
    modifiedNodes,
    addedConnections,
    removedConnections,
    modifiedConnections,
    summary: changes.length ? `Changes: ${changes.join(', ')}` : 'No structural changes.',
  };
}
