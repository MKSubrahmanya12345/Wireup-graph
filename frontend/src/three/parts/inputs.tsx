/**
 * parts/inputs.tsx — every part a finger touches.
 *
 * THIS is the pushbutton fix in 3D form: the cap is a real pressable mesh
 * (PressCap) that sinks 1.6 mm and writes simStore.pressed, which the bench
 * wiring turns into an active-low net event — the same INPUT_PULLUP seeding
 * velxio's BasicParts does. Slide knobs slide, DIP throws flip, the KY-040
 * knob turns with its detents, pot knobs drag, keypad domes depress.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Group } from 'three';
import { DragKnob, PressCap, liveAnalog01, livePressed, mm } from './common';
import type { PartViewProps } from './common';
import { BUTTON_RED, KNOB_CREAM, PCB_BLUE, PCB_GREEN, pcb, pin, plastic, steel } from '../materials';
import { useSim3D } from '../simStore';

/* ── 12 mm tactile ─────────────────────────────────────────────────────── */

function Tactile({ liveId, size = 12, capR = 4.5 }: { liveId?: string; size?: number; capR?: number }) {
  const h = size === 6 ? 4.3 : 7.5;
  return (
    <group>
      <mesh position={[0, mm(h / 2 - 1), 0]} castShadow>
        <boxGeometry args={[mm(size), mm(h - 2), mm(size)]} />
        <meshStandardMaterial {...plastic('#20242a')} />
      </mesh>
      <group position={[0, mm(h - 1), 0]}>
        <PressCap id={liveId} travel={mm(1.6)}>
          <mesh castShadow>
            <cylinderGeometry args={[mm(capR), mm(capR), mm(2.5), 20]} />
            <meshStandardMaterial color={BUTTON_RED} roughness={0.4} />
          </mesh>
        </PressCap>
      </group>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <mesh key={i} position={[mm((sx * size) / 2), mm(0.6), mm((sz * size) / 2)]}>
          <boxGeometry args={[mm(1), mm(1.6), mm(0.6)]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
    </group>
  );
}

/* ── Slide switch: knob really slides ─────────────────────────────────── */

function SlideSwitch({ liveId }: { liveId?: string }) {
  const knob = useRef<Group>(null);
  useFrame(() => {
    const g = knob.current;
    if (!g) return;
    const on = liveId ? useSim3D.getState().switchOn[liveId] === true : false;
    const target = on ? 0.003 : -0.003;
    g.position.x += (target - g.position.x) * 0.35;
  });
  return (
    <group
      onPointerDown={(e) => {
        e.stopPropagation();
        if (!liveId) return;
        const st = useSim3D.getState();
        st.setSwitch(liveId, !(st.switchOn[liveId] ?? false));
      }}
    >
      <mesh position={[0, mm(2), 0]} castShadow>
        <boxGeometry args={[mm(11.5), mm(4), mm(5.5)]} />
        <meshStandardMaterial {...plastic('#1f242b')} />
      </mesh>
      <mesh position={[0, mm(4.2), 0]}>
        <boxGeometry args={[mm(8), mm(0.8), mm(3)]} />
        <meshStandardMaterial color="#0c0d10" roughness={0.6} />
      </mesh>
      <group ref={knob} position={[-0.003, mm(4.6), 0]}>
        <mesh castShadow>
          <boxGeometry args={[mm(3.5), mm(3), mm(3.6)]} />
          <meshStandardMaterial color="#f0b429" roughness={0.45} />
        </mesh>
      </group>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[mm(i * 3.5), mm(-1), 0]}>
          <boxGeometry args={[mm(0.8), mm(3), mm(0.8)]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
    </group>
  );
}

/* ── DIP-8: throws flip on click ───────────────────────────────────────── */

function Dip8({ liveId }: { liveId?: string }) {
  const values = useSim3D((s) => (liveId ? s.dip[liveId] : undefined)) ?? [0, 0, 0, 0, 0, 0, 0, 0];
  return (
    <group>
      <mesh position={[0, mm(2.5), 0]} castShadow>
        <boxGeometry args={[mm(23), mm(5), mm(9.5)]} />
        <meshStandardMaterial {...plastic('#b01e24')} />
      </mesh>
      {values.map((v, i) => (
        <group
          key={i}
          position={[mm(-8.9 + i * 2.54), mm(5.2), 0]}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (!liveId) return;
            const st = useSim3D.getState();
            const cur = [...(st.dip[liveId] ?? [0, 0, 0, 0, 0, 0, 0, 0])];
            cur[i] = cur[i] ? 0 : 1;
            st.setDip(liveId, cur);
          }}
        >
          <mesh castShadow rotation={[v ? -0.5 : 0.5, 0, 0]}>
            <boxGeometry args={[mm(1.6), mm(1), mm(2.6)]} />
            <meshStandardMaterial color="#f5f2e8" roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ── KY-040 with detent knob ───────────────────────────────────────────── */

function Ky040({ liveId }: { liveId?: string }) {
  const steps = useSim3D((s) => (liveId ? s.encoder[liveId] ?? 0 : 0));
  const knob = useRef<Group>(null);
  const drag = useRef<{ x: number; steps: number } | null>(null);
  useFrame(() => {
    const g = knob.current;
    if (!g) return;
    const target = liveId ? (useSim3D.getState().encoder[liveId] ?? 0) * 0.314 : steps * 0.314;
    g.rotation.y += (target - g.rotation.y) * 0.25;
  });
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]} castShadow>
        <boxGeometry args={[mm(32), mm(1.6), mm(19)]} />
        <meshStandardMaterial {...pcb(PCB_GREEN)} />
      </mesh>
      <mesh position={[0, mm(6), 0]} castShadow>
        <boxGeometry args={[mm(13), mm(9), mm(13)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <group
        ref={knob}
        position={[0, mm(14), 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (!liveId) return;
          drag.current = { x: e.nativeEvent.clientX, steps: useSim3D.getState().encoder[liveId] ?? 0 };
        }}
        onPointerMove={(e) => {
          if (!drag.current || !liveId) return;
          e.stopPropagation();
          const dx = Math.round((e.nativeEvent.clientX - drag.current.x) / 12);
          useSim3D.getState().setEncoder(liveId, drag.current.steps + dx);
        }}
        onPointerUp={(e) => {
          if (drag.current) e.stopPropagation();
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
      >
        <mesh castShadow>
          <cylinderGeometry args={[mm(7), mm(7), mm(12), 24]} />
          <meshStandardMaterial color={KNOB_CREAM} roughness={0.5} />
        </mesh>
        {/* knurl */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * mm(7), 0, Math.sin(a) * mm(7)]}>
              <boxGeometry args={[mm(0.8), mm(12), mm(0.8)]} />
              <meshStandardMaterial color="#c9b98f" roughness={0.6} />
            </mesh>
          );
        })}
        {/* pointer */}
        <mesh position={[0, mm(6.2), mm(4.5)]}>
          <boxGeometry args={[mm(1.4), mm(0.6), mm(4)]} />
          <meshStandardMaterial color="#7c4a12" roughness={0.5} />
        </mesh>
      </group>
      {/* push action */}
      <group
        position={[0, mm(2), mm(0)]}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (liveId) useSim3D.getState().setPressed(liveId, true);
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          if (liveId) useSim3D.getState().setPressed(liveId, false);
        }}
        onPointerLeave={() => {
          if (liveId) useSim3D.getState().setPressed(liveId, false);
        }}
      >
        <mesh position={[mm(11), 0, 0]}>
          <boxGeometry args={[mm(4), mm(2), mm(4)]} />
          <meshStandardMaterial color={livePressed(liveId) ? '#22c55e' : '#14532d'} roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

