import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import ArchitectureNode from './ArchitectureNode';
import {
  autoLayout,
  needsAutoLayout,
  toFlowEdges,
  toFlowNodes,
  type ArchitectureNodeType,
} from '../lib/graphAdapter';
import { paletteFor } from '../lib/palette';
import { registerViewport } from '../lib/exporters';
import { useGraphStore } from '../store/useGraphStore';
import { LayersIcon } from './Icons';

const nodeTypes = { architecture: ArchitectureNode };
const defaultEdgeOptions = { type: 'default' as const };

export default function GraphCanvas() {
  const graph = useGraphStore((state) => state.graph);
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const selectNode = useGraphStore((state) => state.selectNode);
  const moveNode = useGraphStore((state) => state.moveNode);

  // Give the shell's export button a handle on the viewport element.
  const viewportRef = useCallback((el: HTMLDivElement | null) => registerViewport(el), []);

  const derivedNodes = useMemo(
    () => toFlowNodes(graph, selectedNodeId),
    [graph, selectedNodeId],
  );
  const edges = useMemo<Edge[]>(() => toFlowEdges(graph), [graph]);

  // React Flow owns transient drag state; the store owns the truth.
  const [nodes, setNodes] = useState<ArchitectureNodeType[]>(derivedNodes);
  useEffect(() => setNodes(derivedNodes), [derivedNodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange<ArchitectureNodeType>[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  const onNodeDragStop = useCallback<OnNodeDrag<ArchitectureNodeType>>(
    (_event, node) => moveNode(node.id, node.position),
    [moveNode],
  );

  const isEmpty = graph.nodes.length === 0;

  return (
    <div className="graph-panel">
      <div className="panel-bar">
        <div className="panel-title">
          <span className="bar-mark" />
          Architecture graph <span className="panel-mono">/ LIVE PLAN</span>
        </div>
        <div className="panel-mono">
          {String(graph.nodes.length).padStart(2, '0')} NODES ·{' '}
          {String(graph.connections.length).padStart(2, '0')} LINKS
        </div>
      </div>

      <div className="canvas-wrap" ref={viewportRef}>
        <ReactFlow<ArchitectureNodeType>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(_event, node) => selectNode(node.id)}
          onPaneClick={() => selectNode(null)}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          minZoom={0.3}
          maxZoom={1.8}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
        >
          <Background gap={22} size={1} color="#e2eae8" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={2}
            nodeColor={(node) => paletteFor((node.data as ArchitectureNodeType['data']).node.type).stroke}
          />
        </ReactFlow>

        {isEmpty && (
          <div className="empty-graph visible">
            <div className="empty-inner">
              <div className="empty-icon">
                <LayersIcon />
              </div>
              <strong>Describe a system to begin</strong>
              <p>Your returned nodes and dependencies will appear here as a live, editable graph.</p>
            </div>
          </div>
        )}

        {graph.nodes.length > 0 && needsAutoLayout(graph.nodes) && (
          <button
            type="button"
            className="canvas-action"
            onClick={() => useGraphStore.setState((state) => ({ graph: autoLayout(state.graph) }))}
          >
            Tidy layout
          </button>
        )}
      </div>
    </div>
  );
}