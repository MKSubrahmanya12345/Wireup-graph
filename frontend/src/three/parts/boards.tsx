/**
 * parts/boards.tsx — true-scale microcontroller boards.
 *
 * Every board: soldermask PCB at its real outline, USB connector, main
 * silicon, crystal, header rows at 2.54 mm pitch, reset button, power LED
 * and — the honest touch — the D13/activity LED follows the avr8js
 * heartbeat, exactly like the real board LED follows firmware.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group, MeshStandardMaterial } from 'three';
import { GlowDome, PinRow, mm } from './common';
import type { PartViewProps } from './common';
import { PCB_BLACK, PCB_BLUE, PCB_GREEN, chip, gold, pcb, plastic, silk, steel } from '../materials';
import { useSim3D } from '../simStore';

function PcbSlab({ w, d, color, t = 1.6 }: { w: number; d: number; color: string; t?: number }) {
  return (
    <mesh position={[0, mm(t / 2), 0]} castShadow receiveShadow>
      <boxGeometry args={[mm(w), mm(t), mm(d)]} />
      <meshStandardMaterial {...pcb(color)} />
    </mesh>
  );
}

function SilkLine({ w, x = 0, z = 0, d = 0.4 }: { w: number; x?: number; z?: number; d?: number }) {
  return (
    <mesh position={[mm(x), mm(1.75), mm(z)]}>
      <boxGeometry args={[mm(w), mm(0.12), mm(d)]} />
      <meshStandardMaterial {...silk} />
    </mesh>
  );
}

function UsbB() {
  return (
    <group position={[-24, 0, 0]}>
      <mesh position={[0, mm(8), 0]} castShadow>
        <boxGeometry args={[mm(12), mm(11), mm(14)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[0, mm(6), 0]}>
        <boxGeometry args={[mm(10), mm(6), mm(12)]} />
        <meshStandardMaterial {...plastic('#0c0d10')} />
      </mesh>
    </group>
  );
}

function UsbC() {
  return (
    <mesh position={[0, mm(2.6), 0]} castShadow>
      <boxGeometry args={[mm(8.9), mm(3.2), mm(7.5)]} />
      <meshStandardMaterial {...steel} />
    </mesh>
  );
}

function MicroUsb() {
  return (
    <mesh position={[0, mm(2.4), 0]} castShadow>
      <boxGeometry args={[mm(7.5), mm(2.8), mm(6)]} />
      <meshStandardMaterial {...steel} />
    </mesh>
  );
}

function BarrelJack() {
  return (
    <group position={[-28, 0, 18]}>
      <mesh position={[0, mm(5.5), 0]} castShadow>
        <boxGeometry args={[mm(9), mm(11), mm(14)]} />
        <meshStandardMaterial {...plastic('#111214')} />
      </mesh>
      <mesh position={[0, mm(5.5), mm(7.2)]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[mm(3.2), mm(3.2), mm(1.5), 20]} />
        <meshStandardMaterial {...plastic('#000000')} />
      </mesh>
    </group>
  );
}

function Crystal() {
  return (
    <mesh position={[6, mm(2.6), 0]} castShadow>
      <boxGeometry args={[mm(11), mm(3.5), mm(4.6)]} />
      <meshStandardMaterial {...steel} />
    </mesh>
  );
}

function ResetBtn() {
  return (
    <group position={[20, 0, 8]}>
      <mesh position={[0, mm(2.4), 0]}>
        <boxGeometry args={[mm(6), mm(2.5), mm(6)]} />
        <meshStandardMaterial {...plastic('#c8ccd2')} />
      </mesh>
      <mesh position={[0, mm(4.2), 0]}>
        <cylinderGeometry args={[mm(1.8), mm(1.8), mm(1.6), 14]} />
        <meshStandardMaterial {...plastic('#2a2e34')} />
      </mesh>
    </group>
  );
}

function HeaderStrip({ len, x, z }: { len: number; x: number; z: number }) {
  return (
    <group position={[mm(x), 0, mm(z)]}>
      <mesh position={[0, mm(3.4), 0]} castShadow>
        <boxGeometry args={[mm(len * 2.54 + 2.5), mm(2.5), mm(2.5)]} />
        <meshStandardMaterial {...plastic('#101216')} />
      </mesh>
      <group position={[0, mm(1.1), 0]}>
        <PinRow count={len} y={0} len={0.006} />
      </group>
      <group position={[0, mm(5.8), 0]}>
        <PinRow count={len} y={0} len={0.005} />
      </group>
    </group>
  );
}

/** Power LED (always on) + activity LED (heartbeat). */
function BoardLeds({ activity = true }: { activity?: boolean }) {
  return (
    <group>
      <group position={[-8, mm(1.6), 10]}>
        <mesh position={[0, mm(0.5), 0]}>
          <boxGeometry args={[mm(3.2), mm(1), mm(1.6)]} />
          <meshStandardMaterial color="#14532d" emissive="#22c55e" emissiveIntensity={1.4} roughness={0.4} />
        </mesh>
      </group>
      {activity ? (
        <group position={[-3, mm(1.6), 10]}>
          <mesh position={[0, mm(0.5), 0]}>
            <boxGeometry args={[mm(3.2), mm(1), mm(1.6)]} />
            <HeartbeatChip />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}

function HeartbeatChip() {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const on = useSim3D.getState().heartbeat.ledOn;
    g.scale.setScalar(on ? 1.25 : 1);
  });
  return (
    <group ref={ref}>
      <mesh>
        <boxGeometry args={[mm(3.2), mm(1), mm(1.6)]} />
        <HeartbeatMat />
      </mesh>
    </group>
  );
}

function HeartbeatMat() {
  const ref = useRef<MeshStandardMaterial>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    m.emissiveIntensity = useSim3D.getState().heartbeat.ledOn ? 2.2 : 0.15;
  });
  return (
    <meshStandardMaterial
      ref={ref}
      color="#7f1d1d"
      emissive="#ef4444"
      emissiveIntensity={0.15}
      roughness={0.4}
    />
  );
}

