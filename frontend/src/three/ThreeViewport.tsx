/**
 * ThreeViewport.tsx
 * Public-facing wrapper around SceneCanvas.
 * Reads useGraphStore directly, handles empty + loading states explicitly,
 * and owns the selection bridge (click in 3D → selectNode in store).
 *
 * ??$$$ — SceneCanvas receives only graph nodes and selectedNodeId as props.
 * All store access lives here, not inside SceneCanvas, to keep the canvas
 * component pure and avoid unnecessary rebuilds from unrelated store changes.
 */

import { useCallback } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import SceneCanvas from './SceneCanvas';

// ??$$$ — Minimal Layers icon (same visual language as LayersIcon in GraphCanvas)
function CubeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

export default function ThreeViewport() {
  const nodes = useGraphStore((s) => s.graph.nodes);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const status = useGraphStore((s) => s.status);

  const handleSelectNode = useCallback(
    (id: string | null) => selectNode(id),
    [selectNode],
  );

  const isEmpty = nodes.length === 0;
  const isPlanning = status === 'planning';

  return (
    <div className="graph-panel three-viewport">
      {/* Panel header — mirrors GraphCanvas bar styling */}
      <div className="panel-bar">
        <div className="panel-title">
          <span className="bar-mark" style={{ background: '#557db3' }} />
          3D Assembly <span className="panel-mono">/ SPATIAL VIEW</span>
        </div>
        <div className="panel-mono">
          {String(nodes.length).padStart(2, '0')} PARTS
        </div>
      </div>

      {/* ??$$$ — canvas-wrap height matches GraphCanvas (.canvas-wrap height: 486px) */}
      <div className="canvas-wrap" style={{ position: 'relative', height: '486px' }}>
        {/* Always render canvas (keeps GPU context alive), overlay states on top */}
        <SceneCanvas
          nodes={nodes}
          selectedNodeId={selectedNodeId}
          onSelectNode={handleSelectNode}
        />

        {/* Empty state — shown when no nodes and not planning */}
        {isEmpty && !isPlanning && (
          <div className="empty-graph visible" style={{ pointerEvents: 'none' }}>
            <div className="empty-inner">
              <div className="empty-icon" style={{ color: '#557db3', borderColor: '#b3c7e8', background: '#e8eff8' }}>
                <CubeIcon />
              </div>
              <strong>No components yet</strong>
              <p>Generate an architecture plan to populate the 3D view.</p>
            </div>
          </div>
        )}

        {/* Planning state overlay */}
        {isPlanning && (
          <div
            className="empty-graph visible"
            style={{
              pointerEvents: 'none',
              background: 'rgba(241,245,243,0.82)',
              backdropFilter: 'blur(4px)',
            }}
          >
            <div className="empty-inner">
              <div
                className="empty-icon"
                style={{
                  color: '#557db3',
                  borderColor: '#b3c7e8',
                  background: '#e8eff8',
                  animation: 'pulse3d 1.2s ease-in-out infinite',
                }}
              >
                <CubeIcon />
              </div>
              <strong>Building 3D scene…</strong>
              <p>The AI is designing your hardware plan.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
