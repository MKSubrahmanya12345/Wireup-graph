import type { Edge, Node } from '@xyflow/react';

import type { ArchitectureGraph, ArchitectureNode } from '../types/architecture';
import { connectionColor } from './palette';

export type ArchitectureNodeData = {
  node: ArchitectureNode;
  selected: boolean;
};

export type ArchitectureNodeType = Node<ArchitectureNodeData, 'architecture'>;

export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 104;

/**
 * canonical graph -> React Flow.
 *
 * This is a pure derivation: React Flow never owns the graph, it only renders
 * it. Positions flow back through moveNode(), which writes straight into
 * canonical x/y — so what we POST is always the server shape and the contract
 * cannot drift across edit turns.
 */
export function toFlowNodes(
  graph: ArchitectureGraph,
  selectedNodeId: string | null,
): ArchitectureNodeType[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: 'architecture' as const,
    position: { x: node.x, y: node.y },
    data: { node, selected: node.id === selectedNodeId },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));
}

/**
 * Every pin renders as two distinct handles: an out half on the right and an
 * in half on the left.
 *
 * They are deliberately independent of `port.direction`. A declared direction
 * is the model's opinion, and when it is wrong an edge used to resolve to no
 * handle at all — React Flow then draws it floating out of the node's centre,
 * which reads as a broken diagram rather than a debatable one. Pinning both
 * halves unconditionally means the wiring is always drawn where it belongs;
 * direction stays available for colouring and semantics.
 */
export function sourceHandleId(portId: string): string {
  return `${portId}__out`;
}

export function targetHandleId(portId: string): string {
  return `${portId}__in`;
}

/** Case/punctuation-insensitive, so "GPIO 4" matches a pin id of "gpio4". */
function portKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Picks the pin to use when a connection has no resolvable port reference.
 *
 * Prefers a pin whose signal matches the connection's own kind, so a power
 * link lands on a power pin instead of arbitrarily on the first pin listed.
 */
function fallbackPort(node: ArchitectureNode, kind: string) {
  const usable = node.ports.filter((port) => port.id);
  if (usable.length === 0) return undefined;

  const wanted = portKey(kind);
  return (
    usable.find((port) => portKey(port.signal) === wanted) ??
    usable.find((port) => portKey(port.label) === wanted) ??
    usable[0]
  );
}

/**
 * Resolves a connection's port reference to a handle.
 *
 * Matches the pin's id, then its label, then its signal name — the planner is
 * asked for "port-id or signal name" and sends all three in practice.
 *
 * When nothing matches (or no pin was named at all) it falls back to a real
 * pin instead of returning nothing. An edge with no handle is drawn floating
 * out of the node's centre, which reads as a broken diagram; an edge on a real
 * pin stays readable, and the backend repair pass records the substitution so
 * the human can see it and correct it.
 */
function resolveHandle(
  node: ArchitectureNode | undefined,
  portRef: string | null,
  side: 'source' | 'target',
  kind: string,
): string | undefined {
  if (!node) return undefined;

  const key = portRef ? portKey(portRef) : '';
  const port = key
    ? node.ports.find((candidate) => portKey(candidate.id) === key) ??
      node.ports.find((candidate) => portKey(candidate.label) === key) ??
      node.ports.find((candidate) => portKey(candidate.signal) === key)
    : undefined;

  const resolved = port?.id ? port : fallbackPort(node, kind);
  if (!resolved?.id) return undefined;

  return side === 'source' ? sourceHandleId(resolved.id) : targetHandleId(resolved.id);
}

export function toFlowEdges(graph: ArchitectureGraph): Edge[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();

  return graph.connections
    .filter((connection) => byId.has(connection.from) && byId.has(connection.to))
    // React Flow keys edges by id: duplicates collide and silently drop.
    .filter((connection) => {
      if (seen.has(connection.id)) return false;
      seen.add(connection.id);
      return true;
    })
    .map((connection) => ({
      id: connection.id,
      source: connection.from,
      target: connection.to,
      sourceHandle: resolveHandle(byId.get(connection.from), connection.fromPort, 'source', connection.kind),
      targetHandle: resolveHandle(byId.get(connection.to), connection.toPort, 'target', connection.kind),
      label: connection.label,
      animated: connection.kind === 'data',
      style: {
        stroke: connectionColor(connection.kind),
        strokeWidth: connection.kind === 'power' ? 2.4 : 1.6,
        strokeDasharray: connection.kind === 'dependency' ? '5 4' : undefined,
      },
      labelStyle: { font: '10px "DM Mono", monospace', fill: '#78908c' },
      labelBgStyle: { fill: '#fbfcfb' },
      labelBgPadding: [4, 2] as [number, number],
    }));
}

/**
 * True when the canvas would be unreadable as-is.
 *
 * The old test only caught the case where *every* node shared one coordinate.
 * The common failure is narrower: the planner omits x/y on a couple of nodes,
 * they land on the same default, and they sit exactly on top of each other
 * while the rest of the graph looks fine. Any overlapping pair counts.
 */
export function needsAutoLayout(nodes: ArchitectureNode[]): boolean {
  if (nodes.length < 2) return false;

  const allSamePosition = new Set(nodes.map((node) => `${node.x}:${node.y}`)).size === 1;
  if (allSamePosition) return true;

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (!a || !b) continue;
      if (Math.abs(a.x - b.x) < NODE_WIDTH / 2 && Math.abs(a.y - b.y) < NODE_HEIGHT / 2) {
        return true;
      }
    }
  }

  return false;
}

export function autoLayout(graph: ArchitectureGraph): ArchitectureGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node, index) => ({
      ...node,
      x: 80 + (index % 3) * 300,
      y: 70 + Math.floor(index / 3) * 190,
    })),
  };
}