function Qfp({ size = 7, pins = 8 }: { size?: number; pins?: number }) {
  return (
    <group>
      <mesh position={[0, mm(2.6), 0]} castShadow>
        <boxGeometry args={[mm(size), mm(1.4), mm(size)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[0, mm(3.35), 0]}>
        <boxGeometry args={[mm(size * 0.5), mm(0.1), mm(size * 0.5)]} />
        <meshStandardMaterial {...silk} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[mm((s * size) / 2), 0, 0]}>
          <PinRow count={pins} pitch={0.0008} y={mm(2)} len={0.001} r={0.00012} />
        </group>
      ))}
    </group>
  );
}

function Dip28() {
  return (
    <group>
      <mesh position={[0, mm(3.4), 0]} castShadow>
        <boxGeometry args={[mm(35), mm(4.5), mm(7.6)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[-mm(14), mm(5.7), 0]}>
        <cylinderGeometry args={[mm(1.5), mm(1.5), mm(0.3), 16]} />
        <meshStandardMaterial {...silk} />
      </mesh>
    </group>
  );
}

function WroomModule() {
  return (
    <group position={[0, 0, -2]}>
      <mesh position={[0, mm(2.6), 0]} castShadow>
        <boxGeometry args={[mm(18), mm(2), mm(25.5)]} />
        <meshStandardMaterial {...plastic('#1c1f24')} />
      </mesh>
      <mesh position={[0, mm(4.4), -mm(6)]}>
        <boxGeometry args={[mm(17), mm(2.8), mm(12)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[0, mm(3.66), -mm(6)]}>
        <boxGeometry args={[mm(17.4), mm(0.1), mm(12.4)]} />
        <meshStandardMaterial {...gold} />
      </mesh>
    </group>
  );
}

function PicoShield() {
  return (
    <mesh position={[8, mm(3.4), 0]} castShadow>
      <boxGeometry args={[mm(12), mm(3), mm(12)]} />
      <meshStandardMaterial {...steel} />
    </mesh>
  );
}

/* ── Boards ────────────────────────────────────────────────────────────── */

function ArduinoUno({ usb = 'b' }: { usb?: 'b' | 'micro' }) {
  return (
    <group>
      <PcbSlab w={68.6} d={53.4} color={PCB_BLUE} />
      <SilkLine w={60} z={-24} />
      <SilkLine w={60} z={24} />
      {usb === 'b' ? (
        <UsbB />
      ) : (
        <group position={[-24, 0, 0]}>
          <MicroUsb />
        </group>
      )}
      <BarrelJack />
      <group position={[8, 0, -6]}>
        <Dip28 />
      </group>
      <group position={[8, 0, 16]}>
        <Qfp size={7} pins={8} />
      </group>
      <Crystal />
      <HeaderStrip len={8} x={-8} z={-22} />
      <HeaderStrip len={10} x={16} z={-22} />
      <HeaderStrip len={8} x={-8} z={22} />
      <HeaderStrip len={10} x={16} z={22} />
      <ResetBtn />
      <BoardLeds />
      <GlowDome id="uno-d13" color="#eab308" heartbeat r={0.0016} y={0.003} />
    </group>
  );
}

function ArduinoNano() {
  return (
    <group>
      <PcbSlab w={45} d={18} color={PCB_BLUE} />
      <group position={[-16, 0, 0]}>
        <MicroUsb />
      </group>
      <group position={[4, 0, 0]}>
        <Qfp size={7} pins={8} />
      </group>
      <HeaderStrip len={15} x={4} z={-7.5} />
      <HeaderStrip len={15} x={4} z={7.5} />
      <Crystal />
      <BoardLeds />
    </group>
  );
}

function ArduinoMega() {
  return (
    <group>
      <PcbSlab w={101.6} d={53.4} color={PCB_BLUE} />
      <SilkLine w={92} z={-24} />
      <SilkLine w={92} z={24} />
      <UsbB />
      <BarrelJack />
      <group position={[18, 0, 0]}>
        <Qfp size={16} pins={16} />
      </group>
      <Crystal />
      <HeaderStrip len={8} x={-20} z={-22} />
      <HeaderStrip len={10} x={4} z={-22} />
      <HeaderStrip len={8} x={28} z={-22} />
      <HeaderStrip len={8} x={-20} z={22} />
      <HeaderStrip len={10} x={4} z={22} />
      <HeaderStrip len={18} x={34} z={14} />
      <ResetBtn />
      <BoardLeds />
    </group>
  );
}

function Esp32Devkit() {
  return (
    <group>
      <PcbSlab w={52} d={28} color={PCB_BLACK} />
      <group position={[-20, 0, 0]}>
        <MicroUsb />
      </group>
      <WroomModule />
      <HeaderStrip len={15} x={-2} z={-12.5} />
      <HeaderStrip len={15} x={-2} z={12.5} />
      <group position={[18, 0, -8]}>
        <ResetBtn />
      </group>
      {/* BOOT + EN */}
      <group position={[18, 0, 4]}>
        <mesh position={[0, mm(2.4), 0]}>
          <boxGeometry args={[mm(4), mm(2), mm(4)]} />
          <meshStandardMaterial {...plastic('#c8ccd2')} />
        </mesh>
      </group>
      <group position={[-12, mm(1.6), 8]}>
        <mesh position={[0, mm(0.5), 0]}>
          <boxGeometry args={[mm(3.2), mm(1), mm(1.6)]} />
          <meshStandardMaterial color="#7f1d1d" emissive="#ef4444" emissiveIntensity={1.6} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

function Esp32S3() {
  return (
    <group>
      <PcbSlab w={48} d={25.5} color={PCB_BLACK} t={1.2} />
      <group position={[-19, 0, 0]}>
        <UsbC />
      </group>
      <WroomModule />
      <HeaderStrip len={14} x={-2} z={-11} />
      <HeaderStrip len={14} x={-2} z={11} />
      <group position={[-12, mm(1.6), 8]}>
        <mesh position={[0, mm(0.5), 0]}>
          <boxGeometry args={[mm(2), mm(0.8), mm(1.2)]} />
          <meshStandardMaterial color="#14532d" emissive="#22cc55" emissiveIntensity={1.6} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

function TinyBoard({ w = 22.5, d = 18, usb = true }: { w?: number; d?: number; usb?: boolean }) {
  return (
    <group>
      <PcbSlab w={w} d={d} color={PCB_BLUE} t={1} />
      {usb ? (
        <group position={[-w / 2 + 4, 0, 0]}>
          <UsbC />
        </group>
      ) : null}
      <group position={[2, 0, 0]}>
        <Qfp size={5} pins={6} />
      </group>
      <mesh position={[w / 2 - 4, mm(2.4), 0]} castShadow>
        <boxGeometry args={[mm(7), mm(2.8), mm(7)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
    </group>
  );
}

function Esp32Cam() {
  return (
    <group>
      <PcbSlab w={40.5} d={27} color={PCB_BLACK} />
      {/* camera cube + lens */}
      <mesh position={[8, mm(4), -4]} castShadow>
        <boxGeometry args={[mm(8), mm(6), mm(8)]} />
        <meshStandardMaterial {...plastic('#0c0d10')} />
      </mesh>
      <mesh position={[8, mm(7.6), -4]}>
        <cylinderGeometry args={[mm(3.2), mm(4), mm(1.6), 20]} />
        <meshStandardMaterial color="#0a0c12" roughness={0.15} metalness={0.4} />
      </mesh>
      <mesh position={[8, mm(8.4), -4]}>
        <cylinderGeometry args={[mm(2), mm(2), mm(0.4), 20]} />
        <meshStandardMaterial color="#1e3a8a" emissive="#3b82f6" emissiveIntensity={0.5} roughness={0.1} />
      </mesh>
      {/* flash LED */}
      <mesh position={[-8, mm(2.4), 8]}>
        <boxGeometry args={[mm(3.5), mm(1.2), mm(3.5)]} />
        <meshStandardMaterial color="#fefce8" emissive="#fef9c3" emissiveIntensity={0.8} roughness={0.3} />
      </mesh>
      <WroomModule />
    </group>
  );
}

function PiPico() {
  return (
    <group>
      <PcbSlab w={51} d={21} color={PCB_GREEN} />
      <group position={[-21, 0, 0]}>
        <MicroUsb />
      </group>
      <group position={[-6, 0, 0]}>
        <Qfp size={7} pins={8} />
      </group>
      <PicoShield />
      <HeaderStrip len={20} x={0} z={-9} />
      <HeaderStrip len={20} x={0} z={9} />
      {/* BOOTSEL */}
      <mesh position={[-14, mm(2.2), 5]}>
        <boxGeometry args={[mm(3), mm(1.4), mm(2)]} />
        <meshStandardMaterial {...plastic('#e8e4da')} />
      </mesh>
      <group position={[16, mm(1.6), 0]}>
        <mesh position={[0, mm(0.5), 0]}>
          <boxGeometry args={[mm(3.2), mm(1), mm(1.6)]} />
          <HeartbeatChip />
        </mesh>
      </group>
    </group>
  );
}

function Stm32Pill({ black = false }: { black?: boolean }) {
  return (
    <group>
      <PcbSlab w={53} d={black ? 24 : 22.3} color={black ? PCB_BLACK : PCB_BLUE} />
      <group position={[-22, 0, 0]}>
        <MicroUsb />
      </group>
      <group position={[0, 0, 0]}>
        <Qfp size={7} pins={12} />
      </group>
      <Crystal />
      <HeaderStrip len={20} x={0} z={-9.5} />
      <HeaderStrip len={20} x={0} z={9.5} />
      {/* BOOT0/BOOT1 jumpers */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(14), mm(2.6), mm(s * 4)]}>
          <boxGeometry args={[mm(5), mm(2), mm(2.5)]} />
          <meshStandardMaterial {...plastic('#eab308')} />
        </mesh>
      ))}
      <BoardLeds />
    </group>
  );
}

function Attiny85() {
  return (
    <group>
      <mesh position={[0, mm(2.2), 0]} castShadow>
        <boxGeometry args={[mm(9.3), mm(3.6), mm(6.4)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[-mm(3), mm(4.1), 0]}>
        <cylinderGeometry args={[mm(0.8), mm(0.8), mm(0.2), 12]} />
        <meshStandardMaterial {...silk} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0, mm(s * 3.8)]}>
          <PinRow count={4} pitch={0.00254} y={mm(1)} len={0.002} r={0.00025} />
        </group>
      ))}
    </group>
  );
}

