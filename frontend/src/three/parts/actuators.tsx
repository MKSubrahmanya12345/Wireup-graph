/**
 * parts/actuators.tsx — things that move, click, sing or glow.
 *
 * Servo horn angle, stepper shaft, relay armature, buzzer ripple and LED
 * glow are all live functions of simStore — the same state the bench
 * elements and the controls panel write. Servo PWM range 544–2400 µs is
 * honoured by the sim layer; here we just render the commanded angle.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group, MeshStandardMaterial } from 'three';
import { GlowDome, ServoHorn, SpinShaft, mm } from './common';
import type { PartViewProps } from './common';
import { PCB_BLUE, PCB_GREEN, SERVO_ORANGE, chip, ledHex, lit, pcb, plastic, steel } from '../materials';
import { useSim3D } from '../simStore';

/* ── SG90 servo ───────────────────────────────────────────────────────── */

function Sg90({ liveId }: { liveId?: string }) {
  return (
    <group>
      {/* case */}
      <mesh position={[0, mm(14.5), 0]} castShadow>
        <boxGeometry args={[mm(23), mm(29), mm(12.2)]} />
        <meshStandardMaterial color={SERVO_ORANGE} roughness={0.55} metalness={0.05} />
      </mesh>
      {/* mounting flange */}
      <mesh position={[0, mm(24), 0]} castShadow>
        <boxGeometry args={[mm(32.5), mm(2.5), mm(12.2)]} />
        <meshStandardMaterial color="#c75e1c" roughness={0.6} />
      </mesh>
      {/* output spline */}
      <mesh position={[mm(5.5), mm(29.6), 0]}>
        <cylinderGeometry args={[mm(2.3), mm(2.3), mm(3), 12]} />
        <meshStandardMaterial color="#f5f2e8" roughness={0.5} />
      </mesh>
      {/* horn tracks the live angle */}
      <group position={[mm(5.5), mm(31.5), 0]}>
        <ServoHorn id={liveId}>
          <mesh castShadow>
            <boxGeometry args={[mm(20), mm(1.4), mm(4)]} />
            <meshStandardMaterial {...plastic('#f5f2e8')} />
          </mesh>
          {[-8, 0, 8].map((x) => (
            <mesh key={x} position={[mm(x), mm(0.4), 0]}>
              <cylinderGeometry args={[mm(0.9), mm(0.9), mm(1), 10]} />
              <meshStandardMaterial {...plastic('#2a2e34')} />
            </mesh>
          ))}
        </ServoHorn>
      </group>
      {/* lead */}
      <mesh position={[mm(-8), mm(2), mm(8)]} rotation={[0.4, 0, 0.3]}>
        <cylinderGeometry args={[mm(1.2), mm(1.2), mm(30), 8]} />
        <meshStandardMaterial color="#7c4a12" roughness={0.7} />
      </mesh>
    </group>
  );
}

/* ── Stepper (NEMA-17 outline) ────────────────────────────────────────── */

function Stepper({ liveId }: { liveId?: string }) {
  return (
    <group>
      <mesh position={[0, mm(20), 0]} castShadow>
        <boxGeometry args={[mm(42), mm(40), mm(42)]} />
        <meshStandardMaterial color="#3a3f45" roughness={0.45} metalness={0.55} />
      </mesh>
      {/* end caps */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, mm(s < 0 ? 1 : 39), 0]}>
          <boxGeometry args={[mm(42), mm(2), mm(42)]} />
          <meshStandardMaterial {...plastic('#23262b')} />
        </mesh>
      ))}
      {/* corner bolts */}
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <mesh key={i} position={[mm(sx * 15.5), mm(20), mm(sz * 15.5)]}>
          <cylinderGeometry args={[mm(1.6), mm(1.6), mm(42), 10]} />
          <meshStandardMaterial {...steel} />
        </mesh>
      ))}
      <group position={[0, mm(41), 0]}>
        <SpinShaft id={liveId} axis="y">
          <mesh>
            <cylinderGeometry args={[mm(2.5), mm(2.5), mm(12), 14]} />
            <meshStandardMaterial {...steel} />
          </mesh>
          <mesh position={[0, mm(4), 0]}>
            <boxGeometry args={[mm(2), mm(3), mm(2)]} />
            <meshStandardMaterial color="#c9c9c9" metalness={0.8} roughness={0.25} />
          </mesh>
        </SpinShaft>
      </group>
      {/* lead wires */}
      <mesh position={[mm(24), mm(10), 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[mm(2), mm(2), mm(10), 10]} />
        <meshStandardMaterial {...plastic('#7c2d12')} />
      </mesh>
    </group>
  );
}

