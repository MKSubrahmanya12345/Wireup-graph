import { useMemo } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { layoutSpecGraph } from '../lib/specGraphLayout';
import { statusMeta } from '../lib/specGraphStatus';
import type { SpecGraphProject } from '../types/specGraph';
import SpecFlowNode, { type SpecFlowNodeType } from './SpecFlowNode';

const nodeTypes = { spec: SpecFlowNode };

interface SpecGraphCanvasProps {
  specGraph: SpecGraphProject;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * The "Live 2D Architecture Twin" — renders the AI-produced spec graph with
 * `requires` (dependency, solid cyan) and `spawned` (lineage, dashed violet)
 * visually distinct, status-driven nodes and a dependency-aware layout.
 */
export default function SpecGraphCanvas({
  specGraph,
  selectedId,
  onSelect,
}: SpecGraphCanvasProps) {
  const { nodes, edges } = useMemo(() => {
    const positions = layoutSpecGraph(specGraph);
    const allNodes = Object.values(specGraph.nodes);

    const flowNodes: SpecFlowNodeType[] = allNodes.map((node) => ({
      id: node.id,
      type: 'spec',
      position: positions[node.id] ?? { x: 40, y: 40 },
      data: { node, selected: node.id === selectedId },
    }));

    const flowEdges: Edge[] = [];

    for (const node of allNodes) {
      (node.requires ?? []).forEach((reqId, index) => {
        if (!specGraph.nodes[reqId]) return;
        flowEdges.push({
          id: `req-${node.id}-${reqId}-${index}`,
          source: node.id,
          target: reqId,
          label: 'requires',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#38bdf8', width: 16, height: 16 },
          style: { stroke: '#38bdf8', strokeWidth: 1.6 },
          labelStyle: { fill: '#7dd3fc', font: '10px "DM Mono", monospace' },
          labelBgStyle: { fill: '#0b1120', fillOpacity: 0.95 },
          labelBgPadding: [3, 2] as [number, number],
          labelBgBorderRadius: 4,
        });
      });

      (node.spawned ?? []).forEach((childId, index) => {
        if (!specGraph.nodes[childId]) return;
        flowEdges.push({
          id: `spawn-${node.id}-${childId}-${index}`,
          source: node.id,
          target: childId,
          label: 'spawned',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#a78bfa', width: 16, height: 16 },
          style: { stroke: '#a78bfa', strokeWidth: 1.4, strokeDasharray: '6 4' },
          labelStyle: { fill: '#c4b5fd', font: '10px "DM Mono", monospace' },
          labelBgStyle: { fill: '#0b1120', fillOpacity: 0.95 },
          labelBgPadding: [3, 2] as [number, number],
          labelBgBorderRadius: 4,
        });
      });
    }

    return { nodes: flowNodes, edges: flowEdges };
  }, [specGraph, selectedId]);

  return (
    <div className="sg-canvas">
      <div className="sg-canvas-bar">
        <div className="panel-title">
          <span className="bar-mark" />
          Live 2D Architecture Twin
        </div>
        <div className="sg-legend">
          <span className="leg requires">── requires</span>
          <span className="leg spawned">╌╌ spawned</span>
        </div>
      </div>
      <div className="sg-canvas-body">
        <ReactFlow<SpecFlowNodeType, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_event, node) => onSelect(node.id)}
          onPaneClick={() => onSelect(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          minZoom={0.3}
          maxZoom={1.7}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        >
          <Background gap={24} size={1} color="#16213a" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={2}
            nodeColor={(node) =>
              statusMeta((node.data as SpecFlowNodeType['data']).node.status).color
            }
            maskColor="rgba(7, 11, 18, 0.75)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
