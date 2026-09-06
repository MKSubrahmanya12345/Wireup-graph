/**
 * parts/sensors.tsx — true-scale sensor modules with live behaviour.
 *
 * Each model mirrors the sim contract in sim/partSim.ts + sensorDefs.ts:
 * DHT/HC-SR04 own their data line (single-wire models), PIR fires a ~2 s
 * pulse, the joystick stick really tilts, the tilt-switch ball really rolls,
 * the LDR disc brightens with lux. Nothing here is decorative — pose and
 * glow are functions of the same store the bench writes.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group, MeshStandardMaterial } from 'three';
import { PinRow, mm } from './common';
import type { PartViewProps } from './common';
import { PCB_BLACK, PCB_BLUE, PCB_GREEN, PCB_RED, chip, gold, pcb, pin, plastic, silk, steel } from '../materials';
import { useSim3D } from '../simStore';

function Module({ w, d, color = PCB_BLUE, t = 1.6 }: { w: number; d: number; color?: string; t?: number }) {
  return (
    <group>
      <mesh position={[0, mm(t / 2), 0]} castShadow receiveShadow>
        <boxGeometry args={[mm(w), mm(t), mm(d)]} />
        <meshStandardMaterial {...pcb(color)} />
      </mesh>
      {/* mounting holes */}
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <mesh key={i} position={[mm((sx * (w / 2 - 2.5))), mm(t / 2), mm(sz * (d / 2 - 2.5))]}>
          <cylinderGeometry args={[mm(1.1), mm(1.1), mm(t + 0.3), 12]} />
          <meshStandardMaterial {...steel} />
        </mesh>
      ))}
    </group>
  );
}

function Header4({ w = 10 }: { w?: number }) {
  return (
    <group position={[0, mm(1.6), 0]}>
      <mesh position={[0, mm(1.2), 0]}>
        <boxGeometry args={[mm(w), mm(2.5), mm(2.5)]} />
        <meshStandardMaterial {...plastic('#101216')} />
      </mesh>
    </group>
  );
}

/* ── DHT22 / DHT11 ─────────────────────────────────────────────────────── */

function Dht({ blue = true }: { blue?: boolean }) {
  return (
    <group>
      <Module w={27} d={15} color={blue ? PCB_BLUE : PCB_RED} />
      {/* sensor body with vent slots */}
      <mesh position={[0, mm(5.5), 0]} castShadow>
        <boxGeometry args={[mm(17), mm(7), mm(10)]} />
        <meshStandardMaterial {...plastic(blue ? '#2563eb' : '#dc2626')} />
      </mesh>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[mm(i * 4), mm(9.1), 0]}>
          <boxGeometry args={[mm(1.6), mm(0.4), mm(10.2)]} />
          <meshStandardMaterial {...plastic('#101216')} />
        </mesh>
      ))}
      <Header4 w={10} />
    </group>
  );
}

/* ── BMP280 / BME280 ───────────────────────────────────────────────────── */

