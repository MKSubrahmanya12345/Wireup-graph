/**
 * parts/displays.tsx — screens that show what the firmware would show.
 *
 * SSD1306 renders its 128×64 framebuffer from live text lines onto real
 * glass (canvas texture, emissive). LCDs do the same with HD44780 5×8
 * glyphs on a backlit panel. The 7-seg decodes its digit through a real
 * segment map. NeoPixels share one material fed by the colour controls.
 */

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import { mm, useTextScreen } from './common';
import type { PartViewProps } from './common';
import { OLED_GLASS, PCB_BLACK, PCB_BLUE, PCB_GREEN, PCB_RED, chip, pcb, plastic } from '../materials';
import { useSim3D } from '../simStore';

/* ── SSD1306 OLED ──────────────────────────────────────────────────────── */

function Ssd1306({ liveId }: { liveId?: string }) {
  const lines = useSim3D((s) => (liveId ? s.lcdText[liveId] : undefined));
  const { texture, draw } = useTextScreen(128, 64, '#000000', '#7df9ff');
  useEffect(() => {
    draw(lines && lines.length ? lines : ['Hello!', 'I2C 0x3C OK']);
  }, [draw, lines]);
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]} castShadow receiveShadow>
        <boxGeometry args={[mm(27), mm(1.6), mm(27)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      {/* glass */}
      <mesh position={[0, mm(2.2), 0]}>
        <boxGeometry args={[mm(24), mm(1.2), mm(24)]} />
        <meshStandardMaterial color={OLED_GLASS} roughness={0.12} metalness={0.3} />
      </mesh>
      <mesh position={[0, mm(2.85), 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[mm(22), mm(10)]} />
        <meshStandardMaterial
          map={texture}
          emissive="#9ff3ff"
          emissiveMap={texture}
          emissiveIntensity={1.6}
          color="#000000"
          roughness={0.2}
        />
      </mesh>
      {/* 4-pin header */}
      <mesh position={[0, mm(2), mm(-11.5)]}>
        <boxGeometry args={[mm(12), mm(2.5), mm(2.5)]} />
        <meshStandardMaterial {...plastic('#101216')} />
      </mesh>
    </group>
  );
}

/* ── Character LCD ─────────────────────────────────────────────────────── */

function Lcd({ liveId, cols = 16, rows = 2, blue = true }: { liveId?: string; cols?: number; rows?: number; blue?: boolean }) {
  const w = cols === 20 ? 98 : 80;
  const d = rows === 4 ? 60 : 36;
  const stored = useSim3D((s) => (liveId ? s.lcdText[liveId] : undefined));
  const backlight = useSim3D((s) => (liveId ? (s.sensors[liveId]?.backlight as boolean | undefined) : undefined));
  const { texture, draw } = useTextScreen(cols * 12, rows * 18, blue ? '#1a5fb4' : '#9db33c', '#0b1020');
  const lines = useMemo(() => {
    if (stored && stored.length) return stored;
    return cols === 20
      ? ['Row 1', 'Row 2', 'Row 3', 'Row 4']
      : ['Hello World!', 'I2C 16x2 OK'];
  }, [stored, cols]);
  useEffect(() => {
    draw(lines);
  }, [draw, lines]);
  const lit = backlight !== false;
  return (
    <group>
      <mesh position={[0, mm(1), 0]} castShadow receiveShadow>
        <boxGeometry args={[mm(w), mm(2), mm(d)]} />
        <meshStandardMaterial {...pcb(PCB_GREEN)} />
      </mesh>
      {/* bezel */}
      <mesh position={[0, mm(5.5), 0]} castShadow>
        <boxGeometry args={[mm(w - 8), mm(9), mm(d - 10)]} />
        <meshStandardMaterial {...plastic('#101216')} />
      </mesh>
      <mesh position={[0, mm(10.1), 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[mm(w - 16), mm(d - 16)]} />
        <meshStandardMaterial
          map={texture}
          emissive={blue ? '#7fb4ff' : '#d7f75b'}
          emissiveMap={texture}
          emissiveIntensity={lit ? 0.9 : 0.02}
          color={lit ? '#ffffff' : '#222222'}
          roughness={0.35}
        />
      </mesh>
      {/* contrast trimmer + backpack hint */}
      <mesh position={[mm(w / 2 - 8), mm(3.4), mm(-d / 2 + 8)]}>
        <boxGeometry args={[mm(6), mm(4), mm(6)]} />
        <meshStandardMaterial {...plastic('#1d4fd7')} />
      </mesh>
    </group>
  );
}

/* ── ILI9341 TFT ───────────────────────────────────────────────────────── */

function Ili9341({ liveId }: { liveId?: string }) {
  const on = useSim3D((s) => (liveId ? (s.switchOn[liveId] ?? true) : true));
  const { texture, draw } = useTextScreen(240, 320, '#0b1020', '#ffffff');
  useEffect(() => {
    draw(['ILI9341 240x320', 'SPI OK', 'frame ready', 'draw loop live']);
  }, [draw]);
  return (
    <group>
      <mesh position={[0, mm(1), 0]} castShadow receiveShadow>
        <boxGeometry args={[mm(50), mm(2), mm(69)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      <mesh position={[0, mm(6), 0]} castShadow>
        <boxGeometry args={[mm(44), mm(8), mm(62)]} />
        <meshStandardMaterial {...plastic('#e8e4da')} />
      </mesh>
      <mesh position={[0, mm(10.2), 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[mm(38), mm(51)]} />
        <meshStandardMaterial
          map={texture}
          emissive="#ffffff"
          emissiveMap={texture}
          emissiveIntensity={on ? 1.1 : 0}
          color={on ? '#ffffff' : '#05070c'}
          roughness={0.2}
        />
      </mesh>
      <mesh position={[0, mm(2.6), 0]}>
        <boxGeometry args={[mm(10), mm(1.6), mm(10)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
    </group>
  );
}

/* ── 7-segment ─────────────────────────────────────────────────────────── */

const SEG_MAP: Record<number, number[]> = {
  0: [1, 1, 1, 1, 1, 1, 0],
  1: [0, 1, 1, 0, 0, 0, 0],
  2: [1, 1, 0, 1, 1, 0, 1],
  3: [1, 1, 1, 1, 0, 0, 1],
  4: [0, 1, 1, 0, 0, 1, 1],
  5: [1, 0, 1, 1, 0, 1, 1],
  6: [1, 0, 1, 1, 1, 1, 1],
  7: [1, 1, 1, 0, 0, 0, 0],
  8: [1, 1, 1, 1, 1, 1, 1],
  9: [1, 1, 1, 1, 0, 1, 1],
};

// a b c d e f g segment poses (x, z, horizontal?)
const SEG_POSE: [number, number, boolean][] = [
  [0, -8, true],
  [4.5, -4, false],
  [4.5, 4, false],
  [0, 8, true],
  [-4.5, 4, false],
  [-4.5, -4, false],
  [0, 0, true],
];

function SevenSeg({ liveId }: { liveId?: string }) {
  const digit = useSim3D((s) => {
    if (!liveId) return 8;
    const d = s.sensors[liveId]?.digit;
    if (typeof d === 'number') return Math.max(0, Math.min(9, Math.round(d)));
    return (s.analog[liveId] ?? 80) % 10;
  });
  const segs = SEG_MAP[digit] ?? SEG_MAP[8];
  return (
    <group>
      <mesh position={[0, mm(4), 0]} castShadow>
        <boxGeometry args={[mm(19), mm(8), mm(12.7)]} />
        <meshStandardMaterial {...plastic('#181c21')} />
      </mesh>
      {SEG_POSE.map(([x, z, horiz], i) => (
        <mesh key={i} position={[mm(x), mm(8.2), mm(z)]} rotation={horiz ? undefined : [0, 0, Math.PI / 2]}>
          <boxGeometry args={[mm(horiz ? 7 : 2), mm(0.5), mm(horiz ? 2 : 7)]} />
          <meshStandardMaterial
            color={segs[i] ? '#ff2b2b' : '#3f1111'}
            emissive={segs[i] ? '#ff0000' : '#000000'}
            emissiveIntensity={segs[i] ? 1.8 : 0}
            roughness={0.3}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ── TM1637 4-digit clock display ──────────────────────────────────────── */

const TM_EXTRA: Record<string, number[]> = {
  A: [1, 1, 1, 0, 1, 1, 1],
  b: [0, 0, 1, 1, 1, 1, 1],
  B: [0, 0, 1, 1, 1, 1, 1],
  C: [1, 0, 0, 1, 1, 1, 0],
  c: [0, 0, 0, 1, 1, 0, 1],
  d: [0, 1, 1, 1, 1, 0, 1],
  E: [1, 0, 0, 1, 1, 1, 1],
  F: [1, 0, 0, 0, 1, 1, 1],
  H: [0, 1, 1, 0, 1, 1, 1],
  L: [0, 0, 0, 1, 1, 1, 0],
  n: [0, 0, 1, 0, 1, 0, 1],
  o: [0, 0, 1, 1, 1, 0, 1],
  P: [1, 1, 0, 0, 1, 1, 1],
  r: [0, 0, 0, 0, 1, 0, 1],
  t: [0, 0, 0, 1, 1, 1, 1],
  U: [0, 1, 1, 1, 1, 1, 0],
  y: [0, 1, 1, 1, 0, 1, 1],
  '-': [0, 0, 0, 0, 0, 0, 1],
  '_': [0, 0, 0, 1, 0, 0, 0],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};

function TmDigit({ ch, x, glow }: { ch: string; x: number; glow: number }) {
  const segs = SEG_MAP[Number(ch)] ?? TM_EXTRA[ch] ?? TM_EXTRA[' '];
  return (
    <group position={[mm(x), mm(3.6), 0]}>
      {SEG_POSE.map(([sx, sz, horiz], i) => (
        <mesh
          key={i}
          position={[mm(sx * 0.58), 0, mm(sz * 0.58)]}
          rotation={horiz ? undefined : [0, 0, Math.PI / 2]}
        >
          <boxGeometry args={[mm(horiz ? 4 : 1.2), mm(0.5), mm(horiz ? 1.2 : 4)]} />
          <meshStandardMaterial
            color={segs[i] ? '#ff2b2b' : '#3f1111'}
            emissive={segs[i] ? '#ff0000' : '#000000'}
            emissiveIntensity={segs[i] ? glow : 0}
            roughness={0.3}
          />
        </mesh>
      ))}
    </group>
  );
}

function Tm1637({ liveId }: { liveId?: string }) {
  const shown = useSim3D((s) => (liveId ? s.lcdText[liveId]?.[0] : undefined) ?? '12:34');
  const bright = useSim3D((s) => (liveId ? s.sensors[liveId]?.brightness : undefined) ?? 8);
  const glow = 0.3 + (Math.max(0, Math.min(15, bright)) / 15) * 1.9;
  const colon = shown.includes(':');
  const chars = shown.replace(/[^0-9A-Fa-fbCcdEHhLnortUy\-_ ]/g, '').padEnd(4, ' ').slice(0, 4);
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(42), mm(1.6), mm(24)]} />
        <meshStandardMaterial {...pcb(PCB_RED)} />
      </mesh>
      <mesh position={[0, mm(2.4), 0]}>
        <boxGeometry args={[mm(37), mm(1.6), mm(17)]} />
        <meshStandardMaterial {...plastic('#14090a')} />
      </mesh>
      {[-13.5, -4.5, 4.5, 13.5].map((x, i) => (
        <TmDigit key={i} ch={chars[i] ?? ' '} x={x} glow={glow} />
      ))}
      {colon &&
        [-1.4, 1.4].map((z) => (
          <mesh key={z} position={[0, mm(3.6), mm(z)]}>
            <boxGeometry args={[mm(1.2), mm(0.5), mm(1.2)]} />
            <meshStandardMaterial color="#ff2b2b" emissive="#ff0000" emissiveIntensity={glow} />
          </mesh>
        ))}
      <mesh position={[mm(17), mm(2), mm(-6)]}>
        <boxGeometry args={[mm(4), mm(1), mm(3)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
    </group>
  );
}

/* ── MAX7219 8×8 dot matrix ────────────────────────────────────────────── */

function Max7219Matrix({ liveId }: { liveId?: string }) {
  const rows = useSim3D((s) => (liveId ? s.lcdText[liveId] : undefined));
  const bright = useSim3D((s) => (liveId ? s.sensors[liveId]?.brightness : undefined) ?? 8);
  const glow = 0.25 + (Math.max(0, Math.min(15, bright)) / 15) * 2;
  const grid = rows && rows.length ? rows : ['........', '........', '........', '........', '........', '........', '........', '........'];
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(50), mm(1.6), mm(32)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      <mesh position={[mm(-7), mm(2.6), 0]}>
        <boxGeometry args={[mm(32), mm(3.6), mm(32)]} />
        <meshStandardMaterial {...plastic('#101010')} />
      </mesh>
      {grid.slice(0, 8).map((row, r) =>
        row
          .padEnd(8, '.')
          .slice(0, 8)
          .split('')
          .map((c, col) => {
            const on = c === '#' || c === '1' || c === 'X' || c === '*';
            return (
              <mesh
                key={`${r}-${col}`}
                position={[mm(-7 - 12.25 + col * 3.5), mm(4.6), mm(-12.25 + r * 3.5)]}
              >
                <cylinderGeometry args={[mm(1.3), mm(1.3), mm(0.6), 10]} />
                <meshStandardMaterial
                  color={on ? '#ff2b2b' : '#3a0d0d'}
                  emissive={on ? '#ff0000' : '#000000'}
                  emissiveIntensity={on ? glow : 0}
                  roughness={0.3}
                />
              </mesh>
            );
          }),
      )}
      <mesh position={[mm(16), mm(2.4), 0]}>
        <boxGeometry args={[mm(14), mm(3.2), mm(7)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      <mesh position={[mm(16), mm(2.2), mm(10)]}>
        <cylinderGeometry args={[mm(2.5), mm(2.5), mm(5), 12]} />
        <meshStandardMaterial {...plastic('#1a1a2e')} />
      </mesh>
    </group>
  );
}

/* ── Nokia 5110 (PCD8544 84×48) ────────────────────────────────────────── */

function Nokia5110({ liveId }: { liveId?: string }) {
  const lines = useSim3D((s) => (liveId ? s.lcdText[liveId] : undefined));
  const { texture, draw } = useTextScreen(84, 48, '#a9c4de', '#16283c');
  useEffect(() => {
    draw(lines && lines.length ? lines : ['Nokia 5110', 'PCD8544', '84x48 OK']);
  }, [draw, lines]);
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]}>
        <boxGeometry args={[mm(45), mm(1.6), mm(45)]} />
        <meshStandardMaterial {...pcb(PCB_BLUE)} />
      </mesh>
      <mesh position={[0, mm(2.4), mm(-4)]}>
        <boxGeometry args={[mm(38), mm(2.4), mm(32)]} />
        <meshStandardMaterial {...plastic('#20242a')} />
      </mesh>
      <mesh position={[0, mm(3.7), mm(-4)]}>
        <planeGeometry args={[mm(33), mm(24)]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      {[-20, 20].map((x) =>
        [-20, 16].map((z) => (
          <mesh key={`${x}${z}`} position={[mm(x), mm(0.9), mm(z)]}>
            <cylinderGeometry args={[mm(1.5), mm(1.5), mm(2.2), 10]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.9} />
          </mesh>
        )),
      )}
    </group>
  );
}

/* ── NeoPixel matrix / ring / bar ──────────────────────────────────────── */

function NeoMatrix({ liveId }: { liveId?: string }) {
  const color = useSim3D((s) => (liveId ? s.led[liveId]?.color ?? '#ff4400' : '#ff4400'));
  const brightness = useSim3D((s) => (liveId ? s.led[liveId]?.brightness ?? 0.4 : 0.4));
  const chase = useRef<Group>(null);
  useFrame(({ clock }) => {
    const g = chase.current;
    if (!g) return;
    const t = (clock.elapsedTime * 2) % 8;
    g.position.set(mm((Math.floor(t) - 3.5) * 7), mm(3.2), mm(((t * 3) % 8 - 3.5) * 7));
  });
  const cells = useMemo(() => {
    const arr: [number, number][] = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) arr.push([c, r]);
    return arr;
  }, []);
  return (
    <group>
      <mesh position={[0, mm(1), 0]} castShadow receiveShadow>
        <boxGeometry args={[mm(60), mm(2.5), mm(60)]} />
        <meshStandardMaterial {...pcb(PCB_BLACK)} />
      </mesh>
      {cells.map(([c, r], i) => (
        <mesh key={i} position={[mm((c - 3.5) * 7), mm(2.6), mm((r - 3.5) * 7)]}>
          <boxGeometry args={[mm(4.6), mm(1), mm(4.6)]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.25 + brightness * 1.4}
            roughness={0.3}
          />
        </mesh>
      ))}
      <group ref={chase}>
        <mesh>
          <boxGeometry args={[mm(4.6), mm(1.4), mm(4.6)]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2.4} />
        </mesh>
      </group>
    </group>
  );
}

function LedRing({ liveId }: { liveId?: string }) {
  const color = useSim3D((s) => (liveId ? s.led[liveId]?.color ?? '#44aaff' : '#44aaff'));
  const dots = useMemo(() => {
    const arr: [number, number][] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      arr.push([Math.cos(a) * 17, Math.sin(a) * 17]);
    }
    return arr;
  }, []);
  return (
    <group>
      <mesh position={[0, mm(0.8), 0]} castShadow>
        <cylinderGeometry args={[mm(22), mm(22), mm(1.6), 40]} />
        <meshStandardMaterial {...pcb(PCB_BLACK)} />
      </mesh>
      {dots.map(([x, z], i) => (
        <mesh key={i} position={[mm(x), mm(2.2), mm(z)]}>
          <boxGeometry args={[mm(4.6), mm(1.2), mm(4.6)]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function LedBar({ liveId }: { liveId?: string }) {
  const level = useSim3D((s) => {
    if (!liveId) return 5;
    const l = s.sensors[liveId]?.level;
    if (typeof l === 'number') return Math.max(0, Math.min(10, Math.round(l)));
    return Math.round(((s.analog[liveId] ?? 512) / 1023) * 10);
  });
  return (
    <group>
      <mesh position={[0, mm(4), 0]} castShadow>
        <boxGeometry args={[mm(25.4), mm(8), mm(10.2)]} />
        <meshStandardMaterial {...plastic('#181c21')} />
      </mesh>
      {Array.from({ length: 10 }).map((_, i) => {
        const on = i < level;
        const col = i < 7 ? '#22c55e' : i < 9 ? '#eab308' : '#ef4444';
        return (
          <mesh key={i} position={[mm(-11.4 + i * 2.54), mm(8.2), 0]}>
            <boxGeometry args={[mm(1.8), mm(0.6), mm(6)]} />
            <meshStandardMaterial
              color={on ? col : '#241a1a'}
              emissive={on ? col : '#000000'}
              emissiveIntensity={on ? 1.8 : 0}
              roughness={0.3}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/* ── ePaper ────────────────────────────────────────────────────────────── */

function Epaper() {
  return (
    <group>
      {/* driver HAT */}
      <mesh position={[0, mm(0.8), mm(20)]} castShadow>
        <boxGeometry args={[mm(65), mm(1.6), mm(30)]} />
        <meshStandardMaterial {...pcb(PCB_RED)} />
      </mesh>
      {/* panel */}
      <mesh position={[0, mm(2.4), mm(-8)]} castShadow receiveShadow>
        <boxGeometry args={[mm(89), mm(1.2), mm(38)]} />
        <meshStandardMaterial color="#e8e6e1" roughness={0.55} metalness={0} />
      </mesh>
      {/* e-ink content */}
      <mesh position={[-mm(20), mm(3.05), mm(-8)]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[mm(40), mm(20)]} />
        <meshStandardMaterial color="#111111" roughness={0.7} />
      </mesh>
      <mesh position={[mm(22), mm(3.05), mm(-8)]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[mm(14), mm(20)]} />
        <meshStandardMaterial color="#b01e24" roughness={0.7} />
      </mesh>
    </group>
  );
}

export default function Displays3D(props: PartViewProps) {
  const { kind, liveId } = props;
  if (kind === 'ssd1306' || kind === 'ssd1306-i2c-4pin') return <Ssd1306 liveId={liveId} />;
  if (kind === 'lcd1602' || kind === 'lcd1602-i2c') return <Lcd liveId={liveId} cols={16} rows={2} />;
  if (kind === 'lcd2004' || kind === 'lcd2004-i2c') return <Lcd liveId={liveId} cols={20} rows={4} />;
  if (kind === 'lcd2002') return <Lcd liveId={liveId} cols={20} rows={2} />;
  if (kind === 'ili9341' || kind === 'ili9341-cap-touch') return <Ili9341 liveId={liveId} />;
  if (kind === '7segment') return <SevenSeg liveId={liveId} />;
  if (kind === 'neopixel-matrix') return <NeoMatrix liveId={liveId} />;
  if (kind === 'led-ring') return <LedRing liveId={liveId} />;
  if (kind === 'led-bar-graph') return <LedBar liveId={liveId} />;
  if (kind.startsWith('epaper')) return <Epaper />;
  if (kind === 'tm1637') return <Tm1637 liveId={liveId} />;
  if (kind === 'max7219-matrix') return <Max7219Matrix liveId={liveId} />;
  if (kind === 'nokia-5110') return <Nokia5110 liveId={liveId} />;
  return <Ssd1306 liveId={liveId} />;
}