/* ── Membrane keypad: domes depress ────────────────────────────────────── */

const KEYS = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'];

function Keypad({ liveId }: { liveId?: string }) {
  const last = useSim3D((s) => (liveId ? s.lastKey[liveId] : undefined));
  return (
    <group>
      <mesh position={[0, mm(0.6), 0]} castShadow receiveShadow>
        <boxGeometry args={[mm(70), mm(1.2), mm(77)]} />
        <meshStandardMaterial color="#262a30" roughness={0.6} />
      </mesh>
      {KEYS.map((k, i) => {
        const c = i % 4;
        const r = Math.floor(i / 4);
        const active = last === k;
        return (
          <group
            key={k}
            position={[mm(-24 + c * 16), mm(1.2), mm(-24 + r * 16)]}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (!liveId) return;
              useSim3D.getState().setLastKey(liveId, k);
              useSim3D.getState().setPressed(`${liveId}:${k}`, true);
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              if (liveId) useSim3D.getState().setPressed(`${liveId}:${k}`, false);
            }}
            onPointerLeave={() => {
              if (liveId) useSim3D.getState().setPressed(`${liveId}:${k}`, false);
            }}
          >
            <KeyDome active={active} liveId={liveId ? `${liveId}:${k}` : undefined} />
          </group>
        );
      })}
      {/* ribbon */}
      <mesh position={[0, mm(0.8), mm(46)]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[mm(18), mm(0.4), mm(16)]} />
        <meshStandardMaterial color="#eab308" roughness={0.5} />
      </mesh>
    </group>
  );
}