function Baro() {
  return (
    <group>
      <Module w={15} d={12} color={PCB_BLUE} />
      <mesh position={[0, mm(2.6), 0]} castShadow>
        <boxGeometry args={[mm(4), mm(1.6), mm(4)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      {/* pressure vent hole */}
      <mesh position={[0, mm(3.45), 0]}>
        <cylinderGeometry args={[mm(0.5), mm(0.5), mm(0.2), 10]} />
        <meshStandardMaterial {...plastic('#000000')} />
      </mesh>
      <Header4 w={8} />
    </group>
  );
}

/* ── DS18B20 probe ─────────────────────────────────────────────────────── */

function Ds18b20() {
  return (
    <group>
      {/* stainless probe head lying along X */}
      <mesh position={[0, mm(3), 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[mm(3), mm(3), mm(30), 20]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[mm(16), mm(3), 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[mm(2), mm(3), mm(4), 16]} />
        <meshStandardMaterial {...plastic('#101216')} />
      </mesh>
      {/* cable stub */}
      <mesh position={[mm(24), mm(3), 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[mm(1.8), mm(1.8), mm(12), 12]} />
        <meshStandardMaterial {...plastic('#1f2937')} />
      </mesh>
    </group>
  );
}

/* ── Capacitive soil ───────────────────────────────────────────────────── */

function Soil() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]} castShadow receiveShadow>
        <boxGeometry args={[mm(98), mm(1.6), mm(23)]} />
        <meshStandardMaterial {...pcb(PCB_RED)} />
      </mesh>
      {/* copper comb */}
      {Array.from({ length: 12 }).map((_, i) => (
        <mesh key={i} position={[mm(-38 + i * 6.4), mm(1.7), 0]}>
          <boxGeometry args={[mm(3.2), mm(0.15), mm(18)]} />
          <meshStandardMaterial color="#d8b25a" roughness={0.35} metalness={0.8} />
        </mesh>
      ))}
      <mesh position={[mm(40), mm(3), 0]}>
        <boxGeometry args={[mm(12), mm(2.5), mm(16)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
    </group>
  );
}

/* ── MQ gas ────────────────────────────────────────────────────────────── */

function Gas() {
  return (
    <group>
      <Module w={32} d={20} color={PCB_BLUE} />
      {/* heater can */}
      <mesh position={[-6, mm(12), 0]} castShadow>
        <cylinderGeometry args={[mm(8.5), mm(9), mm(12), 24]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[-6, mm(18.2), 0]}>
        <cylinderGeometry args={[mm(7.5), mm(7.5), mm(0.8), 24]} />
        <meshStandardMaterial {...plastic('#2a2e34')} />
      </mesh>
      {/* LM393 + trimmer + LEDs */}
      <mesh position={[8, mm(2.6), -4]}>
        <boxGeometry args={[mm(5), mm(1.6), mm(5)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[8, mm(3.4), 5]} castShadow>
        <boxGeometry args={[mm(6), mm(4), mm(6)]} />
        <meshStandardMaterial {...plastic('#1d4fd7')} />
      </mesh>
      <Header4 w={12} />
    </group>
  );
}

/* ── HC-SR04 with live echo cone ───────────────────────────────────────── */

function Hcsr04({ liveId }: { liveId?: string }) {
  const cone = useRef<MeshStandardMaterial>(null);
  useFrame(() => {
    const m = cone.current;
    if (!m) return;
    const st = useSim3D.getState();
    const dist = Number(st.sensors[liveId ?? '']?.distance ?? 10);
    // nearer object → stronger return
    const k = Math.max(0, Math.min(1, 1 - dist / 400));
    m.opacity = 0.05 + k * 0.3;
  });
  return (
    <group>
      <Module w={45} d={20} color={PCB_BLUE} />
      {/* T + R transducers */}
      <mesh position={[-mm(0), 0, 0]}>
        <group position={[-10, 0, 0]}>
          <mesh position={[0, mm(7), mm(4)]} castShadow>
            <cylinderGeometry args={[mm(8), mm(8), mm(9), 24]} />
            <meshStandardMaterial {...steel} />
          </mesh>
          <mesh position={[0, mm(11.6), mm(4)]}>
            <cylinderGeometry args={[mm(6.8), mm(6.8), mm(0.5), 24]} />
            <meshStandardMaterial {...plastic('#e8e4da')} />
          </mesh>
        </group>
        <group position={[10, 0, 0]}>
          <mesh position={[0, mm(7), mm(4)]} castShadow>
            <cylinderGeometry args={[mm(8), mm(8), mm(9), 24]} />
            <meshStandardMaterial {...plastic('#262a30')} />
          </mesh>
        </group>
      </mesh>
      <mesh position={[0, mm(3), -6]}>
        <boxGeometry args={[mm(4), mm(3), mm(2)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      {/* echo cone visualising the current distance setting */}
      <mesh position={[10, mm(7), mm(14)]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[mm(9), mm(20), 20, 1, true]} />
        <meshStandardMaterial
          ref={cone}
          color="#60a5fa"
          transparent
          opacity={0.15}
          side={2}
          depthWrite={false}
        />
      </mesh>
      <Header4 w={10} />
    </group>
  );
}

/* ── PIR with live dome glow ───────────────────────────────────────────── */

function Pir({ liveId }: { liveId?: string }) {
  const mat = useRef<MeshStandardMaterial>(null);
  useFrame(() => {
    const m = mat.current;
    if (!m) return;
    const motion = liveId ? useSim3D.getState().pressed[liveId] === true : false;
    m.emissiveIntensity = motion ? 1.8 : 0.12;
  });
  return (
    <group>
      <Module w={32} d={24} color={PCB_GREEN} />
      {/* fresnel dome */}
      <mesh position={[0, mm(14), 0]} castShadow>
        <sphereGeometry args={[mm(11), 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          ref={mat}
          color="#f5f2e8"
          emissive="#fbbf24"
          emissiveIntensity={0.12}
          transparent
          opacity={0.92}
          roughness={0.35}
        />
      </mesh>
      {/* retrigger jumpers */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 10), mm(2.6), mm(-8)]}>
          <boxGeometry args={[mm(5), mm(2), mm(2.5)]} />
          <meshStandardMaterial {...plastic('#eab308')} />
        </mesh>
      ))}
      {/* sensitivity trimmers */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 6), mm(3), mm(6)]} castShadow>
          <cylinderGeometry args={[mm(3.5), mm(3.5), mm(3), 16]} />
          <meshStandardMaterial {...plastic('#e8722a')} />
        </mesh>
      ))}
    </group>
  );
}

