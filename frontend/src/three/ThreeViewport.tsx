/**
 * ThreeViewport.tsx — the 3D assembly panel.
 *
 * True-scale bench (1 unit = 1 m, Uno 68.6 mm, OLED 27 mm — check the footer
 * ruler), camera presets, layer toggles, transport, and the per-part
 * ControlsPanel for whatever is selected. Store access lives here;
 * SceneCanvas stays pure.
 *
 * The viewport also runs the net solver over the architecture graph (via
 * archAdapter): wires glow on HIGH nets, wired LEDs follow their nets, and
 * logic ICs (555 → 4017/595 chases, gate packages) advance — the same
 * solveNets() pass as the 2D bench. A 4 Hz sampler keeps clocks moving when
 * the bench page (and its per-frame heartbeat sync) is not mounted.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useSim3D } from './simStore';
import { useView3D } from './viewStore';
import { archToBench } from '../sim/archAdapter';
import { commitSolved, solveNets } from '../sim/circuitSim';
import SceneCanvas from './SceneCanvas';
import ControlsPanel from './ControlsPanel';
import type { CamPreset } from './viewStore';

function CubeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

const CAMS: { kind: CamPreset; label: string }[] = [
  { kind: 'iso', label: 'Iso' },
  { kind: 'top', label: 'Top' },
  { kind: 'front', label: 'Front' },
];

/** Sampler period for IC clocks on this page (bench page solves per frame). */
const TICK_MS = 250;

export default function ThreeViewport() {
  const nodes = useGraphStore((s) => s.graph.nodes);
  const connections = useGraphStore((s) => s.graph.connections);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const status = useGraphStore((s) => s.status);

  // Whole-store subscription: any control gesture re-solves the arch nets.
  const snap = useSim3D();
  const view = useView3D();

  const handleSelectNode = useCallback((id: string | null) => selectNode(id), [selectNode]);

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  // Live nets: adapt the arch graph, solve, commit (guarded writes settle).
  const archDiagram = useMemo(() => archToBench(nodes, connections), [nodes, connections]);
  const archSolved = useMemo(() => solveNets(archDiagram), [archDiagram, snap]);
  useEffect(() => {
    commitSolved(archDiagram, archSolved);
  }, [archDiagram, archSolved]);

  // Sampler: advances 555/4017/595 edge state while running.
  useEffect(() => {
    if (!snap.running) return undefined;
    const t = window.setInterval(() => useSim3D.getState().bumpTick(), TICK_MS);
    return () => window.clearInterval(t);
  }, [snap.running]);

  const highNets = useMemo(
    () => Object.values(archSolved.levels).filter(Boolean).length,
    [archSolved],
  );

  const isEmpty = nodes.length === 0;
  const isPlanning = status === 'planning';

  return (
    <div className="graph-panel three-viewport">
      <div className="panel-bar">
        <div className="panel-title">
          <span className="bar-mark" style={{ background: '#557db3' }} />
          3D Assembly <span className="panel-mono">/ TRUE SCALE · 1 UNIT = 1 M</span>
        </div>
        <div className="panel-mono">{String(nodes.length).padStart(2, '0')} PARTS</div>
      </div>

      {/* toolbar: camera presets · layers · transport */}
      <div className="three-toolbar" role="toolbar" aria-label="3D view controls">
        <div className="three-toolgroup">
          {CAMS.map((c) => (
            <button key={c.kind} type="button" onClick={() => view.sendCam(c.kind)} title={`Frame: ${c.label}`}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="three-toolgroup">
          <button type="button" className={view.autoRotate ? 'active' : ''} onClick={view.toggleAutoRotate} title="Turntable">
            ⟳ Spin
          </button>
          <button type="button" className={view.showGrid ? 'active' : ''} onClick={view.toggleGrid} title="10 mm grid">
            Grid
          </button>
          <button type="button" className={view.showWires ? 'active' : ''} onClick={view.toggleWires} title="Jumper wires">
            Wires
          </button>
          <button type="button" className={view.showLabels ? 'active' : ''} onClick={view.toggleLabels} title="Name plates">
            Labels
          </button>
        </div>
        <div className="three-toolgroup">
          <button type="button" onClick={() => snap.setRunning(!snap.running)} title={snap.running ? 'Pause the bench' : 'Run the bench'}>
            {snap.running ? '❚❚ Pause' : '▶ Run'}
          </button>
        </div>
      </div>

      <div className="canvas-wrap" style={{ position: 'relative', height: '520px' }}>
        <SceneCanvas
          nodes={nodes}
          connections={connections}
          selectedNodeId={selectedNodeId}
          onSelectNode={handleSelectNode}
          levels={archSolved.levels}
        />

        {isEmpty && !isPlanning && (
          <div className="empty-graph visible" style={{ pointerEvents: 'none' }}>
            <div className="empty-inner">
              <div className="empty-icon" style={{ color: '#557db3', borderColor: '#b3c7e8', background: '#e8eff8' }}>
                <CubeIcon />
              </div>
              <strong>No components yet</strong>
              <p>Generate an architecture plan to populate the true-scale bench.</p>
            </div>
          </div>
        )}

        {isPlanning && (
          <div className="empty-graph visible" style={{ pointerEvents: 'none', background: 'rgba(241,245,243,0.82)', backdropFilter: 'blur(4px)' }}>
            <div className="empty-inner">
              <div className="empty-icon" style={{ color: '#557db3', borderColor: '#b3c7e8', background: '#e8eff8', animation: 'pulse3d 1.2s ease-in-out infinite' }}>
                <CubeIcon />
              </div>
              <strong>Building 3D scene…</strong>
              <p>The AI is designing your hardware plan.</p>
            </div>
          </div>
        )}
      </div>

      {/* inspector: live controls for the selection */}
      {selected ? (
        <ControlsPanel node={selected} />
      ) : (
        !isEmpty && <p className="tiny muted three-hint">Click any part — buttons press, knobs turn, sensors slide. Drag the body to move it.</p>
      )}

      <div className="three-foot tiny muted">
        <span>True scale — Uno 68.6 mm · Nano 45 mm · OLED 27 mm · tactile 6 mm · LED Ø5 mm</span>
        <span>{highNets} nets HIGH · wires follow the graph · drag moves · scroll zooms · right-drag pans</span>
      </div>
    </div>
  );
}
