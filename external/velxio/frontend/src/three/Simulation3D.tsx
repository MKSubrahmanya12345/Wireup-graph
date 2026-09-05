/**
 * Simulation3D — the "lifted bench" (Stage 1) view.
 *
 * A second, orthographic renderer over the SAME Zustand stores the 2D canvas
 * uses (`useSimulatorStore.boards / components / wires`). Boards and parts
 * become flat cards textured with their real SVG art and lifted off a grid
 * bench; wires become polylines running underneath. Nothing here touches the
 * emulators — avr8js / rp2040js / QEMU / ngspice keep mutating the stores
 * exactly as before.
 *
 * Lazy-loaded from SimulatorCanvas (React.lazy) so three.js stays out of the
 * main bundle until the user flips the 3D toggle.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, Text } from '@react-three/drei';
import type { OrthographicCamera } from 'three';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { ComponentRegistry } from '../services/ComponentRegistry';
import { Card3D } from './Card3D';
import { Wire3D } from './Wire3D';
import { resolveBoardArt, resolveComponentArt } from './partArt';

// Lifts (world = canvas px; +Y is up). Boards hug the bench, parts stand a
// little taller so their bodies read above the boards, wires run underneath.
const BOARD_LIFT = 6;
const COMP_LIFT = 10;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Bounds {
  cx: number;
  cy: number;
  radius: number;
}

function computeBounds(rects: Rect[]): Bounds | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const radius = Math.max(w, h) / 2 + 60;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, radius };
}

/** Frame the circuit once bounds are known (and again if they change). */
function FitCamera({ bounds }: { bounds: Bounds }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const { cx, cy, radius } = bounds;
    controls.target.set(cx, 0, cy);
    const cam = camera as OrthographicCamera;
    if (cam.isOrthographicCamera) {
      cam.zoom = Math.min(Math.max(size.height / (radius * 2.6), 0.05), 2);
      cam.near = -radius * 40;
      cam.far = radius * 40;
      cam.updateProjectionMatrix();
    }
    cam.position.set(cx, radius * 1.6, cy + radius * 1.6);
    controls.update();
  }, [bounds, camera, size.height]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      screenSpacePanning
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI / 2 - 0.02}
      minZoom={0.05}
      maxZoom={4}
    />
  );
}

function Scene() {
  const boards = useSimulatorStore((s) => s.boards);
  const components = useSimulatorStore((s) => s.components);
  const wires = useSimulatorStore((s) => s.wires);

  // Wait for the component metadata registry before resolving part art.
  const [registryReady, setRegistryReady] = useState(
    () => ComponentRegistry.getInstance().isLoaded,
  );
  useEffect(() => {
    let alive = true;
    ComponentRegistry.getInstance().loadPromise.then(() => {
      if (alive) setRegistryReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const boardCards = useMemo(
    () =>
      boards.map((b) => ({ id: b.id, art: resolveBoardArt(b.boardKind), x: b.x, y: b.y })),
    [boards],
  );

  const componentCards = useMemo(
    () =>
      components.map((c) => ({
        id: c.id,
        art: registryReady
          ? resolveComponentArt(c.metadataId, c.properties as Record<string, unknown> | undefined)
          : null,
        x: c.x,
        y: c.y,
        rotation: Number((c.properties as { rotation?: unknown } | undefined)?.rotation) || 0,
      })),
    [components, registryReady],
  );

  const bounds = useMemo(() => {
    const rects: Rect[] = [];
    for (const b of boardCards) rects.push({ x: b.x, y: b.y, w: b.art.w, h: b.art.h });
    for (const c of componentCards) if (c.art) rects.push({ x: c.x, y: c.y, w: c.art.w, h: c.art.h });
    return computeBounds(rects);
  }, [boardCards, componentCards]);

  const visibleWires = useMemo(() => wires.filter((w) => !w.bb), [wires]);
  const isEmpty = boards.length === 0 && components.length === 0;

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[300, 900, 200]} intensity={1.5} />
      <directionalLight position={[-400, 500, -400]} intensity={0.45} color="#8fb6ff" />

      <Grid
        position={[0, -0.05, 0]}
        infiniteGrid
        cellSize={50}
        sectionSize={250}
        cellThickness={0.6}
        sectionThickness={1.1}
        cellColor="#2a2f38"
        sectionColor="#3a4552"
        fadeDistance={12000}
        fadeStrength={1.5}
      />

      {bounds ? <FitCamera bounds={bounds} /> : null}

      {visibleWires.map((w) => (
        <Wire3D key={w.id} wire={w} />
      ))}

      {boardCards.map((b) => (
        <Card3D
          key={`board:${b.id}`}
          x={b.x}
          y={b.y}
          w={b.art.w}
          h={b.art.h}
          lift={BOARD_LIFT}
          artUrl={b.art.url}
          label={b.art.label}
          slabColor="#14402f"
        />
      ))}

      {componentCards.map((c) =>
        c.art ? (
          <Card3D
            key={`comp:${c.id}`}
            x={c.x}
            y={c.y}
            w={c.art.w}
            h={c.art.h}
            lift={COMP_LIFT}
            artUrl={c.art.url}
            label={c.art.label}
            rotationDeg={c.rotation}
          />
        ) : null,
      )}

      {isEmpty ? (
        <Text
          position={[0, 30, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={44}
          color="#5b6673"
          anchorX="center"
          anchorY="middle"
        >
          Nothing on the bench yet — add parts in the 2D view
        </Text>
      ) : null}
    </>
  );
}

export default function Simulation3D() {
  return (
    <Canvas
      orthographic
      dpr={[1, 2]}
      camera={{ position: [0, 900, 900], zoom: 0.4, near: -20000, far: 20000 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#101318']} />
      <Scene />
    </Canvas>
  );
}
