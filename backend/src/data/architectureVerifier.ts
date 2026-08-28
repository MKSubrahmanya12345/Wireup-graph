import type { ArchitectureGraph } from '../schemas/architecture.js';
import type { OfficialComponentRecord } from './componentCatalog.js';

export type StructuralCheck = {
  id: string;
  title: string;
  status: 'pass' | 'review' | 'fail';
  detail: string;
  scope: 'node' | 'connection' | 'graph';
  targetId?: string;
};

/**
 * Deterministic checks that run regardless of what the LLM returns. They are
 * the floor of the verification report — the model may add to them, never
 * silently replace them with nothing.
 */
export function runStructuralChecks(
  graph: ArchitectureGraph,
  catalog: OfficialComponentRecord[],
): StructuralCheck[] {
  const { nodes, connections } = graph;
  const ids = new Set(nodes.map((node) => node.id));
  const checks: StructuralCheck[] = [];

  const idsAreUnique = ids.size === nodes.length && !ids.has('');
  checks.push({
    id: 'node-ids',
    title: 'Stable component identifiers',
    status: idsAreUnique ? 'pass' : 'fail',
    detail: idsAreUnique
      ? 'Every component has a unique id.'
      : 'One or more components are missing a unique id.',
    scope: 'graph',
  });

  for (const connection of connections) {
    const endpointsResolve = ids.has(connection.from) && ids.has(connection.to) && connection.from !== connection.to;
    checks.push({
      id: `connection-endpoints-${connection.id}`,
      title: 'Connection endpoints resolve',
      status: endpointsResolve ? 'pass' : 'fail',
      detail: endpointsResolve
        ? `${connection.from} → ${connection.to} references existing components.`
        : `This connection has a missing or self-referencing endpoint (${connection.from} → ${connection.to}).`,
      scope: 'connection',
      targetId: connection.id,
    });

    // Only evaluate ports that were actually declared — an absent port is an
    // unknown, not a failure.
    const declaredPorts = [
      { nodeId: connection.from, port: connection.fromPort, side: 'source' as const },
      { nodeId: connection.to, port: connection.toPort, side: 'target' as const },
    ].filter((entry): entry is { nodeId: string; port: string; side: 'source' | 'target' } =>
      Boolean(entry.port),
    );

    if (declaredPorts.length === 0) {
      checks.push({
        id: `connection-ports-${connection.id}`,
        title: 'Connection ports are declared',
        status: 'review',
        detail: 'No explicit port mapping was returned; verify pin names against the data sheets.',
        scope: 'connection',
        targetId: connection.id,
      });
      continue;
    }

    const unresolved = declaredPorts.filter(({ nodeId, port }) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return true;
      return !node.ports.some((candidate) => candidate.id.toLowerCase() === port.toLowerCase());
    });

    checks.push({
      id: `connection-ports-${connection.id}`,
      title: 'Connection ports are declared',
      status: unresolved.length ? 'fail' : 'pass',
      detail: unresolved.length
        ? `Port(s) ${unresolved.map((entry) => `${entry.nodeId}.${entry.port}`).join(', ')} are not declared on their component.`
        : 'Every declared endpoint port exists on its component.',
      scope: 'connection',
      targetId: connection.id,
    });
  }

  for (const node of nodes) {
    const part = node.partNumber?.trim() ?? '';
    const matched = Boolean(part) && catalogMatchesPart(catalog, part);
    checks.push({
      id: `component-source-${node.id}`,
      title: 'Official component reference',
      status: matched ? 'pass' : 'review',
      detail: matched
        ? `${part} matches the official component bank.`
        : part
          ? `${part} is not in the current official component bank; verify its data sheet.`
          : 'No part number was returned; choose an exact orderable part before fabrication.',
      scope: 'node',
      targetId: node.id,
    });
  }

  checks.push({
    id: 'graph-connectivity',
    title: 'System connectivity',
    status: connections.length === 0 && nodes.length > 1 ? 'fail' : 'pass',
    detail:
      connections.length === 0 && nodes.length > 1
        ? 'Multiple components were returned without any connections.'
        : connections.length === 0
          ? 'No components yet — nothing to connect.'
          : 'The graph contains an explicit connection map for the returned components.',
    scope: 'graph',
  });

  return checks;
}

function catalogMatchesPart(catalog: OfficialComponentRecord[], part: string): boolean {
  const needle = part.toLowerCase();
  return catalog.some((record) =>
    [record.family, ...record.partNumbers].some((candidate) => candidate.toLowerCase() === needle),
  );
}