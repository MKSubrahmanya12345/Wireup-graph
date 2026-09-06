/**
 * SceneCanvas.tsx — the studio bench.
 *
 * True-scale world (1 unit = 1 m, parts are centimetres): soft hemisphere +
 * key/rim lighting, contact shadows on a matte bench top, 10 mm grid,
 * physical jumper wires, auto-framing camera with Iso/Top/Front presets,
 * gizmo + damped orbit. Reads nodes + connections from props so the canvas
 * stays pure; view toggles live in viewStore, live state in simStore.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  ContactShadows,
  Grid,
  OrbitControls,
  GizmoHelper,
  GizmoViewport,
  Text,
} from '@react-three/drei';
import type { ArchitectureConnection, ArchitectureNode } from '../types/architecture';
import ComponentMesh from './ComponentMesh';
import Wires3D from './Wires3D';
import { resolvePosition3d } from './partGeometry';
import { useView3D } from './viewStore';
import type { CamPreset } from './viewStore';

interface SceneCanvasProps {
  nodes: ArchitectureNode[];
  connections: ArchitectureConnection[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  /** Solved net levels — HIGH wires glow. */
  levels?: Record<string, boolean>;
}

interface Bounds {
  cx: number;
  cz: number;
  radius: number;
}

function computeBounds(nodes: ArchitectureNode[]): Bounds {
  if (nodes.length === 0) return { cx: 0, cz: 0, radius: 0.25 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const n of nodes) {
    const p = resolvePosition3d(n.x, n.y, n.spatial);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const w = Math.max(maxX - minX, 0.12);
  const d = Math.max(maxZ - minZ, 0.1);
  return {
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    radius: Math.max(w, d) / 2 + 0.09,
  };
}

/** Applies Iso/Top/Front framing + initial fit without remounting. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CameraRig({ bounds, controlsRef }: { bounds: Bounds; controlsRef: any }) {
  const camera = useThree((s) => s.camera);
  const camCmd = useView3D((s) => s.camCmd);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const { cx, cz, radius } = bounds;
    const place = (kind: CamPreset) => {
      controls.target.set(cx, 0.01, cz);
      if (kind === 'top') {
        camera.position.set(cx, radius * 3.2, cz + 0.001);
      } else if (kind === 'front') {
        camera.position.set(cx, radius * 0.7, cz + radius * 2.6);
      } else {
        camera.position.set(cx + radius * 1.7, radius * 1.5, cz + radius * 1.9);
      }
      controls.update();
    };
    place(camCmd.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camCmd.n, camera]);

  return null;
}

function NamePlates({ nodes }: { nodes: ArchitectureNode[] }) {
  const show = useView3D((s) => s.showLabels);
  const items = useMemo(
    () =>
      nodes.slice(0, 24).map((n) => ({
        id: n.id,
        name: n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name,
        p: resolvePosition3d(n.x, n.y, n.spatial),
      })),
    [nodes],
  );
  if (!show) return null;
  return (
    <group>
      {items.map((it) => (
        <Text
          key={it.id}
          position={[it.p.x, 0.035, it.p.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.008}
          color="#333333"
          anchorX="center"
          anchorY="middle"
        >
          {it.name}
        </Text>
      ))}
    </group>
  );
}

export default function SceneCanvas({ nodes, connections, selectedNodeId, onSelectNode, levels }: SceneCanvasProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  const autoRotate = useView3D((s) => s.autoRotate);
  const showGrid = useView3D((s) => s.showGrid);
  const showWires = useView3D((s) => s.showWires);
  const bounds = useMemo(() => computeBounds(nodes), [nodes]);

  return (
    <Canvas
      camera={{ position: [0.32, 0.28, 0.42], fov: 38, near: 0.005, far: 30 }}
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      style={{ background: '#eef1ee' }}
      onPointerMissed={() => onSelectNode(null)}
    >
      <hemisphereLight args={['#ffffff', '#8a948f', 0.5]} />
      {/* studio HDRI rendered locally (no network): softboxes the PBR parts reflect */}
      <Environment resolution={256}>
        <group rotation={[-Math.PI / 3, 0, 0]}>
          <Lightformer form="circle" intensity={2.4} position={[0, 5, -9]} scale={2} />
          <Lightformer intensity={1.1} position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[8, 1, 1]} />
          <Lightformer intensity={1.1} position={[5, 1, -1]} rotation-y={-Math.PI / 2} scale={[8, 1, 1]} />
          <Lightformer color="#dfe8ff" intensity={0.7} position={[0, 5, 5]} scale={[6, 2, 1]} />
        </group>
      </Environment>
      <directionalLight
        position={[0.6, 1.1, 0.5]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-0.6}
        shadow-camera-right={0.6}
        shadow-camera-top={0.6}
        shadow-camera-bottom={-0.6}
        shadow-camera-near={0.1}
        shadow-camera-far={4}
        shadow-bias={-0.0002}
      />
      <directionalLight position={[-0.5, 0.4, -0.6]} intensity={0.4} color="#bcd2ff" />

      {/* bench top */}
      <mesh position={[bounds.cx, -0.011, bounds.cz]} receiveShadow>
        <boxGeometry args={[Math.max(bounds.radius * 4.4, 0.6), 0.02, Math.max(bounds.radius * 3.4, 0.5)]} />
        <meshStandardMaterial color="#e0d9c9" roughness={0.9} metalness={0} />
      </mesh>
      {showGrid ? (
        <Grid
          position={[bounds.cx, 0.0008, bounds.cz]}
          args={[3, 3]}
          cellSize={0.01}
          cellThickness={0.55}
          cellColor="#b9c4bf"
          sectionSize={0.05}
          sectionThickness={1}
          sectionColor="#8fa19b"
          fadeDistance={2.2}
          fadeStrength={1.4}
          followCamera={false}
          infiniteGrid={false}
        />
      ) : null}
      <ContactShadows position={[bounds.cx, 0.0012, bounds.cz]} opacity={0.5} scale={bounds.radius * 4} blur={2.2} far={0.35} resolution={512} color="#1a1e1c" />

      <CameraRig bounds={bounds} controlsRef={controlsRef} />

      {showWires ? <Wires3D nodes={nodes} connections={connections} /> : null}
      {nodes.map((node) => (
        <ComponentMesh key={node.id} node={node} isSelected={node.id === selectedNodeId} />
      ))}
      <NamePlates nodes={nodes} />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan
        enableZoom
        enableRotate
        enableDamping
        dampingFactor={0.12}
        autoRotate={autoRotate}
        autoRotateSpeed={1.1}
        minDistance={0.04}
        maxDistance={4}
        maxPolarAngle={Math.PI / 2 - 0.02}
        target={[bounds.cx, 0.01, bounds.cz]}
      />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#d36f56', '#417664', '#557db3']} labelColor="white" />
      </GizmoHelper>
    </Canvas>
  );
}
="white" />
      </GizmoHelper>
    </Canvas>
  );
}