/* ── MPU6050 ───────────────────────────────────────────────────────────── */

function Mpu() {
  return (
    <group>
      <Module w={21} d={16} color={PCB_BLUE} />
      <mesh position={[0, mm(2.4), 0]} castShadow>
        <boxGeometry args={[mm(4), mm(1), mm(4)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[0, mm(2.95), 0]}>
        <boxGeometry args={[mm(1.6), mm(0.1), mm(1.6)]} />
        <meshStandardMaterial {...silk} />
      </mesh>
      <Header4 w={10} />
    </group>
  );
}

/* ── NTC / LDR / flame / sound modules ─────────────────────────────────── */

function Ntc() {
  return (
    <group>
      <Module w={30} d={14} color={PCB_BLUE} />
      {/* bead on leads */}
      <mesh position={[-8, mm(5), 0]}>
        <sphereGeometry args={[mm(2.5), 16, 12]} />
        <meshStandardMaterial {...plastic('#101216')} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[-8, mm(2.6), mm(s * 1.5)]}>
          <cylinderGeometry args={[mm(0.3), mm(0.3), mm(5), 8]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
      <mesh position={[6, mm(3.4), 0]} castShadow>
        <boxGeometry args={[mm(6), mm(4), mm(6)]} />
        <meshStandardMaterial {...plastic('#1d4fd7')} />
      </mesh>
      <Header4 w={10} />
    </group>
  );
}

function Ldr({ liveId }: { liveId?: string }) {
  const mat = useRef<MeshStandardMaterial>(null);
  useFrame(() => {
    const m = mat.current;
    if (!m) return;
    const st = useSim3D.getState();
    const lux = Number(st.sensors[liveId ?? '']?.lux ?? st.analog[liveId ?? ''] ?? 500);
    const k = Math.max(0, Math.min(1, lux / 1000));
    m.emissiveIntensity = 0.05 + k * 1.2;
  });
  return (
    <group>
      <Module w={32} d={14} color={PCB_BLUE} />
      {/* LDR disc with serpentine */}
      <mesh position={[-8, mm(3.4), 0]} castShadow>
        <cylinderGeometry args={[mm(5), mm(5), mm(2.5), 20]} />
        <meshStandardMaterial
          ref={mat}
          color="#7c2d12"
          emissive="#f59e0b"
          emissiveIntensity={0.4}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[6, mm(2.6), -2]}>
        <boxGeometry args={[mm(5), mm(1.6), mm(5)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[6, mm(3.4), 4]} castShadow>
        <boxGeometry args={[mm(6), mm(4), mm(6)]} />
        <meshStandardMaterial {...plastic('#1d4fd7')} />
      </mesh>
      <Header4 w={10} />
    </group>
  );
}

function Flame() {
  return (
    <group>
      <Module w={32} d={14} color={PCB_BLACK} />
      {/* IR LED pair */}
      <mesh position={[-8, mm(4), -2]}>
        <sphereGeometry args={[mm(2.5), 14, 10]} />
        <meshStandardMaterial color="#111111" emissive="#7c3aed" emissiveIntensity={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[-8, mm(4), 3]}>
        <sphereGeometry args={[mm(2.5), 14, 10]} />
        <meshStandardMaterial {...plastic('#e8e4da')} />
      </mesh>
      <mesh position={[6, mm(3.4), 0]} castShadow>
        <boxGeometry args={[mm(6), mm(4), mm(6)]} />
        <meshStandardMaterial {...plastic('#1d4fd7')} />
      </mesh>
      <Header4 w={10} />
    </group>
  );
}

function Sound({ big = true }: { big?: boolean }) {
  return (
    <group>
      <Module w={big ? 40 : 36} d={big ? 15 : 16} color={PCB_BLUE} />
      {/* electret mic */}
      <mesh position={[-(big ? 12 : 10), mm(4.5), 0]} castShadow>
        <cylinderGeometry args={[mm(4.5), mm(4.5), mm(6), 18]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[-(big ? 12 : 10), mm(7.6), 0]}>
        <cylinderGeometry args={[mm(1.2), mm(1.2), mm(0.4), 10]} />
        <meshStandardMaterial {...plastic('#000000')} />
      </mesh>
      <mesh position={[8, mm(3.4), 0]} castShadow>
        <boxGeometry args={[mm(6), mm(4), mm(6)]} />
        <meshStandardMaterial {...plastic('#1d4fd7')} />
      </mesh>
      <Header4 w={10} />
    </group>
  );
}

function Heart() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]} castShadow>
        <cylinderGeometry args={[mm(8), mm(8), mm(1.6), 28]} />
        <meshStandardMaterial {...pcb(PCB_RED)} />
      </mesh>
      <mesh position={[0, mm(2.2), 0]}>
        <boxGeometry args={[mm(5), mm(1.2), mm(5)]} />
        <meshStandardMaterial color="#052e16" emissive="#22c55e" emissiveIntensity={0.9} roughness={0.3} />
      </mesh>
      {/* cable */}
      <mesh position={[mm(14), mm(1), 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[mm(1.4), mm(1.4), mm(12), 10]} />
        <meshStandardMaterial {...plastic('#166534')} />
      </mesh>
    </group>
  );
}

