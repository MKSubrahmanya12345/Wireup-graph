/**
 * SceneCanvas.tsx
 * The Three.js <Canvas> host. Lights, environment, OrbitControls, axis helper, grid.
 * Reads nodes from props (passed from ThreeViewport) so this component stays pure.
 *
 * ??$$$ — Canvas is kept outside the React re-render path for unrelated state;
 * only graph nodes and selectedNodeId flow in as props.
 */

import { useCallback, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls, GizmoHelper, GizmoViewport, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { ArchitectureNode } from '../types/architecture';
import ComponentMesh from './ComponentMesh';

interface SceneCanvasProps {
  nodes: ArchitectureNode[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

// ??$$$ — Axis label helper: a small text label at the tip of each axis.
function AxisLabels() {
  return (
    <>
      <Text position={[1.6, 0, 0]} fontSize={0.08} color="#d36f56" anchorX="left">
        X
      </Text>
      <Text position={[0, 1.6, 0]} fontSize={0.08} color="#417664" anchorX="center">
        Y
      </Text>
      <Text position={[0, 0, 1.6]} fontSize={0.08} color="#557db3" anchorX="center">
        Z
      </Text>
    </>
  );
}

// ??$$$ — Use primitive Three.Line objects to avoid JSX <line> conflicting with SVG's <line>.
function AxisLines() {
  const xLine = useMemo(() => {
    const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.5, 0, 0)];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geom, new THREE.LineBasicMaterial({ color: '#d36f56' }));
  }, []);
  const yLine = useMemo(() => {
    const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.5, 0)];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geom, new THREE.LineBasicMaterial({ color: '#417664' }));
  }, []);
  const zLine = useMemo(() => {
    const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1.5)];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geom, new THREE.LineBasicMaterial({ color: '#557db3' }));
  }, []);

  return (
    <>
      <primitive object={xLine} />
      <primitive object={yLine} />
      <primitive object={zLine} />
    </>
  );
}

export default function SceneCanvas({ nodes, selectedNodeId, onSelectNode }: SceneCanvasProps) {
  const handlePaneClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  return (
    <Canvas
      camera={{ position: [0, 1.2, 2.2], fov: 45, near: 0.01, far: 100 }}
      shadows
      gl={{ antialias: true, alpha: false }}
      style={{ background: '#f1f5f3' }}
      // ??$$$ — pane click deselects node (mirrors onPaneClick in GraphCanvas)
      onPointerMissed={handlePaneClick}
    >
      {/* Ambient + directional lights */}
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[2, 4, 3]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-2, 2, -1]} intensity={0.3} />

      {/* Ground grid — cellSize in scene units (metres), cellColor matches design system */}
      <Grid
        position={[0, -0.001, 0]}
        args={[10, 10]}
        cellSize={0.1}
        cellThickness={0.5}
        cellColor="#c7d4d1"
        sectionSize={0.5}
        sectionThickness={1}
        sectionColor="#9db5b1"
        fadeDistance={8}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid={false}
      />

      {/* Axis lines and labels */}
      <AxisLines />
      <AxisLabels />

      {/* Component meshes — one per graph node */}
      {nodes.map((node) => (
        <ComponentMesh
          key={node.id}
          node={node}
          isSelected={node.id === selectedNodeId}
        />
      ))}

      {/* Orbit / zoom / pan controls — damping makes camera feel premium */}
      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        dampingFactor={0.1}
        enableDamping
        minDistance={0.3}
        maxDistance={15}
      />

      {/* Corner gizmo so orientation is always visible */}
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport
          axisColors={['#d36f56', '#417664', '#557db3']}
          labelColor="white"
        />
      </GizmoHelper>
    </Canvas>
  );
}