function PanTilt({ liveId }: { liveId?: string }) {
  return (
    <group>
      <group position={[-mm(14), 0, 0]}>
        <Sg90 liveId={liveId} />
      </group>
      <group position={[mm(14), mm(20), 0]} rotation={[0, 0, Math.PI / 2]}>
        <Sg90 liveId={liveId} />
      </group>
    </group>
  );
}

/* ── Relay with armature ──────────────────────────────────────────────── */

function RelayArm({ on, x = 0 }: { on: boolean; x?: number }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.rotation.z += ((on ? -0.18 : 0) - g.rotation.z) * 0.3;
  });
  return (
    <group ref={ref} position={[mm(x), mm(10), 0]}>
      <mesh position={[mm(6), 0, 0]}>
        <boxGeometry args={[mm(14), mm(1.2), mm(4)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
    </group>
  );
}

function RelayModule({ liveId, channels = 1 }: { liveId?: string; channels?: number }) {
  const ch1 = useSim3D((s) => (liveId ? (s.switchOn[liveId] ?? false) : false));
  const ch2 = useSim3D((s) => (liveId ? (s.sensors[liveId]?.ch2 as boolean | undefined) : undefined)) ?? false;
  const w = channels === 2 ? 58 : 50;
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]} castShadow receiveShadow>
        <boxGeometry args={[mm(w), mm(1.6), mm(channels === 2 ? 50 : 26)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      {[0, 1].slice(0, channels).map((ch) => {
        const on = ch === 0 ? ch1 : ch2;
        const cx = channels === 2 ? (ch === 0 ? -12 : 12) : 0;
        return (
          <group key={ch} position={[mm(cx), 0, 0]}>
            {/* blue cube */}
            <mesh position={[0, mm(9), 0]} castShadow>
              <boxGeometry args={[mm(15), mm(15), mm(20)]} />
              <meshStandardMaterial color="#1d4fd7" roughness={0.45} />
            </mesh>
            <RelayArm on={on} x={0} />
            {/* status LED */}
            <mesh position={[mm(4), mm(2.4), mm(8)]}>
              <boxGeometry args={[mm(3), mm(1), mm(1.6)]} />
              <meshStandardMaterial
                color={on ? '#ef4444' : '#450a0a'}
                emissive={on ? '#ef4444' : '#000000'}
                emissiveIntensity={on ? 1.8 : 0}
              />
            </mesh>
            {/* screw terminals */}
            {[-6, 0, 6].map((tx) => (
              <mesh key={tx} position={[mm(tx), mm(4), mm(-14)]} castShadow>
                <boxGeometry args={[mm(6), mm(8), mm(7)]} />
                <meshStandardMaterial {...plastic('#1d4fd7')} />
              </mesh>
            ))}
          </group>
        );
      })}
      {/* optocouplers */}
      <mesh position={[0, mm(2.4), mm(14)]}>
        <boxGeometry args={[mm(5), mm(2), mm(5)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
    </group>
  );
}

/* ── Buzzer with ripple ───────────────────────────────────────────────── */

function Buzzer({ liveId }: { liveId?: string }) {
  const ring = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const st = useSim3D.getState();
    const on = liveId
      ? (st.pressed[liveId] === true || st.switchOn[liveId] === true || st.heartbeat.ledOn)
      : (Math.sin(clock.elapsedTime * 4) > 0.6);
    if (mat.current) mat.current.emissiveIntensity = on ? 1.4 : 0.05;
    if (ring.current) {
      const s = on ? 1 + (clock.elapsedTime * 2) % 1 * 0.9 : 1;
      ring.current.scale.set(s, 1, s);
    }
  });
  return (
    <group>
      <mesh position={[0, mm(4.75), 0]} castShadow>
        <cylinderGeometry args={[mm(6), mm(6), mm(9.5), 24]} />
        <meshStandardMaterial {...plastic('#101216')} />
      </mesh>
      <mesh position={[0, mm(9.6), 0]}>
        <cylinderGeometry args={[mm(2.2), mm(2.2), mm(0.4), 16]} />
        <meshStandardMaterial
          ref={mat}
          color="#1c1f24"
          emissive="#fbbf24"
          emissiveIntensity={0.05}
          roughness={0.5}
        />
      </mesh>
      <group ref={ring} position={[0, mm(9.8), 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[mm(6.5), mm(7.5), 28]} />
          <meshStandardMaterial color="#fbbf24" transparent opacity={0.5} side={2} depthWrite={false} />
        </mesh>
      </group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 3.5), mm(-1), 0]}>
          <cylinderGeometry args={[mm(0.35), mm(0.35), mm(4), 8]} />
          <meshStandardMaterial color="#c9c9c9" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/* ── LEDs ─────────────────────────────────────────────────────────────── */

