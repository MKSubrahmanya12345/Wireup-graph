/**
 * parts/common.tsx — shared primitives for every parametric part.
 *
 * All animation reads the live store IMPERATIVELY inside useFrame (the
 * velxio Parts3D pattern): the 3D view never re-renders at 60 fps, it just
 * turns horns, sinks caps and pumps emissive from the same state the bench
 * and the controls panel write. When a part has no liveId (page-01 preview
 * before any sim exists) movable bits run a gentle demo motion so the bench
 * never sits frozen — same contract as velxio's `canDemo`.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Group, MeshStandardMaterial } from 'three';
import { useSim3D } from '../simStore';

export interface PartViewProps {
  kind: string;
  liveId?: string;
  /** Extra qualifier: LED colour name, resistor value, … */
  accent?: string;
  value?: string;
}

/** millimetres → metres. */
export const mm = (v: number): number => v / 1000;

/** Read-once snapshot helpers for useFrame bodies (no subscriptions). */
export function livePressed(id: string | undefined): boolean {
  if (!id) return false;
  return useSim3D.getState().pressed[id] === true;
}

export function liveAnalog01(id: string | undefined, fallback = 0.5): number {
  if (!id) return fallback;
  return (useSim3D.getState().analog[id] ?? Math.round(fallback * 1023)) / 1023;
}

export function liveServoDeg(id: string | undefined, fallback: number | null): number | null {
  if (!id) return fallback;
  return useSim3D.getState().servo[id] ?? fallback;
}

/* ── Pressable cap ─────────────────────────────────────────────────────── */
/** Sinks its children while the part is pressed. Pointer-press writes the
 *  store too, so the 2D bench, nets and controls all see the same press. */

export function PressCap({
  id,
  travel = 0.0016,
  children,
}: {
  id?: string;
  travel?: number;
  children: ReactNode;
}) {
  const ref = useRef<Group>(null);

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const target = livePressed(id) ? -travel : 0;
    g.position.y += (target - g.position.y) * 0.45;
  });

  const down = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (!id) return;
      useSim3D.getState().setPressed(id, true);
    },
    [id],
  );
  const up = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (!id) return;
      useSim3D.getState().setPressed(id, false);
    },
    [id],
  );

  return (
    <group
      ref={ref}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
    >
      {children}
    </group>
  );
}

/* ── Draggable knob (pots, encoder, joystick trim) ─────────────────────── */

export function DragKnob({
  id,
  range = 270,
  children,
}: {
  id?: string;
  range?: number;
  children: ReactNode;
}) {
  const ref = useRef<Group>(null);
  const drag = useRef<{ startX: number; startV: number } | null>(null);

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const level = liveAnalog01(id, 0.5);
    g.rotation.y = ((level - 0.5) * range * Math.PI) / 180;
  });

  const down = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (!id) return;
      drag.current = {
        startX: e.nativeEvent.clientX,
        startV: useSim3D.getState().analog[id] ?? 512,
      };
    },
    [id],
  );
  const move = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!drag.current || !id) return;
      e.stopPropagation();
      const dx = e.nativeEvent.clientX - drag.current.startX;
      useSim3D.getState().setAnalog(id, drag.current.startV + dx * 4);
    },
    [id],
  );
  const up = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (drag.current) e.stopPropagation();
    drag.current = null;
  }, []);

  return (
    <group
      ref={ref}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={up}
    >
      {children}
    </group>
  );
}

/* ── Servo horn — exact angle about Y, demo sweep when unbound ─────────── */

export function ServoHorn({ id, children }: { id?: string; children: ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const deg = liveServoDeg(id, id ? null : 90 + Math.sin(clock.elapsedTime * 1.6) * 55);
    if (deg === null) return;
    g.rotation.y = (-(deg - 90) * Math.PI) / 180;
  });
  return <group ref={ref}>{children}</group>;
}

/* ── Continuous shaft (steppers, motors) ───────────────────────────────── */

export function SpinShaft({
  id,
  axis = 'x',
  children,
}: {
  id?: string;
  axis?: 'x' | 'y' | 'z';
  children: ReactNode;
}) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const deg = liveServoDeg(id, null);
    const target =
      deg !== null ? (deg * Math.PI) / 180 : (clock.elapsedTime * 0.9) % (Math.PI * 2);
    if (axis === 'x') g.rotation.x = target;
    else if (axis === 'y') g.rotation.y = target;
    else g.rotation.z = target;
  });
  return <group ref={ref}>{children}</group>;
}

/* ── LED dome — glow tracks live brightness/colour ─────────────────────── */

export function GlowDome({
  id,
  color,
  heartbeat = false,
  r = 0.0025,
  y = 0.006,
}: {
  id?: string;
  color: string;
  heartbeat?: boolean;
  r?: number;
  y?: number;
}) {
  const ref = useRef<MeshStandardMaterial>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const st = useSim3D.getState();
    let level = 0;
    if (id && st.led[id]) {
      const l = st.led[id];
      level = l.on ? l.brightness : 0;
      if (l.color) m.color.set(l.color);
    } else if (heartbeat) {
      level = st.heartbeat.ledOn ? 1 : 0.02;
    }
    m.emissiveIntensity = 0.12 + level * 2.4;
    m.opacity = 0.75 + level * 0.25;
  });
  return (
    <mesh position={[0, y, 0]}>
      <sphereGeometry args={[r, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <meshStandardMaterial
        ref={ref}
        color={color}
        emissive={color}
        emissiveIntensity={0.12}
        transparent
        opacity={0.9}
        roughness={0.18}
        metalness={0}
      />
    </mesh>
  );
}

/* ── Canvas-texture screen (OLED / LCD / TFT demo content) ─────────────── */

export function useTextScreen(
  w: number,
  h: number,
  bg: string,
  fg: string,
): { texture: THREE.CanvasTexture; draw: (lines: string[]) => void } {
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }, [w, h]);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);
  const draw = useCallback(
    (lines: string[]) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = fg;
      const size = Math.floor(canvas.height / Math.max(lines.length, 1) / 1.6);
      ctx.font = `bold ${Math.max(size, 8)}px monospace`;
      ctx.textBaseline = 'middle';
      lines.forEach((line, i) => {
        ctx.fillText(
          line.slice(0, 24),
          6,
          ((i + 0.5) / lines.length) * canvas.height,
        );
      });
      texture.needsUpdate = true;
    },
    [canvas, texture, bg, fg],
  );
  return { texture, draw };
}

/* ── Small helpers shared by board/sensor bodies ───────────────────────── */

export function PinRow({
  count,
  pitch = 0.00254,
  y = 0.004,
  r = 0.00032,
  len = 0.008,
}: {
  count: number;
  pitch?: number;
  y?: number;
  r?: number;
  len?: number;
}) {
  const items = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < count; i++) arr.push((i - (count - 1) / 2) * pitch);
    return arr;
  }, [count, pitch]);
  return (
    <group>
      {items.map((x, i) => (
        <mesh key={i} position={[x, y, 0]}>
          <cylinderGeometry args={[r, r, len, 8]} />
          <meshStandardMaterial color="#d8b25a" roughness={0.3} metalness={0.85} />
        </mesh>
      ))}
    </group>
  );
}