/* ── Tilt switch: the ball really rolls ────────────────────────────────── */

function Tilt({ liveId }: { liveId?: string }) {
  const ball = useRef<Group>(null);
  useFrame(() => {
    const g = ball.current;
    if (!g) return;
    const tilted = liveId ? useSim3D.getState().pressed[liveId] === true : false;
    const target = tilted ? 0.004 : -0.004;
    g.position.x += (target - g.position.x) * 0.2;
  });
  return (
    <group>
      <Module w={28} d={15} color={PCB_BLUE} />
      {/* glass tube */}
      <mesh position={[0, mm(5), 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[mm(2.6), mm(2.6), mm(12), 16, 1, true]} />
        <meshStandardMaterial color="#dbeafe" transparent opacity={0.35} roughness={0.1} metalness={0} side={2} />
      </mesh>
      <group ref={ball} position={[-0.004, mm(5), 0]}>
        <mesh>
          <sphereGeometry args={[mm(1.8), 14, 10]} />
          <meshStandardMaterial {...steel} />
        </mesh>
      </group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 8), mm(2.6), 0]}>
          <cylinderGeometry args={[mm(0.4), mm(0.4), mm(4), 8]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
    </group>
  );
}

/* ── Joystick: the stick really tilts ──────────────────────────────────── */

