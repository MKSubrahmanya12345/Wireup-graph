import { Suspense, lazy, useMemo } from 'react';

import { previewNodes } from '../lib/componentDetect';
import { useGraphStore } from '../store/useGraphStore';
import type { ArchitectureNode } from '../types/architecture';

// three.js is heavy — page 01 only pays for it once there is something to show.
const SceneCanvas = lazy(() => import('./SceneCanvas'));

/**
 * Page 01's live 3D bench.
 *
 * One shape per identified component. Before the planner runs, the shapes
 * come from the brief + answers (client-side detection); the moment the graph
 * exists it renders the real graph nodes instead. Same SceneCanvas as page
 * 02 — one renderer, no drift between the two views.
 */
export default function IntakeScene({
  brief,
  answers,
}: {
  brief: string;
  answers: Record<string, string>;
}) {
  const graphNodes = useGraphStore((state) => state.graph.nodes);
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const selectNode = useGraphStore((state) => state.selectNode);

  const nodes: ArchitectureNode[] = useMemo(() => {
    if (graphNodes.length > 0) return graphNodes;
    // Answers matter: "wifi: yes" or a chosen sensor can add a part.
    const text = `${brief} ${Object.values(answers).join(' ')}`;
    return previewNodes(text);
  }, [graphNodes, brief, answers]);

  const source = graphNodes.length > 0 ? 'resolved graph' : 'live detection from your brief';

  return (
    <section className="intake-3d">
      <div className="intake-3d-head">
        <span>3D bench · {source}</span>
        <span>{String(nodes.length).padStart(2, '0')} shapes</span>
      </div>
      <div className="canvas-wrap" style={{ position: 'relative', height: 360 }}>
        {nodes.length === 0 ? (
          <div className="terminal-empty" style={{ padding: 24 }}>
            Name a part (e.g. “esp32 and a dht22”) and it appears here as a shape.
          </div>
        ) : (
          <Suspense fallback={<div className="terminal-empty" style={{ padding: 24 }}>Loading the 3D bench…</div>}>
            <SceneCanvas nodes={nodes} selectedNodeId={selectedNodeId} onSelectNode={selectNode} />
          </Suspense>
        )}
      </div>
    </section>
  );
}