function IndicatorLed({ liveId, accent }: { liveId?: string; accent?: string }) {
  const color = useSim3D((s) => (liveId && s.led[liveId] ? s.led[liveId].color : ledHex(accent)));
  return (
    <group>
      {/* leads */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 1.27), mm(1.5), 0]}>
          <cylinderGeometry args={[mm(0.25), mm(0.25), mm(7), 8]} />
          <meshStandardMaterial color="#c9c9c9" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, mm(3.2), 0]}>
        <cylinderGeometry args={[mm(2.5), mm(2.5), mm(1), 16]} />
        <meshStandardMaterial color={color} transparent opacity={0.85} roughness={0.3} />
      </mesh>
      <GlowDome id={liveId} color={color} heartbeat={liveId === undefined} r={0.0025} y={0.0037} />
      {/* flat spot marks cathode */}
      <mesh position={[mm(-2.2), mm(3.4), 0]}>
        <boxGeometry args={[mm(0.8), mm(1.6), mm(1)]} />
        <meshStandardMaterial color={color} roughness={0.3} />
      </mesh>
    </group>
  );
}

function RgbLed({ liveId }: { liveId?: string }) {
  const col = useSim3D((s) => {
    if (!liveId) return '#ff8800';
    const sn = s.sensors[liveId];
    const r = Math.max(0, Math.min(255, Number(sn?.r ?? 255)));
    const g = Math.max(0, Math.min(255, Number(sn?.g ?? 136)));
    const b = Math.max(0, Math.min(255, Number(sn?.b ?? 0)));
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  });
  return (
    <group>
      {[-1.5, -0.5, 0.5, 1.5].map((x, i) => (
        <mesh key={i} position={[mm(x), mm(1.5), 0]}>
          <cylinderGeometry args={[mm(0.25), mm(0.25), mm(7), 8]} />
          <meshStandardMaterial color="#c9c9c9" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, mm(3.2), 0]}>
        <cylinderGeometry args={[mm(2.5), mm(2.5), mm(1), 16]} />
        <meshStandardMaterial color={col} transparent opacity={0.85} roughness={0.3} />
      </mesh>
      <GlowDome id={liveId} color={col} r={0.0025} y={0.0037} />
    </group>
  );
}

function NeoSingle({ liveId }: { liveId?: string }) {
  const color = useSim3D((s) => (liveId ? s.led[liveId]?.color ?? '#ff4400' : '#ff4400'));
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]} castShadow>
        <boxGeometry args={[mm(5), mm(1.6), mm(5)]} />
        <meshStandardMaterial color="#f5f2e8" roughness={0.4} />
      </mesh>
      <mesh position={[0, mm(1.65), 0]}>
        <boxGeometry args={[mm(3.4), mm(0.2), mm(3.4)]} />
        <meshStandardMaterial {...lit(color, 1.8)} />
      </mesh>
    </group>
  );
}