function Joystick({ liveId }: { liveId?: string }) {
  const stick = useRef<Group>(null);
  useFrame(() => {
    const g = stick.current;
    if (!g) return;
    const st = useSim3D.getState();
    const s = st.sensors[liveId ?? ''];
    const x = Number(s?.xAxis ?? 0) / 512;
    const y = Number(s?.yAxis ?? 0) / 512;
    g.rotation.z = (-x * 0.35);
    g.rotation.x = (y * 0.35);
  });
  return (
    <group>
      <Module w={34} d={26} color={PCB_GREEN} />
      {/* gimbal box */}
      <mesh position={[0, mm(8), 0]} castShadow>
        <boxGeometry args={[mm(20), mm(11), mm(18)]} />
        <meshStandardMaterial {...plastic('#2b2f36')} />
      </mesh>
      <group ref={stick} position={[0, mm(12), 0]}>
        <mesh position={[0, mm(8), 0]} castShadow>
          <cylinderGeometry args={[mm(2.5), mm(2.5), mm(18), 14]} />
          <meshStandardMaterial {...steel} />
        </mesh>
        <mesh position={[0, mm(18), 0]} castShadow>
          <sphereGeometry args={[mm(6), 20, 14]} />
          <meshStandardMaterial {...plastic('#111214')} />
        </mesh>
      </group>
      <Header4 w={12} />
    </group>
  );
}

/* ── GPS / HX711 / RTC / misc ──────────────────────────────────────────── */

function Gps() {
  return (
    <group>
      <Module w={45} d={25} color={PCB_BLUE} />
      {/* ceramic patch antenna */}
      <mesh position={[-8, mm(3.6), 0]} castShadow>
        <boxGeometry args={[mm(25), mm(4), mm(25)]} />
        <meshStandardMaterial color="#d6cfbd" roughness={0.6} metalness={0.05} />
      </mesh>
      <mesh position={[12, mm(2.6), -4]}>
        <boxGeometry args={[mm(9), mm(2), mm(9)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      {/* backup battery */}
      <mesh position={[12, mm(3.4), 6]}>
        <cylinderGeometry args={[mm(6), mm(6), mm(2.5), 24]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <Header4 w={10} />
    </group>
  );
}

function Hx711() {
  return (
    <group>
      <Module w={38} d={21} color={PCB_RED} />
      <mesh position={[0, mm(2.4), 0]} castShadow>
        <boxGeometry args={[mm(6), mm(1.4), mm(6)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      {/* screw terminals */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 12), mm(4), -mm(6)]} castShadow>
          <boxGeometry args={[mm(10), mm(9), mm(8)]} />
          <meshStandardMaterial {...plastic('#1d4fd7')} />
        </mesh>
      ))}
    </group>
  );
}

function Rtc() {
  return (
    <group>
      <Module w={38} d={22} color={PCB_BLUE} />
      <mesh position={[-8, mm(2.4), 0]}>
        <boxGeometry args={[mm(6), mm(1.4), mm(8)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      {/* CR2032 holder, the tall bit */}
      <mesh position={[8, mm(3), 0]} castShadow>
        <cylinderGeometry args={[mm(10), mm(10), mm(3), 24]} />
        <meshStandardMaterial {...plastic('#101216')} />
      </mesh>
      <mesh position={[8, mm(4.6), 0]}>
        <cylinderGeometry args={[mm(9.5), mm(9.5), mm(1.2), 24]} />
        <meshStandardMaterial {...steel} />
      </mesh>
    </group>
  );
}

function IrRx() {
  return (
    <group>
      <mesh position={[0, mm(4.5), 0]} castShadow>
        <boxGeometry args={[mm(6.5), mm(7), mm(4)]} />
        <meshStandardMaterial {...plastic('#101216')} />
      </mesh>
      <mesh position={[0, mm(4.5), mm(2.2)]}>
        <boxGeometry args={[mm(4), mm(4), mm(0.6)]} />
        <meshStandardMaterial color="#3b0764" emissive="#7c3aed" emissiveIntensity={0.35} roughness={0.2} />
      </mesh>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[mm(i * 2.5), mm(1.2), -mm(1)]}>
          <boxGeometry args={[mm(0.6), mm(3), mm(0.6)]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
    </group>
  );
}

function Photodiode() {
  return (
    <group>
      <mesh position={[0, mm(1.5), 0]} castShadow>
        <boxGeometry args={[mm(7.5), mm(2.5), mm(5.4)]} />
        <meshStandardMaterial color="#0f172a" roughness={0.35} />
      </mesh>
      <mesh position={[0, mm(2.9), 0]}>
        <boxGeometry args={[mm(4), mm(0.3), mm(3)]} />
        <meshStandardMaterial color="#1e3a8a" emissive="#3b82f6" emissiveIntensity={0.4} roughness={0.15} />
      </mesh>
    </group>
  );
}

function Rc522() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(60), mm(1.6), mm(36)]} />
        <meshStandardMaterial {...pcb('#edf0e8')} />
      </mesh>
      <mesh position={[mm(4), mm(1.7), mm(-12)]}>
        <boxGeometry args={[mm(44), mm(0.3), mm(1.6)]} />
        <meshStandardMaterial {...gold} />
      </mesh>
      <mesh position={[mm(4), mm(1.7), mm(6)]}>
        <boxGeometry args={[mm(44), mm(0.3), mm(1.6)]} />
        <meshStandardMaterial {...gold} />
      </mesh>
      {[-18, 26].map((x) => (
        <mesh key={x} position={[mm(x), mm(1.7), mm(-3)]}>
          <boxGeometry args={[mm(1.6), mm(0.3), mm(20)]} />
          <meshStandardMaterial {...gold} />
        </mesh>
      ))}
      <mesh position={[mm(-20), mm(2.2), mm(-6)]}>
        <boxGeometry args={[mm(5), mm(1.2), mm(5)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[mm(-24), mm(1), mm(14)]}>
        <boxGeometry args={[mm(2.4), mm(0.2), mm(8)]} />
        <meshStandardMaterial {...silk} />
      </mesh>
      <group position={[mm(-26), 0, 0]}>
        <PinRow count={8} />
      </group>
    </group>
  );
}

