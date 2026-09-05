/**
 * Simulation3D — the "lifted bench" (Stage 1) view.
 *
 * A second, orthographic renderer over the SAME Zustand stores the 2D canvas
 * uses (`useSimulatorStore.boards / components / wires`). Boards and parts are
 * drawn as real volumetric parametric bodies (src/three/Parts3D.tsx) and wires
 * as round conductors (src/three/Wire3D.tsx), placed on a grid bench. Nothing
 * here touches the emulators — avr8js / rp2040js / QEMU / ngspice keep mutating
 * the stores exactly as before, and the parts animate off that store state.
 *
 * Lazy-loaded from SimulatorCanvas (React.lazy) so three.js stays out of the
 * main bundle until the user flips the 3D toggle.
 *
 * When `gallery` is set, the Scene ignores the live circuit and instead lays
 * out EVERY available component in the registry as a grid of bodies — a pure
 * "show me all the parts in 3D" showcase that never touches the user's bench.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, Text } from '@react-three/drei';
import type { OrthographicCamera } from 'three';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { ComponentRegistry } from '../services/ComponentRegistry';
import { Part3D } from './Parts3D';
import { Wire3D } from './Wire3D';
import { resolveBoardArt, resolveComponentArt } from './partArt';
import { BOARD_KIND_LABELS } from '../types/board';

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

interface GalleryCard {
  id: string;
  art: ResolvedArt;
  x: number;
  y: number;
  rotation: number;
  properties?: Record<string, unknown>;
}

interface ResolvedArt { url: string | null; w: number; h: number; label: string }

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

/**
 * Every registry component that the component picker actually offers (same
 * filter: board kinds and the unsimulated board shell never render as parts).
 */
function galleryComponents() {
  // 'nano-rp2040-connect' is a wokwi board shell with no simulator — omitted
  // from the picker; keep the gallery in lock-step.
  return ComponentRegistry.getInstance()
    .getAllComponents()
    .filter((c) => !(c.id in BOARD_KIND_LABELS) && c.id !== 'nano-rp2040-connect');
}

function Scene({ gallery }: { gallery: boolean }) {
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
      boards.map((b) => ({
        id: b.id,
        kind: b.boardKind,
        art: resolveBoardArt(b.boardKind),
        x: b.x,
        y: b.y,
      })),
    [boards],
  );

  const componentCards = useMemo(
    () =>
      components.map((c) => ({
        id: c.id,
        kind: c.metadataId,
        properties: (c.properties ?? {}) as Record<string, unknown>,
        art: registryReady
          ? resolveComponentArt(c.metadataId, c.properties as Record<string, unknown> | undefined)
          : null,
        x: c.x,
        y: c.y,
        rotation: Number((c.properties as { rotation?: unknown } | undefined)?.rotation) || 0,
      })),
    [components, registryReady],
  );

  // Gallery mode: a fixed grid of every available component.
  const galleryCards = useMemo<GalleryCard[]>(() => {
    if (!gallery || !registryReady) return [];
    const COLS = 8;
    const CELL_W = 240;
    const CELL_H = 210;
    return galleryComponents()
      .map((meta, i) => {
        const art = resolveComponentArt(meta.id, meta.defaultValues);
        if (!art) return null;
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        return {
          id: meta.id,
          art,
          x: col * CELL_W,
          y: row * CELL_H,
          rotation: 0,
          properties: (meta.defaultValues ?? {}) as Record<string, unknown>,
        };
      })
      .filter((c): c is GalleryCard => c !== null);
  }, [gallery, registryReady]);

  const bounds = useMemo(() => {
    const rects: Rect[] = [];
    if (gallery) {
      for (const c of galleryCards) rects.push({ x: c.x, y: c.y, w: c.art.w, h: c.art.h });
    } else {
      for (const b of boardCards) rects.push({ x: b.x, y: b.y, w: b.art.w, h: b.art.h });
      for (const c of componentCards) if (c.art) rects.push({ x: c.x, y: c.y, w: c.art.w, h: c.art.h });
    }
    return computeBounds(rects);
  }, [gallery, galleryCards, boardCards, componentCards]);

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

      {gallery ? (
        galleryCards.map((c) => (
          <group
            key={`gallery:${c.id}`}
            position={[c.x + c.art.w / 2, 0, c.y + c.art.h / 2]}
            rotation={[0, -(c.rotation * Math.PI) / 180, 0]}
          >
            <Part3D
              kind={c.id}
              lift={COMP_LIFT}
              properties={c.properties}
              label={c.art.label}
            />
          </group>
        ))
      ) : (
        <>
          {visibleWires.map((w) => (
            <Wire3D key={w.id} wire={w} />
          ))}

          {boardCards.map((b) => (
            <group key={`board:${b.id}`} position={[b.x + b.art.w / 2, 0, b.y + b.art.h / 2]}>
              <Part3D kind={b.kind} board lift={BOARD_LIFT} label={b.art.label} />
            </group>
          ))}

          {componentCards.map((c) => (
            <group
              key={`comp:${c.id}`}
              position={[
                c.x + (c.art?.w ?? 40) / 2,
                0,
                c.y + (c.art?.h ?? 40) / 2,
              ]}
              rotation={[0, -(c.rotation * Math.PI) / 180, 0]}
            >
            <Part3D
              kind={c.kind}
              lift={COMP_LIFT}
              properties={c.properties}
              liveSourceId={c.id}
              label={c.art?.label}
            />
            </group>
          ))}

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
      )}
    </>
  );
}

interface Simulation3DProps {
  /** Show a grid of every available component instead of the live circuit. */
  gallery?: boolean;
}

export default function Simulation3D({ gallery = false }: Simulation3DProps) {
  return (
    <Canvas
      orthographic
      dpr={[1, 2]}
      camera={{ position: [0, 900, 900], zoom: 0.4, near: -20000, far: 20000 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#101318']} />
      <Scene gallery={gallery} />
    </Canvas>
  );
}