/* ── Drivers / storage ────────────────────────────────────────────────── */

function A4988() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]} castShadow>
        <boxGeometry args={[mm(20), mm(1.6), mm(15)]} />
        <meshStandardMaterial {...pcb(PCB_GREEN)} />
      </mesh>
      <mesh position={[0, mm(2.4), 0]} castShadow>
        <boxGeometry args={[mm(6), mm(1.6), mm(6)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      {/* heatsink */}
      <mesh position={[0, mm(4.4), 0]} castShadow>
        <boxGeometry args={[mm(9), mm(4), mm(9)]} />
        <meshStandardMaterial color="#c9ced4" metalness={0.7} roughness={0.5} />
      </mesh>
      {/* trimmer */}
      <mesh position={[mm(6), mm(2.6), mm(4)]}>
        <cylinderGeometry args={[mm(1.5), mm(1.5), mm(1.4), 12]} />
        <meshStandardMaterial {...plastic('#e8e4da')} />
      </mesh>
    </group>
  );
}

function L293d() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]} castShadow>
        <boxGeometry args={[mm(60), mm(1.6), mm(25)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      <mesh position={[0, mm(3.4), 0]} castShadow>
        <boxGeometry args={[mm(19.3), mm(5), mm(7.6)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      {/* heatsink slab */}
      <mesh position={[0, mm(8), 0]} castShadow>
        <boxGeometry args={[mm(30), mm(6), mm(12)]} />
        <meshStandardMaterial color="#8a9099" metalness={0.8} roughness={0.4} />
      </mesh>
      {/* screw terminals */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 22), mm(5), 0]} castShadow>
          <boxGeometry args={[mm(12), mm(9), mm(9)]} />
          <meshStandardMaterial {...plastic('#1d4fd7')} />
        </mesh>
      ))}
    </group>
  );
}