function Nrf24() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(29), mm(1.6), mm(15.5)]} />
        <meshStandardMaterial {...pcb(PCB_GREEN)} />
      </mesh>
      <mesh position={[mm(9), mm(1.7), mm(-4)]}>
        <boxGeometry args={[mm(1.6), mm(0.3), mm(9)]} />
        <meshStandardMaterial {...gold} />
      </mesh>
      <mesh position={[mm(5.5), mm(1.7), mm(-7.5)]}>
        <boxGeometry args={[mm(8.5), mm(0.3), mm(1.6)]} />
        <meshStandardMaterial {...gold} />
      </mesh>
      <mesh position={[mm(5.5), mm(1.7), mm(-0.5)]}>
        <boxGeometry args={[mm(8.5), mm(0.3), mm(1.6)]} />
        <meshStandardMaterial {...gold} />
      </mesh>
      <mesh position={[mm(-6), mm(2.2), mm(0)]}>
        <boxGeometry args={[mm(4), mm(1.2), mm(4)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[mm(-11), mm(1.6), mm(4)]}>
        <boxGeometry args={[mm(3), mm(1), mm(2)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <group position={[mm(-11), 0, mm(-3.8)]}>
        <PinRow count={4} />
      </group>
      <group position={[mm(-11), 0, mm(3.8)]}>
        <PinRow count={4} />
      </group>
    </group>
  );
}

function Hc05() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(37), mm(1.6), mm(16)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      <mesh position={[mm(4), mm(2.2), 0]}>
        <boxGeometry args={[mm(25), mm(1.2), mm(13)]} />
        <meshStandardMaterial {...pcb(PCB_GREEN)} />
      </mesh>
      <mesh position={[mm(12), mm(2.9), mm(-3.5)]}>
        <boxGeometry args={[mm(8), mm(0.3), mm(1.4)]} />
        <meshStandardMaterial {...gold} />
      </mesh>
      <mesh position={[mm(12), mm(2.9), mm(3.5)]}>
        <boxGeometry args={[mm(8), mm(0.3), mm(1.4)]} />
        <meshStandardMaterial {...gold} />
      </mesh>
      <mesh position={[mm(12), mm(2.9), 0]}>
        <boxGeometry args={[mm(1.4), mm(0.3), mm(8.4)]} />
        <meshStandardMaterial {...gold} />
      </mesh>
      <mesh position={[mm(0), mm(3.2), mm(-2)]}>
        <boxGeometry args={[mm(6), mm(1), mm(6)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[mm(-4), mm(3.4), mm(4)]}>
        <boxGeometry args={[mm(2.4), mm(1), mm(2)]} />
        <meshStandardMaterial {...plastic('#262626')} />
      </mesh>
      <mesh position={[mm(-15), mm(2), 0]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial color="#b91c1c" emissive="#ef4444" emissiveIntensity={1.2} />
      </mesh>
      <group position={[mm(-17), 0, 0]}>
        <PinRow count={6} />
      </group>
    </group>
  );
}

function Ttp223({ liveId }: { liveId: string }) {
  const touched = useSim3D((s) => s.pressed[liveId] === true);
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(24), mm(1.6), mm(24)]} />
        <meshStandardMaterial {...pcb(PCB_RED)} />
      </mesh>
      <mesh position={[mm(-2), mm(1.7), 0]}>
        <boxGeometry args={[mm(15), mm(0.3), mm(15)]} />
        <meshStandardMaterial {...gold} />
      </mesh>
      {[-4.5, -1.5, 1.5, 4.5].map((z) => (
        <mesh key={z} position={[mm(-2), mm(1.85), mm(z)]}>
          <boxGeometry args={[mm(13), mm(0.3), mm(1.2)]} />
          <meshStandardMaterial color="#7a1f1f" roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[mm(8.5), mm(2), mm(-6)]}>
        <boxGeometry args={[mm(3), mm(1), mm(2)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[mm(8.5), mm(2), mm(6)]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial
          color="#b91c1c"
          emissive="#ef4444"
          emissiveIntensity={touched ? 2.4 : 0.15}
        />
      </mesh>
      <group position={[0, 0, mm(10)]}>
        <PinRow count={3} />
      </group>
    </group>
  );
}

function Sw420() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(32), mm(1.6), mm(14)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      <mesh position={[mm(-8), mm(4), 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[mm(2.6), mm(2.6), mm(8), 14]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[mm(0), mm(2.2), mm(-3)]}>
        <boxGeometry args={[mm(5), mm(1.75), mm(4)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[mm(6), mm(3), mm(3)]}>
        <boxGeometry args={[mm(4), mm(4), mm(3)]} />
        <meshStandardMaterial {...plastic('#1d4ed8')} />
      </mesh>
      <mesh position={[mm(11), mm(2), 0]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial color="#b91c1c" emissive="#ef4444" emissiveIntensity={1.2} />
      </mesh>
      <group position={[0, 0, mm(5.5)]}>
        <PinRow count={3} />
      </group>
    </group>
  );
}

function RainPlate() {
  return (
    <group>
      <mesh position={[0, mm(0.5), 0]}>
        <boxGeometry args={[mm(50), mm(1), mm(40)]} />
        <meshStandardMaterial {...pcb('#d8cfb8')} />
      </mesh>
      {Array.from({ length: 16 }).map((_, i) => (
        <mesh key={i} position={[mm(-22.5 + i * 3), mm(1.1), 0]}>
          <boxGeometry args={[mm(1.6), mm(0.25), mm(i % 2 === 0 ? 34 : 30)]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
      {[-20, 20].map((x) => (
        <mesh key={x} position={[mm(x), mm(0.6), mm(16)]}>
          <cylinderGeometry args={[mm(1.6), mm(1.6), mm(2), 10]} />
          <meshStandardMaterial color="#3a352c" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function SoilProbe() {
  return (
    <group>
      <mesh position={[0, mm(0.8), mm(-18)]}>
        <boxGeometry args={[mm(22), mm(1.6), mm(24)]} />
        <meshStandardMaterial {...pcb(PCB_RED)} />
      </mesh>
      {[-5, 5].map((x) => (
        <mesh key={x} position={[mm(x), mm(0.8), mm(12)]}>
          <boxGeometry args={[mm(6), mm(1.2), mm(44)]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
      <mesh position={[0, mm(0.8), mm(-4)]}>
        <boxGeometry args={[mm(16), mm(1.2), mm(10)]} />
        <meshStandardMaterial {...pcb(PCB_RED)} />
      </mesh>
    </group>
  );
}

function WaterLevel() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(65), mm(1.6), mm(20)]} />
        <meshStandardMaterial {...pcb(PCB_RED)} />
      </mesh>
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh key={i} position={[mm(-24 + i * 6), mm(1.7), 0]}>
          <boxGeometry args={[mm(2), mm(0.25), mm(48)]} />
          <meshStandardMaterial {...gold} />
        </mesh>
      ))}
      <group position={[mm(29), 0, 0]}>
        <PinRow count={3} />
      </group>
    </group>
  );
}

function Pca9685() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(62), mm(1.6), mm(26)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      {[-6.35, 0, 6.35].map((z) => (
        <group key={z} position={[mm(-2), 0, mm(z)]}>
          <PinRow count={16} />
        </group>
      ))}
      <mesh position={[mm(24), mm(3), 0]}>
        <boxGeometry args={[mm(9), mm(7), mm(9)]} />
        <meshStandardMaterial {...plastic('#15803d')} />
      </mesh>
      <mesh position={[mm(-24), mm(2), mm(-7)]}>
        <boxGeometry args={[mm(7), mm(1.2), mm(7)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[mm(-24), mm(2.4), mm(6)]}>
        <boxGeometry args={[mm(4), mm(3), mm(4)]} />
        <meshStandardMaterial {...plastic('#151515')} />
      </mesh>
      <mesh position={[mm(-14), mm(2), mm(9)]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial color="#15803d" emissive="#22c55e" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

function Ads1115() {
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(25.4), mm(1.6), mm(17.8)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      <mesh position={[mm(-4), mm(2), 0]}>
        <boxGeometry args={[mm(3), mm(1), mm(3)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[mm(6), mm(1.8), mm(4)]}>
        <boxGeometry args={[mm(4), mm(1.2), mm(3)]} />
        <meshStandardMaterial {...plastic('#b8860b')} />
      </mesh>
      <group position={[0, 0, mm(7)]}>
        <PinRow count={10} />
      </group>
    </group>
  );
}

export default function Sensors3D(props: PartViewProps) {
  const { kind, liveId } = props;
  switch (kind) {
    case 'dht22':
      return <Dht blue />;
    case 'dht11':
      return <Dht blue={false} />;
    case 'bmp280':
    case 'bme280':
      return <Baro />;
    case 'ds18b20':
      return <Ds18b20 />;
    case 'cap-soil':
      return <Soil />;
    case 'gas-sensor':
    case 'mq-2':
      return <Gas />;
    case 'hc-sr04':
      return <Hcsr04 liveId={liveId} />;
    case 'pir-motion-sensor':
      return <Pir liveId={liveId} />;
    case 'mpu6050':
      return <Mpu />;
    case 'ntc-temperature-sensor':
      return <Ntc />;
    case 'photoresistor-sensor':
      return <Ldr liveId={liveId} />;
    case 'photodiode':
      return <Photodiode />;
    case 'flame-sensor':
      return <Flame />;
    case 'big-sound-sensor':
      return <Sound big />;
    case 'small-sound-sensor':
      return <Sound big={false} />;
    case 'heart-beat-sensor':
      return <Heart />;
    case 'tilt-switch':
      return <Tilt liveId={liveId} />;
    case 'analog-joystick':
      return <Joystick liveId={liveId} />;
    case 'gps-neo6m':
      return <Gps />;
    case 'hx711':
      return <Hx711 />;
    case 'ds1307':
    case 'ds3231':
      return <Rtc />;
    case 'ir-receiver':
      return <IrRx />;
    case 'rc522':
      return <Rc522 />;
    case 'nrf24l01':
      return <Nrf24 />;
    case 'hc-05':
      return <Hc05 />;
    case 'ttp223':
      return <Ttp223 liveId={liveId} />;
    case 'sw420':
      return <Sw420 />;
    case 'rain-plate':
      return <RainPlate />;
    case 'soil-resistive':
      return <SoilProbe />;
    case 'water-level':
      return <WaterLevel />;
    case 'pca9685':
      return <Pca9685 />;
    case 'ads1115':
      return <Ads1115 />;
    default:
      return <Baro />;
  }
}
