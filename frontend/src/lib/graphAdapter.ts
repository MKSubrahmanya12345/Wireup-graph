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

/** Bidirectional ports need distinct ids for their source and target halves. */
export function targetHandleId(portId: string, bidirectional: boolean): string {
  return bidirectional ? `${portId}__in` : portId;
}

function resolveHandle(
  node: ArchitectureNode | undefined,
  portId: string | null,
  side: 'source' | 'target',
): string | undefined {
  if (!node || !portId) return undefined;
  const port = node.ports.find((candidate) => candidate.id === portId || candidate.label === portId);
  if (!port) return undefined;
  if (side === 'source') {
    return port.direction === 'in' ? undefined : port.id;
  }
  return port.direction === 'out' ? undefined : targetHandleId(port.id, port.direction === 'bidirectional');
}

export function toFlowEdges(graph: ArchitectureGraph): Edge[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  return graph.connections
    .filter((connection) => byId.has(connection.from) && byId.has(connection.to))
    .map((connection) => ({
      id: connection.id,
      source: connection.from,
      target: connection.to,
      sourceHandle: resolveHandle(byId.get(connection.from), connection.fromPort, 'source'),
      targetHandle: resolveHandle(byId.get(connection.to), connection.toPort, 'target'),
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

export function needsAutoLayout(nodes: ArchitectureNode[]): boolean {
  if (nodes.length < 2) return false;
  return new Set(nodes.map((node) => `${node.x}:${node.y}`)).size === 1;
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