function MicroSd() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]} castShadow>
        <boxGeometry args={[mm(30), mm(1.6), mm(20)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      {/* card socket */}
      <mesh position={[-mm(4), mm(3), 0]} castShadow>
        <boxGeometry args={[mm(14), mm(3), mm(16)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      {/* card peeking out */}
      <mesh position={[-mm(4), mm(3), mm(9)]}>
        <boxGeometry args={[mm(11), mm(1), mm(8)]} />
        <meshStandardMaterial {...plastic('#101216')} />
      </mesh>
      {/* 3v3 regulator */}
      <mesh position={[mm(9), mm(2.4), mm(-4)]}>
        <boxGeometry args={[mm(4), mm(1.6), mm(4)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
    </group>
  );
}

/* ── MG996R high-torque servo ─────────────────────────────────────────── */

function Mg996r({ liveId }: { liveId?: string }) {
  return (
    <group>
      <mesh position={[0, mm(19.8), 0]} castShadow>
        <boxGeometry args={[mm(40.7), mm(36), mm(19.7)]} />
        <meshStandardMaterial {...plastic('#1c1e22')} />
      </mesh>
      <mesh position={[0, mm(32), 0]} castShadow>
        <boxGeometry args={[mm(55), mm(2.5), mm(19.7)]} />
        <meshStandardMaterial {...plastic('#2a2e34')} />
      </mesh>
      <mesh position={[mm(10), mm(38), 0]}>
        <cylinderGeometry args={[mm(3), mm(3), mm(2), 12]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <group position={[mm(10), mm(40.5), 0]}>
        <ServoHorn id={liveId}>
          <mesh castShadow>
            <boxGeometry args={[mm(27), mm(1.8), mm(5)]} />
            <meshStandardMaterial {...plastic('#f5f2e8')} />
          </mesh>
          {[-11, 0, 11].map((x) => (
            <mesh key={x} position={[mm(x), mm(0.5), 0]}>
              <cylinderGeometry args={[mm(1.1), mm(1.1), mm(1.2), 10]} />
              <meshStandardMaterial {...plastic('#2a2e34')} />
            </mesh>
          ))}
        </ServoHorn>
      </group>
      <mesh position={[mm(-14), mm(2.5), mm(11)]} rotation={[0.4, 0, 0.3]}>
        <cylinderGeometry args={[mm(1.4), mm(1.4), mm(30), 8]} />
        <meshStandardMaterial color="#3a3a3a" roughness={0.7} />
      </mesh>
    </group>
  );
}

/* ── 28BYJ-48 geared stepper ──────────────────────────────────────────── */

function Byj28({ liveId }: { liveId?: string }) {
  return (
    <group>
      <mesh position={[0, mm(9.5), 0]} castShadow>
        <cylinderGeometry args={[mm(14), mm(14), mm(19), 24]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[0, mm(19.8), 0]}>
        <cylinderGeometry args={[mm(14), mm(14), mm(1.6), 24]} />
        <meshStandardMaterial {...plastic('#2a2e34')} />
      </mesh>
      <mesh position={[0, mm(-7), 0]}>
        <cylinderGeometry args={[mm(9), mm(9), mm(14), 18]} />
        <meshStandardMaterial color="#3a3f45" roughness={0.45} metalness={0.55} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 17.5), mm(4), 0]}>
          <boxGeometry args={[mm(7), mm(2), mm(6)]} />
          <meshStandardMaterial {...steel} />
        </mesh>
      ))}
      <group position={[0, mm(21), 0]}>
        <SpinShaft id={liveId} axis="y">
          <mesh>
            <cylinderGeometry args={[mm(2.5), mm(2.5), mm(10), 12]} />
            <meshStandardMaterial {...steel} />
          </mesh>
          <mesh position={[0, mm(3), 0]}>
            <boxGeometry args={[mm(1.6), mm(2.5), mm(1.6)]} />
            <meshStandardMaterial color="#c9c9c9" metalness={0.8} roughness={0.25} />
          </mesh>
        </SpinShaft>
      </group>
      <mesh position={[mm(-8), mm(4), mm(10)]}>
        <boxGeometry args={[mm(10), mm(3), mm(4)]} />
        <meshStandardMaterial {...plastic('#f5f5f5')} />
      </mesh>
      {['#e11d48', '#f59e0b', '#eab308', '#3b82f6', '#f97316'].map((c, i) => (
        <mesh key={c} position={[mm(-11 + i * 1.6), mm(4), mm(13.5)]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[mm(0.6), mm(0.6), mm(8), 6]} />
          <meshStandardMaterial color={c} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

/* ── L298N dual H-bridge module ───────────────────────────────────────── */

function L298n() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(43), mm(1.6), mm(43)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      <mesh position={[0, mm(6), mm(-6)]}>
        <boxGeometry args={[mm(30), mm(1.5), mm(24)]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.5} metalness={0.6} />
      </mesh>
      {[-12, -6, 0, 6, 12].map((x) => (
        <mesh key={x} position={[mm(x), mm(14), mm(-6)]}>
          <boxGeometry args={[mm(1.5), mm(16), mm(24)]} />
          <meshStandardMaterial color="#242424" roughness={0.45} metalness={0.65} />
        </mesh>
      ))}
      {[-14, 0, 14].map((x) => (
        <mesh key={x} position={[mm(x), mm(4), mm(16)]}>
          <boxGeometry args={[mm(10), mm(8), mm(9)]} />
          <meshStandardMaterial {...plastic('#15803d')} />
        </mesh>
      ))}
      {[-8, 8].map((x) => (
        <mesh key={x} position={[mm(x), mm(3), mm(-19)]}>
          <cylinderGeometry args={[mm(2.5), mm(2.5), mm(6), 12]} />
          <meshStandardMaterial {...plastic('#1a1a2e')} />
        </mesh>
      ))}
      {[-6, 0, 6].map((x) => (
        <mesh key={x} position={[mm(x), mm(3), mm(6)]}>
          <boxGeometry args={[mm(2.5), mm(4), mm(2.5)]} />
          <meshStandardMaterial {...plastic('#0a0a0a')} />
        </mesh>
      ))}
      <mesh position={[mm(-18), mm(2), mm(16)]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial color="#b91c1c" emissive="#ef4444" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

/* ── TT gear motor ────────────────────────────────────────────────────── */

function TtMotor({ liveId }: { liveId?: string }) {
  return (
    <group>
      <mesh position={[mm(-10), mm(11), 0]} castShadow>
        <boxGeometry args={[mm(46), mm(22), mm(18)]} />
        <meshStandardMaterial color="#f2c230" roughness={0.55} />
      </mesh>
      <mesh position={[mm(25), mm(11), 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[mm(10), mm(10), mm(24), 18]} />
        <meshStandardMaterial color="#9aa0a6" roughness={0.35} metalness={0.7} />
      </mesh>
      <group position={[mm(-33), mm(11), 0]} rotation={[0, 0, Math.PI / 2]}>
        <SpinShaft id={liveId} axis="y">
          <mesh>
            <cylinderGeometry args={[mm(2.8), mm(2.8), mm(8), 12]} />
            <meshStandardMaterial {...steel} />
          </mesh>
        </SpinShaft>
      </group>
      {[-2.5, 2.5].map((z) => (
        <mesh key={z} position={[mm(38), mm(8), mm(z)]} rotation={[0, 0, 0.5]}>
          <cylinderGeometry args={[mm(0.9), mm(0.9), mm(22), 6]} />
          <meshStandardMaterial color={z > 0 ? '#dc2626' : '#111111'} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

/* ── Coin vibration motor ─────────────────────────────────────────────── */

function VibroCoin() {
  return (
    <group>
      <mesh position={[0, mm(2.2), 0]}>
        <cylinderGeometry args={[mm(3.5), mm(3.5), mm(1), 16]} />
        <meshStandardMaterial {...plastic('#3f3f46')} />
      </mesh>
      <mesh position={[0, mm(3.9), 0]}>
        <cylinderGeometry args={[mm(5), mm(5), mm(2.7), 20]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 8), mm(0.6), 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[mm(0.5), mm(0.5), mm(14), 6]} />
          <meshStandardMaterial color={s > 0 ? '#dc2626' : '#2563eb'} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

/* ── 3010 5 V cooling fan ─────────────────────────────────────────────── */

function Fan30({ liveId }: { liveId?: string }) {
  return (
    <group>
      <mesh position={[0, mm(3.5), 0]} castShadow>
        <boxGeometry args={[mm(30), mm(7), mm(30)]} />
        <meshStandardMaterial {...plastic('#171717')} />
      </mesh>
      <mesh position={[0, mm(3.5), 0]}>
        <cylinderGeometry args={[mm(13.5), mm(13.5), mm(7.4), 24]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.9} />
      </mesh>
      <group position={[0, mm(3.5), 0]}>
        <SpinShaft id={liveId} axis="y">
          <mesh>
            <cylinderGeometry args={[mm(6), mm(6), mm(4), 16]} />
            <meshStandardMaterial {...plastic('#262626')} />
          </mesh>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[mm(9 * Math.cos((i * Math.PI) / 2)), 0, mm(9 * Math.sin((i * Math.PI) / 2))]} rotation={[0, -(i * Math.PI) / 2 + 0.5, 0]}>
              <boxGeometry args={[mm(7), mm(1.2), mm(5)]} />
              <meshStandardMaterial {...plastic('#333333')} />
            </mesh>
          ))}
        </SpinShaft>
      </group>
      {[
        [-12, -12],
        [12, -12],
        [-12, 12],
        [12, 12],
      ].map(([x, z], i) => (
        <mesh key={i} position={[mm(x), mm(3.5), mm(z)]}>
          <cylinderGeometry args={[mm(1.7), mm(1.7), mm(7.4), 10]} />
          <meshStandardMaterial color="#0a0a0a" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/* ── 40 mm 8 Ω speaker ────────────────────────────────────────────────── */

function Speaker40() {
  return (
    <group>
      <mesh position={[0, mm(3), 0]}>
        <cylinderGeometry args={[mm(20), mm(20), mm(6), 28]} />
        <meshStandardMaterial color="#3a3f45" roughness={0.4} metalness={0.6} />
      </mesh>
      <mesh position={[0, mm(6.4), 0]}>
        <coneGeometry args={[mm(19), mm(5), 28, 1, true]} />
        <meshStandardMaterial color="#1f2937" roughness={0.85} side={2} />
      </mesh>
      <mesh position={[0, mm(7), 0]}>
        <cylinderGeometry args={[mm(6), mm(6), mm(2.5), 16]} />
        <meshStandardMaterial color="#111827" roughness={0.7} />
      </mesh>
      <mesh position={[0, mm(-2.5), 0]}>
        <cylinderGeometry args={[mm(12), mm(12), mm(5), 20]} />
        <meshStandardMaterial color="#27272a" roughness={0.4} metalness={0.7} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 8), mm(-1), mm(14)]}>
          <boxGeometry args={[mm(3), mm(4), mm(1)]} />
          <meshStandardMaterial {...steel} />
        </mesh>
      ))}
    </group>
  );
}

/* ── TEC1-12706 Peltier ───────────────────────────────────────────────── */

function Peltier() {
  return (
    <group>
      <mesh position={[0, mm(1.9), 0]} castShadow>
        <boxGeometry args={[mm(40), mm(3.8), mm(40)]} />
        <meshStandardMaterial color="#f4f1ea" roughness={0.35} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 24), mm(1), 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[mm(0.9), mm(0.9), mm(12), 6]} />
          <meshStandardMaterial color={s > 0 ? '#dc2626' : '#111111'} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

export default function Actuators3D(props: PartViewProps) {
  const { kind, liveId, accent } = props;
  switch (kind) {
    case 'servo':
    case 'micro-servo':
      return <Sg90 liveId={liveId} />;
    case 'mg996r':
      return <Mg996r liveId={liveId} />;
    case 'stepper-motor':
      return <Stepper liveId={liveId} />;
    case 'stepper-28byj':
      return <Byj28 liveId={liveId} />;
    case 'stepper-nema17':
      return <Stepper liveId={liveId} />;
    case 'l298n':
      return <L298n />;
    case 'tt-motor':
      return <TtMotor liveId={liveId} />;
    case 'vibration-motor':
      return <VibroCoin />;
    case 'fan-30mm':
      return <Fan30 liveId={liveId} />;
    case 'speaker-40mm':
      return <Speaker40 />;
    case 'peltier':
      return <Peltier />;
    case 'biaxial-stepper':
      return <PanTilt liveId={liveId} />;
    case 'a4988':
      return <A4988 />;
    case 'motor-driver-l293d':
      return <L293d />;
    case 'relay':
      return <RelayModule liveId={liveId} channels={1} />;
    case 'ks2e-m-dc5':
      return <RelayModule liveId={liveId} channels={2} />;
    case 'buzzer':
      return <Buzzer liveId={liveId} />;
    case 'led':
      return <IndicatorLed liveId={liveId} accent={accent} />;
    case 'rgb-led':
      return <RgbLed liveId={liveId} />;
    case 'neopixel':
      return <NeoSingle liveId={liveId} />;
    case 'microsd-card':
      return <MicroSd />;
    default:
      return <IndicatorLed liveId={liveId} accent={accent} />;
  }
}

/** Re-exported so inputs.tsx can share the button red. */
export { BUTTON_RED };