function KeyDome({ active, liveId }: { active: boolean; liveId?: string }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const target = livePressed(liveId) || active ? -0.0009 : 0;
    g.position.y += (target - g.position.y) * 0.5;
  });
  return (
    <group ref={ref}>
      <mesh castShadow>
        <boxGeometry args={[mm(13), mm(1.6), mm(13)]} />
        <meshStandardMaterial color={active ? '#3b82f6' : '#3a3f45'} roughness={0.5} />
      </mesh>
    </group>
  );
}

/* ── Pots ──────────────────────────────────────────────────────────────── */

function Pot({ liveId }: { liveId?: string }) {
  return (
    <group>
      {/* body */}
      <mesh position={[0, mm(5), 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[mm(8), mm(8), mm(10), 20]} />
        <meshStandardMaterial {...plastic('#262a30')} />
      </mesh>
      <mesh position={[0, mm(5), mm(5.4)]}>
        <boxGeometry args={[mm(6), mm(3), mm(1)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <group position={[0, mm(5), mm(8)]}>
        <DragKnob id={liveId}>
          <mesh castShadow>
            <cylinderGeometry args={[mm(6), mm(6), mm(14), 20]} />
            <meshStandardMaterial color={KNOB_CREAM} roughness={0.5} />
          </mesh>
          <mesh position={[0, mm(2), mm(5.4)]}>
            <boxGeometry args={[mm(1.6), mm(8), mm(0.8)]} />
            <meshStandardMaterial color="#7c4a12" roughness={0.5} />
          </mesh>
        </DragKnob>
      </group>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[mm(i * 5), mm(-1), mm(-4)]}>
          <boxGeometry args={[mm(0.8), mm(4), mm(0.8)]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
    </group>
  );
}

function SlidePot({ liveId }: { liveId?: string }) {
  const frac = liveAnalog01(liveId, 0.5);
  const knob = useRef<Group>(null);
  useFrame(() => {
    const g = knob.current;
    if (!g) return;
    const st = useSim3D.getState();
    const f = liveId ? (st.analog[liveId] ?? 512) / 1023 : frac;
    const target = (f - 0.5) * 0.04;
    g.position.x += (target - g.position.x) * 0.3;
  });
  return (
    <group
      onPointerDown={(e) => {
        e.stopPropagation();
        if (!liveId) return;
        // click-to-position along the 40 mm travel
        const p = e.point.clone();
        const local = Math.max(-0.02, Math.min(0.02, p.x));
        useSim3D.getState().setAnalog(liveId, ((local + 0.02) / 0.04) * 1023);
      }}
    >
      <mesh position={[0, mm(3), 0]} castShadow>
        <boxGeometry args={[mm(60), mm(6), mm(12)]} />
        <meshStandardMaterial {...plastic('#20242a')} />
      </mesh>
      <mesh position={[0, mm(6.2), 0]}>
        <boxGeometry args={[mm(44), mm(0.8), mm(2)]} />
        <meshStandardMaterial color="#0c0d10" roughness={0.6} />
      </mesh>
      <group ref={knob} position={[0, mm(7.5), 0]}>
        <mesh castShadow>
          <boxGeometry args={[mm(8), mm(5), mm(10)]} />
          <meshStandardMaterial color="#e8e4da" roughness={0.45} />
        </mesh>
        <mesh position={[0, mm(1), 0]}>
          <boxGeometry args={[mm(1.2), mm(3.4), mm(10.2)]} />
          <meshStandardMaterial color="#b01e24" roughness={0.45} />
        </mesh>
      </group>
    </group>
  );
}

/* ── IR remote handset ─────────────────────────────────────────────────── */

const REMOTE_KEYS = ['PWR', '1', '2', '3', 'OK', '4', '5', '6'];

function IrRemote({ liveId }: { liveId?: string }) {
  const last = useSim3D((s) => (liveId ? s.lastKey[liveId] : undefined));
  const cells = useMemo(() => {
    const arr: [number, number][] = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) arr.push([c, r]);
    return arr;
  }, []);
  return (
    <group>
      <mesh position={[0, mm(3.5), 0]} castShadow>
        <boxGeometry args={[mm(40), mm(7), mm(86)]} />
        <meshStandardMaterial {...plastic('#262a30')} />
      </mesh>
      {/* IR LED window */}
      <mesh position={[0, mm(3.5), mm(-43.5)]}>
        <boxGeometry args={[mm(8), mm(3), mm(1)]} />
        <meshStandardMaterial color="#3b0764" emissive="#7c3aed" emissiveIntensity={0.5} roughness={0.2} />
      </mesh>
      {cells.map(([c, r], i) => {
        const label = REMOTE_KEYS[i] ?? `${i}`;
        const active = last === label;
        return (
          <group
            key={i}
            position={[mm(-9 + c * 18), mm(7.2), mm(-28 + r * 16)]}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (liveId) useSim3D.getState().setLastKey(liveId, label);
            }}
          >
            <mesh castShadow>
              <cylinderGeometry args={[mm(5), mm(5), mm(2), 16]} />
              <meshStandardMaterial color={active ? '#3b82f6' : '#3a3f45'} roughness={0.45} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ── Power / breadboard (static, true-scale anchors) ───────────────────── */

function PowerSupply() {
  return (
    <group>
      <mesh position={[0, mm(11), 0]} castShadow>
        <boxGeometry args={[mm(53), mm(22), mm(32)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      {/* pin combs */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 20), mm(1), 0]}>
          <boxGeometry args={[mm(8), mm(2), mm(28)]} />
          <meshStandardMaterial {...plastic('#eab308')} />
        </mesh>
      ))}
      {/* selector jumper */}
      <mesh position={[0, mm(22.6), 0]}>
        <boxGeometry args={[mm(6), mm(1.5), mm(6)]} />
        <meshStandardMaterial {...plastic('#eab308')} />
      </mesh>
      {/* USB in */}
      <mesh position={[mm(-18), mm(8), mm(16.5)]}>
        <boxGeometry args={[mm(8), mm(4), mm(2)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
    </group>
  );
}

function Battery9v() {
  return (
    <group>
      <mesh position={[0, mm(24.25), 0]} castShadow>
        <boxGeometry args={[mm(26.5), mm(48.5), mm(17.5)]} />
        <meshStandardMaterial color="#c9ced4" metalness={0.55} roughness={0.4} />
      </mesh>
      <mesh position={[0, mm(48.7), 0]}>
        <boxGeometry args={[mm(20), mm(1.5), mm(12)]} />
        <meshStandardMaterial {...plastic('#101216')} />
      </mesh>
      {/* snap terminals */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 6), mm(50), 0]}>
          <cylinderGeometry args={[mm(s < 0 ? 2.8 : 2.2), mm(s < 0 ? 2.8 : 2.2), mm(1.5), 12]} />
          <meshStandardMaterial {...steel} />
        </mesh>
      ))}
    </group>
  );
}

