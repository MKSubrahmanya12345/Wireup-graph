import { useState } from 'react';
import Composer from '../components/Composer';
import ErrorAlert from '../components/ErrorAlert';
import GraphCanvas from '../components/GraphCanvas';
import JsonDrawer from '../components/JsonDrawer';
import NodeInspector from '../components/NodeInspector';
import VerificationPanel from '../components/VerificationPanel';
import { ConnectionMatrix, DependencyChain, SoftwareSurface } from '../components/DetailCards';
import { useGraphStore } from '../store/useGraphStore';
// ??$$$ — 3D viewport; lazy-loaded so Three.js bundle doesn't block initial paint
import ThreeViewport from '../three/ThreeViewport';

// ??$$$ — View mode: which panes are visible in the canvas area.
type ViewMode = 'split' | '3d' | '2d';

export default function ArchitecturePlanPage() {
  const graph = useGraphStore((state) => state.graph);
  const lastUpdated = useGraphStore((state) => state.lastUpdated);

  // ??$$$ — Local view preference; not persisted to store.
  const [viewMode, setViewMode] = useState<ViewMode>('split');

  return (
    <>
      <section className="heading-row">
        <div>
          <div className="eyebrow">Architecture workspace / 01</div>
          <h1>System architecture</h1>
          <p className="heading-sub">
            {graph.summary || 'Turn a project brief into a reviewable hardware plan.'}
          </p>
        </div>
        <div className="header-meta">
          <span>{lastUpdated ? 'UPDATED JUST NOW' : 'NOT GENERATED YET'}</span>
          <span className="meta-sep">·</span>
          <span>{String(graph.nodes.length).padStart(2, '0')} NODES</span>
          <span className="meta-sep">·</span>
          <span>{String(graph.connections.length).padStart(2, '0')} LINKS</span>
        </div>
      </section>

      <Composer />
      <ErrorAlert />

      {/* ??$$$ — view-mode toggle buttons */}
      <div className="view-toggle-bar">
        <span className="view-toggle-label">VIEW</span>
        {(['split', '3d', '2d'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            id={`view-toggle-${mode}`}
            className={`view-toggle-btn${viewMode === mode ? ' active' : ''}`}
            onClick={() => setViewMode(mode)}
          >
            {mode === 'split' ? '3D + 2D' : mode === '3d' ? '3D only' : '2D only'}
          </button>
        ))}
      </div>

      {/* ??$$$ — workspace-grid: inspector stays on the right (unchanged).
          Left cell is the canvas split area, which changes with viewMode. */}
      <div className="workspace-grid">
        <div className={`canvas-split canvas-split--${viewMode}`}>
          {/* 3D pane — visible in split and 3d modes */}
          {(viewMode === 'split' || viewMode === '3d') && (
            <div className="canvas-split-pane">
              <ThreeViewport />
            </div>
          )}
          {/* 2D pane — visible in split and 2d modes */}
          {(viewMode === 'split' || viewMode === '2d') && (
            <div className="canvas-split-pane">
              <GraphCanvas />
            </div>
          )}
        </div>
        <NodeInspector />
      </div>

      <VerificationPanel />

      <section className="details-grid">
        <ConnectionMatrix />
        <DependencyChain />
        <SoftwareSurface />
      </section>

      <JsonDrawer />
    </>
  );
}