function WemosD1Mini() {
  return (
    <group>
      <PcbSlab w={34.2} d={25.6} color={PCB_BLUE} />
      <group position={[-13, 0, 0]}>
        <MicroUsb />
      </group>
      <mesh position={[mm(6), mm(2.1), 0]}>
        <boxGeometry args={[mm(16), mm(2.5), mm(22)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[mm(6), mm(3.5), 0]}>
        <boxGeometry args={[mm(11), mm(0.6), mm(15)]} />
        <meshStandardMaterial {...silk} />
      </mesh>
      <HeaderStrip len={8} x={0} z={-11} />
      <HeaderStrip len={8} x={0} z={11} />
      <mesh position={[mm(-6), mm(1.4), mm(8)]}>
        <boxGeometry args={[mm(3), mm(2), mm(4)]} />
        <meshStandardMaterial {...plastic('#222')} />
      </mesh>
      <mesh position={[mm(-6), mm(1.4), mm(-8)]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial color="#1d4ed8" emissive="#3b82f6" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

function WemosD1R32() {
  return (
    <group>
      <PcbSlab w={68.6} d={53.4} color={PCB_BLACK} />
      <SilkLine w={60} z={-24} />
      <SilkLine w={60} z={24} />
      <group position={[-24, 0, 0]}>
        <MicroUsb />
      </group>
      <group position={[10, 0, -4]}>
        <WroomModule />
      </group>
      <HeaderStrip len={8} x={-8} z={-22} />
      <HeaderStrip len={10} x={16} z={-22} />
      <HeaderStrip len={8} x={-8} z={22} />
      <HeaderStrip len={10} x={16} z={22} />
      <mesh position={[mm(-14), mm(1.4), mm(14)]}>
        <boxGeometry args={[mm(3), mm(2), mm(4)]} />
        <meshStandardMaterial {...plastic('#222')} />
      </mesh>
      <mesh position={[mm(-14), mm(1.4), mm(6)]}>
        <boxGeometry args={[mm(3), mm(2), mm(4)]} />
        <meshStandardMaterial {...plastic('#222')} />
      </mesh>
      <mesh position={[mm(-2), mm(1.2), mm(20)]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial color="#b91c1c" emissive="#ef4444" emissiveIntensity={1.4} />
      </mesh>
      <mesh position={[mm(2), mm(1.2), mm(20)]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial color="#1d4ed8" emissive="#3b82f6" emissiveIntensity={1.4} />
      </mesh>
    </group>
  );
}

function ProMicro() {
  return (
    <group>
      <PcbSlab w={33} d={18} color={PCB_BLUE} t={1} />
      <group position={[-12.5, 0, 0]}>
        <MicroUsb />
      </group>
      <group position={[4, 0, 0]}>
        <Qfp size={7} pins={8} />
      </group>
      <mesh position={[mm(-3), mm(1.2), 0]}>
        <boxGeometry args={[mm(3.2), mm(1), mm(2.5)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <HeaderStrip len={12} x={0} z={-7.5} />
      <HeaderStrip len={12} x={0} z={7.5} />
    </group>
  );
}

function MountingHole({ x, z }: { x: number; z: number }) {
  return (
    <mesh position={[mm(x), mm(0.8), mm(z)]}>
      <cylinderGeometry args={[mm(1.4), mm(1.4), mm(2.4), 12]} />
      <meshStandardMaterial color="#0a0a0a" roughness={0.9} />
    </mesh>
  );
}

function Rpi4() {
  return (
    <group>
      <PcbSlab w={85} d={56} color={PCB_GREEN} t={1.4} />
      <MountingHole x={-38.5} z={-24.5} />
      <MountingHole x={38.5} z={-24.5} />
      <MountingHole x={-38.5} z={24.5} />
      <MountingHole x={38.5} z={24.5} />
      <group position={[-34, 0, -20]}>
        <UsbC />
      </group>
      {[-22, -12].map((x) => (
        <mesh key={x} position={[mm(x), mm(2.5), mm(-25)]}>
          <boxGeometry args={[mm(7.5), mm(3.2), mm(6)]} />
          <meshStandardMaterial {...steel} />
        </mesh>
      ))}
      <mesh position={[mm(-2), mm(2.5), mm(-25)]}>
        <cylinderGeometry args={[mm(3), mm(3), mm(5), 14]} />
        <meshStandardMaterial {...plastic('#1a1a1a')} />
      </mesh>
      <mesh position={[mm(30), mm(8), mm(-16)]}>
        <boxGeometry args={[mm(16), mm(15.5), mm(13.5)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[mm(30), mm(8), mm(0)]}>
        <boxGeometry args={[mm(16), mm(15.5), mm(13.5)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[mm(30), mm(4), mm(0)]}>
        <boxGeometry args={[mm(14), mm(2), mm(11)]} />
        <meshStandardMaterial color="#1d4ed8" roughness={0.6} />
      </mesh>
      <mesh position={[mm(30), mm(6.8), mm(17)]}>
        <boxGeometry args={[mm(16), mm(13.5), mm(21)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <HeaderStrip len={20} x={0} z={24} />
      <mesh position={[mm(-6), mm(2.5), mm(4)]}>
        <boxGeometry args={[mm(14), mm(1.2), mm(14)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[mm(-6), mm(2), mm(18)]}>
        <boxGeometry args={[mm(10), mm(1), mm(7)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[mm(12), mm(1.8), mm(14)]}>
        <boxGeometry args={[mm(8), mm(1.6), mm(6)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[mm(-28), mm(1.2), mm(18)]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial color="#b91c1c" emissive="#ef4444" emissiveIntensity={1.4} />
      </mesh>
      <mesh position={[mm(-24), mm(1.2), mm(18)]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial color="#15803d" emissive="#22c55e" emissiveIntensity={1.4} />
      </mesh>
    </group>
  );
}

function PiZero() {
  return (
    <group>
      <PcbSlab w={65} d={30} color={PCB_GREEN} t={1} />
      <MountingHole x={-29} z={-11.5} />
      <MountingHole x={29} z={-11.5} />
      <MountingHole x={-29} z={11.5} />
      <MountingHole x={29} z={11.5} />
      <mesh position={[mm(-24), mm(2), mm(-12)]}>
        <boxGeometry args={[mm(7.5), mm(2.8), mm(6)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      {[-14, -4].map((x) => (
        <group key={x} position={[x, 0, -11]}>
          <MicroUsb />
        </group>
      ))}
      <mesh position={[mm(10), mm(2), mm(-11)]}>
        <boxGeometry args={[mm(17), mm(2.5), mm(4)]} />
        <meshStandardMaterial {...plastic('#d8cfae')} />
      </mesh>
      <mesh position={[mm(-2), mm(2), mm(4)]}>
        <boxGeometry args={[mm(12), mm(1.2), mm(12)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[mm(14), mm(1.6), mm(4)]}>
        <boxGeometry args={[mm(8), mm(1), mm(6)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <SilkLine w={50} z={11} />
      <mesh position={[mm(-22), mm(1.1), mm(8)]}>
        <boxGeometry args={[mm(1.6), mm(0.8), mm(0.8)]} />
        <meshStandardMaterial color="#15803d" emissive="#22c55e" emissiveIntensity={1.4} />
      </mesh>
    </group>
  );
}

function MicroBit() {
  return (
    <group>
      <PcbSlab w={52} d={42} color={PCB_BLACK} t={1.6} />
      {Array.from({ length: 10 }).map((_, i) => (
        <mesh key={i} position={[mm(-20 + i * 4.4), mm(1), mm(19.5)]}>
          <boxGeometry args={[mm(3.4), mm(0.4), mm(3)]} />
          <meshStandardMaterial {...gold} />
        </mesh>
      ))}
      {Array.from({ length: 25 }).map((_, i) => (
        <mesh key={i} position={[mm(-12 + (i % 5) * 6), mm(1.1), mm(-12 + Math.floor(i / 5) * 6)]}>
          <boxGeometry args={[mm(2.6), mm(0.5), mm(2.6)]} />
          <meshStandardMaterial color="#7f1d1d" emissive="#ef4444" emissiveIntensity={0.55} />
        </mesh>
      ))}
      {[-16, 16].map((x) => (
        <mesh key={x} position={[mm(x), mm(1.6), mm(-14)]}>
          <cylinderGeometry args={[mm(2.4), mm(2.8), mm(2.4), 12]} />
          <meshStandardMaterial {...plastic('#262626')} />
        </mesh>
      ))}
      <group position={[0, 0, 2]}>
        <Qfp size={6} pins={6} />
      </group>
      <mesh position={[mm(10), mm(1.2), mm(8)]}>
        <boxGeometry args={[mm(3), mm(1), mm(3)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <group position={[0, 0, -19]}>
        <MicroUsb />
      </group>
      <mesh position={[mm(-22), mm(1.6), mm(2)]}>
        <boxGeometry args={[mm(6), mm(3), mm(4)]} />
        <meshStandardMaterial {...plastic('#f5f5f5')} />
      </mesh>
    </group>
  );
}

export default function Boards3D(props: PartViewProps) {
  const k = props.kind;
  if (k === 'arduino-uno') return <ArduinoUno />;
  if (k === 'arduino-leonardo') return <ArduinoUno usb="micro" />;
  if (k === 'wemos-d1-mini') return <WemosD1Mini />;
  if (k === 'wemos-d1-r32') return <WemosD1R32 />;
  if (k === 'pro-micro') return <ProMicro />;
  if (k === 'rpi-4b') return <Rpi4 />;
  if (k === 'pi-zero') return <PiZero />;
  if (k === 'microbit') return <MicroBit />;
  if (k === 'arduino-nano' || k === 'nano-rp2040-connect') return <ArduinoNano />;
  if (k === 'arduino-mega') return <ArduinoMega />;
  if (k === 'esp32-devkit-v1' || k === 'esp32-c3' || k === 'franzininho') return <Esp32Devkit />;
  if (k === 'esp32-s3') return <Esp32S3 />;
  if (k === 'esp32c3-supermini' || k === 'xiao-esp32-c3' || k === 'xiao-esp32-s3') {
    return <TinyBoard w={k.startsWith('xiao') ? 21 : 22.5} d={k.startsWith('xiao') ? 17.5 : 18} />;
  }
  if (k === 'esp32-cam') return <Esp32Cam />;
  if (k === 'pi-pico' || k === 'pi-pico-w') return <PiPico />;
  if (k === 'stm32-blackpill') return <Stm32Pill black />;
  if (k === 'stm32-bluepill') return <Stm32Pill />;
  if (k === 'attiny85') return <Attiny85 />;
  return <Esp32Devkit />;
}