function CoinCell() {
  return (
    <group>
      <mesh position={[0, mm(1.6), 0]} castShadow>
        <cylinderGeometry args={[mm(10), mm(10), mm(3.2), 28]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[0, mm(3.3), 0]}>
        <cylinderGeometry args={[mm(9), mm(9), mm(0.2), 28]} />
        <meshStandardMaterial color="#8a9099" metalness={0.8} roughness={0.35} />
      </mesh>
    </group>
  );
}

/**
 * True-pitch breadboard top, drawn not modelled.
 *
 * A real MB-102 is 165×55 mm with 830 tie points on the 2.54 mm grid
 * (63×10 terminals + 4×50 rails) — 830 meshes would sink the scene graph,
 * so the top face is ONE canvas texture with every hole at its true
 * position, plus rail stripes and column numbers. The mini (SYB-170 class,
 * 55×35 mm) is 17×10 with no rails. One draw call, crisper than geometry.
 */
function useBreadboardTop(mini: boolean): THREE.CanvasTexture {
  return useMemo(() => {
    const wMm = mini ? 55 : 165;
    const dMm = mini ? 35 : 55;
    const W = mini ? 768 : 2048;
    const H = Math.round((W * dMm) / wMm);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const sx = W / wMm; // px per mm
      const X = (xMm: number): number => (xMm + wMm / 2) * sx;
      const Z = (zMm: number): number => (zMm + dMm / 2) * sx;
      ctx.fillStyle = '#f2efe9';
      ctx.fillRect(0, 0, W, H);
      // Centre DIP channel (7.62 mm, like the real gap).
      ctx.fillStyle = '#d9d3c5';
      ctx.fillRect(X(-(wMm - 10) / 2), Z(-3.81), (wMm - 10) * sx, 7.62 * sx);
      ctx.fillStyle = '#c4beb0';
      ctx.fillRect(X(-(wMm - 10) / 2), Z(3.6), (wMm - 10) * sx, Math.max(1, 0.25 * sx));
      const hole = (xMm: number, zMm: number): void => {
        ctx.fillStyle = '#33363b';
        ctx.fillRect(X(xMm - 0.85), Z(zMm - 0.85), 1.7 * sx, 1.7 * sx);
      };
      const cols = mini ? 17 : 63;
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * 2.54;
        for (let r = 0; r < 5; r++) {
          hole(x, -13.97 + r * 2.54); // a–e
          hole(x, 3.81 + r * 2.54); // f–j
        }
      }
      if (!mini) {
        // Power rails: 50 holes each at 2.54 mm pitch + polarity stripes.
        const stripe = (zMm: number, color: string): void => {
          ctx.fillStyle = color;
          ctx.fillRect(X(-80), Z(zMm - 0.5), 160 * sx, 1 * sx);
        };
        for (let i = 0; i < 50; i++) {
          const x = (i - 24.5) * 2.54;
          hole(x, -19.9);
          hole(x, -22.4);
          hole(x, 19.9);
          hole(x, 22.4);
        }
        stripe(-18.4, '#c0202a');
        stripe(-23.9, '#2050c0');
        stripe(18.4, '#c0202a');
        stripe(23.9, '#2050c0');
        ctx.fillStyle = '#9aa0a3';
        ctx.font = `${Math.round(2.2 * sx)}px sans-serif`;
        ctx.textAlign = 'center';
        for (let c = 0; c < cols; c += 5) {
          const x = (c - (cols - 1) / 2) * 2.54;
          ctx.fillText(String(c + 1), X(x), Z(-16.6));
        }
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }, [mini]);
}

function Breadboard({ mini = false }: { mini?: boolean }) {
  const w = mini ? 55 : 165;
  const d = mini ? 35 : 55;
  const top = useBreadboardTop(mini);
  useEffect(() => () => top.dispose(), [top]);
  return (
    <group>
      <mesh position={[0, mm(4.5), 0]} castShadow receiveShadow>
        <boxGeometry args={[mm(w), mm(9), mm(d)]} />
        <meshStandardMaterial color="#f2efe9" roughness={0.75} />
      </mesh>
      {/* printed top: every tie point at true 2.54 mm pitch */}
      <mesh position={[0, mm(9.02), 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[mm(w), mm(d)]} />
        <meshStandardMaterial map={top} roughness={0.75} />
      </mesh>
    </group>
  );
}

function SignalGen() {
  return (
    <group>
      <mesh position={[0, mm(7.5), 0]} castShadow>
        <boxGeometry args={[mm(70), mm(15), mm(50)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      <mesh position={[mm(-20), mm(7.5), mm(25.5)]}>
        <cylinderGeometry args={[mm(5), mm(5), mm(3), 18]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[mm(20), mm(7.5), mm(25.5)]}>
        <cylinderGeometry args={[mm(5), mm(5), mm(3), 18]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[0, mm(12), 0]}>
        <boxGeometry args={[mm(20), mm(5), mm(20)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
    </group>
  );
}

function RotaryDialer() {
  return (
    <group>
      <mesh position={[0, mm(1), 0]} castShadow>
        <cylinderGeometry args={[mm(24), mm(24), mm(2), 32]} />
        <meshStandardMaterial {...plastic('#101216')} />
      </mesh>
      {Array.from({ length: 10 }).map((_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * mm(16), mm(3), Math.sin(a) * mm(16)]}>
            <cylinderGeometry args={[mm(3), mm(3), mm(4), 14]} />
            <meshStandardMaterial color="#e8e4da" roughness={0.5} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ── TP4056 Li-ion charger ─────────────────────────────────────────────── */

function Tp4056() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(25), mm(1.6), mm(19)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      <mesh position={[mm(-8), mm(2.4), 0]}>
        <boxGeometry args={[mm(7.5), mm(3.2), mm(6)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[mm(2), mm(1.8), mm(-4)]}>
        <boxGeometry args={[mm(4), mm(1), mm(4)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[mm(2), mm(1.8), mm(3)]}>
        <boxGeometry args={[mm(3), mm(1), mm(3)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[mm(9), mm(1.8), 0]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial color="#b91c1c" emissive="#ef4444" emissiveIntensity={1.4} />
      </mesh>
      <mesh position={[mm(9), mm(1.8), mm(4)]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial color="#14532d" emissive="#000000" emissiveIntensity={0} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(9), mm(1), mm(s * -6.5)]}>
          <boxGeometry args={[mm(4), mm(0.4), mm(3)]} />
          <meshStandardMaterial {...gold} />
        </mesh>
      ))}
    </group>
  );
}

/* ── LM2596 buck module ───────────────────────────────────────────────── */

function BuckModule() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(43), mm(1.6), mm(21)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      <mesh position={[mm(-8), mm(5), 0]}>
        <torusGeometry args={[mm(4), mm(2.6), 10, 20]} />
        <meshStandardMaterial color="#d8a920" roughness={0.55} />
      </mesh>
      <mesh position={[mm(6), mm(3), mm(-4)]}>
        <boxGeometry args={[mm(9), mm(5), mm(9)]} />
        <meshStandardMaterial {...plastic('#1d4ed8')} />
      </mesh>
      <mesh position={[mm(6), mm(5.8), mm(-4)]}>
        <cylinderGeometry args={[mm(1.5), mm(1.5), mm(1), 6]} />
        <meshStandardMaterial color="#d8b25a" metalness={0.85} roughness={0.3} />
      </mesh>
      {[-15, 15].map((x) => (
        <mesh key={x} position={[mm(x), mm(4), mm(4)]}>
          <boxGeometry args={[mm(10), mm(7), mm(9)]} />
          <meshStandardMaterial {...plastic('#15803d')} />
        </mesh>
      ))}
      <mesh position={[mm(-1), mm(2.4), mm(6)]}>
        <boxGeometry args={[mm(6), mm(2), mm(3)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      {[-14, 0, 12].map((x) => (
        <mesh key={x} position={[mm(x), mm(3), mm(-7)]}>
          <cylinderGeometry args={[mm(2.5), mm(2.5), mm(6), 12]} />
          <meshStandardMaterial {...plastic('#1a1a2e')} />
        </mesh>
      ))}
      <mesh position={[mm(18), mm(2), mm(-7)]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial color="#b91c1c" emissive="#ef4444" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

/* ── HLK-PM01 mains module ────────────────────────────────────────────── */

function HlkPm01() {
  return (
    <group>
      <mesh position={[0, mm(7.5), 0]} castShadow>
        <boxGeometry args={[mm(34), mm(15), mm(20)]} />
        <meshStandardMaterial {...plastic('#151515')} />
      </mesh>
      <mesh position={[0, mm(15.6), 0]}>
        <boxGeometry args={[mm(20), mm(0.3), mm(12)]} />
        <meshStandardMaterial color="#e8e8e8" roughness={0.7} />
      </mesh>
      {[
        [-10, -6],
        [10, -6],
        [-10, 6],
        [10, 6],
      ].map(([x, z], i) => (
        <mesh key={i} position={[mm(x), mm(-2), mm(z)]}>
          <cylinderGeometry args={[mm(0.5), mm(0.5), mm(5), 8]} />
          <meshStandardMaterial color="#d8b25a" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

export default function Inputs3D(props: PartViewProps) {
  const { kind, liveId } = props;
  switch (kind) {
    case 'pushbutton':
      return <Tactile liveId={liveId} size={12} />;
    case 'pushbutton-6mm':
      return <Tactile liveId={liveId} size={6} capR={2.2} />;
    case 'slide-switch':
      return <SlideSwitch liveId={liveId} />;
    case 'dip-switch-8':
      return <Dip8 liveId={liveId} />;
    case 'ky-040':
      return <Ky040 liveId={liveId} />;
    case 'membrane-keypad':
      return <Keypad liveId={liveId} />;
    case 'potentiometer':
      return <Pot liveId={liveId} />;
    case 'slide-potentiometer':
      return <SlidePot liveId={liveId} />;
    case 'ir-remote':
      return <IrRemote liveId={liveId} />;
    case 'rotary-dialer':
      return <RotaryDialer />;
    case 'power-supply':
      return <PowerSupply />;
    case 'battery-9v':
      return <Battery9v />;
    case 'battery-aa':
      return (
        <mesh position={[0, mm(7.25), 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[mm(7.25), mm(7.25), mm(50.5), 24]} />
          <meshStandardMaterial color="#3fae5a" roughness={0.5} />
        </mesh>
      );
    case 'battery-coin-cell':
      return <CoinCell />;
    case 'breadboard':
      return <Breadboard />;
    case 'breadboard-mini':
      return <Breadboard mini />;
    case 'signal-generator':
      return <SignalGen />;
    case 'tp4056':
      return <Tp4056 />;
    case 'buck-module':
      return <BuckModule />;
    case 'hlk-pm01':
      return <HlkPm01 />;
    default:
      return <Tactile liveId={liveId} size={12} />;
  }
}
