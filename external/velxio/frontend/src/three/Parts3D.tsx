/**
 * Parts3D — real volumetric 3D parts for the bench, animated from live state.
 *
 * Replaces the flat, SVG-textured "card" render (Card3D) with hand-authored
 * parametric solid bodies so parts read as physical objects from any angle.
 * Built entirely from three.js primitives (no external mesh assets, no CSG, no
 * new deps) and keyed by the component's metadataId / board kind.
 *
 * ## Live animation (matches your running code)
 * Velxio's 2D canvas mounts each part as a real custom element
 * (`<wokwi-servo>`, `<wokwi-led>` …) and the simulators write that part's
 * actual electrical state straight onto the element as a JS property:
 *   - servo / stepper-motor / biaxial-stepper  -> `el.angle` (degrees)
 *   - led / rgb-led                            -> `el.brightness` (0..1)
 *   - pushbutton                               -> `el.pressed`
 *   - potentiometer                            -> `el.value` (0..1023)
 * Those elements stay mounted (the 2D tree is only hidden) while the 3D view
 * is active, so each Part3D looks up its element by id every frame and drives
 * the matching body from that real state. Only when there is genuinely no live
 * element (e.g. the "3D all" gallery) do movable parts fall back to gentle demo
 * motion so they don't sit frozen.
 *
 * World space matches the 2D canvas 1:1: (x, z) are canvas (x, y) pixels and
 * +Y is up. Each part is built with its footprint centre at the origin and its
 * base resting on the bench (y = 0). The parent group applies placement +
 * rotation about Y.
 */
import { useRef } from 'react';
import type { ReactNode, MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, MeshStandardMaterial } from 'three';

export interface Part3DProps {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  lift?: number;
  rotationDeg?: number;
  /** True when `kind` is a microcontroller/dev board (gets a real PCB). */
  board?: boolean;
  /** The component metadataId, or the BoardKind label for boards. */
  kind: string;
  label?: string;
  properties?: Record<string, unknown>;
  /**
   * id of the live 2D element (component.id) whose real sim state should drive
   * this part. When omitted (e.g. gallery) movable parts run demo motion.
   */
  liveSourceId?: string;
}

/** Real per-part live state read off the mounted 2D element. */
interface LiveState {
  angle?: number; // degrees (servo 0..180, stepper/motor accumulated)
  level?: number; // 0..1 brightness / value fraction
  pressed?: boolean;
  color?: string;
}

type LiveRef = MutableRefObject<LiveState>;

const PCB = '#15803d';
const CHIP = '#14181e';
const PIN = '#c9c9c9';
const PAD = '#8f9aa6';
const METAL = '#9aa3ad';

interface MatOpts {
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
}

const mat = (color: string, o: MatOpts = {}) => ({
  color,
  roughness: o.roughness ?? 0.55,
  metalness: o.metalness ?? 0.12,
  ...o,
});

/* ── animated wrappers (imperative, driven by the shared LiveRef) ──────── */

/** Rotates its children about Y to an exact angle (deg) — the live servo horn. */
function TrackAngleY({ live, canDemo, children }: { live: LiveRef; canDemo: boolean; children: ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const a = live.current.angle;
    if (a !== undefined) {
      ref.current.rotation.y = (a * Math.PI) / 180;
    } else if (canDemo) {
      const sweep = (Math.sin(clock.elapsedTime * 2.4) * 0.5 + 0.5) * 170;
      ref.current.rotation.y = (sweep * Math.PI) / 180;
    }
  });
  return <group ref={ref}>{children}</group>;
}

/**
 * Rotates its children about a fixed world axis to an exact accumulated angle
 * (radians) — live motor/stepper shaft. Spins continuously while the sim keeps
 * advancing el.angle, is static when idle.
 */
function TrackAngleAxis({
  axis,
  live,
  canDemo,
  demo = 0.9,
  children,
}: {
  axis: 'x' | 'y' | 'z';
  live: LiveRef;
  canDemo: boolean;
  demo?: number;
  children: ReactNode;
}) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const a = live.current.angle;
    let target: number;
    if (a !== undefined) {
      target = (a * Math.PI) / 180;
    } else if (canDemo) {
      target = (clock.elapsedTime * demo) % (Math.PI * 2);
    } else {
      return;
    }
    const r = ref.current.rotation;
    if (axis === 'x') r.x = target;
    else if (axis === 'y') r.y = target;
    else r.z = target;
  });
  return <group ref={ref}>{children}</group>;
}

/** Lowers its children (a button cap) while the part is pressed. */
function PressShift({
  live,
  canDemo,
  travel = 1.6,
  children,
}: {
  live: LiveRef;
  canDemo: boolean;
  travel?: number;
  children: ReactNode;
}) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const pressed = live.current.pressed;
    if (pressed !== undefined) ref.current.position.y = pressed ? -travel : 0;
    else if (canDemo) ref.current.position.y = 0;
  });
  return <group ref={ref}>{children}</group>;
}

/** Rotates children about Y by level (0..1) mapped to a knob range. */
function PotKnob({
  live,
  canDemo,
  fullRange = 270,
  children,
}: {
  live: LiveRef;
  canDemo: boolean;
  fullRange?: number;
  children: ReactNode;
}) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const level = live.current.level;
    const deg = level !== undefined ? level * fullRange - fullRange / 2 : canDemo ? 0 : 0;
    ref.current.rotation.y = (deg * Math.PI) / 180;
  });
  return <group ref={ref}>{children}</group>;
}

/** Emissive LED dome; its glow tracks the live brightness/colour. */
function LedDome({ color, rgb, live }: { color: string; rgb: boolean; live: LiveRef }) {
  const ref = useRef<MeshStandardMaterial>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const level = live.current.level ?? 0;
    m.emissiveIntensity = 0.16 + level * 2.2;
    if (live.current.color) m.color.set(live.current.color);
  });
  const bodyColor = rgb ? '#5a6470' : color;
  return (
    <mesh position={[0, 5.6, 0]} castShadow>
      <sphereGeometry args={[4.6, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <meshStandardMaterial
        ref={ref}
        color={bodyColor}
        emissive={rgb ? '#ffffff' : bodyColor}
        emissiveIntensity={0.16}
        transparent
        opacity={0.9}
        roughness={0.2}
      />
    </mesh>
  );
}

/* ── reusable static sub-parts ─────────────────────────────────────────── */

function Lead({ x, z, len = 4, r = 0.42 }: { x: number; z: number; len?: number; r?: number }) {
  return (
    <mesh position={[x, len / 2, z]} castShadow>
      <cylinderGeometry args={[r, r, len, 8]} />
      <meshStandardMaterial {...mat(PIN, { metalness: 0.85, roughness: 0.3 })} />
    </mesh>
  );
}

function DipLegs({ count, start, pitch = 2.6, height = 3.4 }: { count: number; start: number; pitch?: number; height?: number }) {
  const legs: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const idx = Math.floor(i / 2);
    legs.push(
      <mesh key={i} position={[start + idx * pitch, height / 2, side * 3.2]} castShadow>
        <boxGeometry args={[1.1, height, 1.1]} />
        <meshStandardMaterial {...mat(PIN, { metalness: 0.85, roughness: 0.3 })} />
      </mesh>,
    );
  }
  return <>{legs}</>;
}

function AxialBody({
  body,
  color,
  bandColors = [],
  leadLen = 6,
  bw = 0.9,
}: {
  body: { w: number; h: number };
  color: string;
  bandColors?: string[];
  leadLen?: number;
  bw?: number;
}) {
  const half = body.w / 2 - 0.6;
  return (
    <>
      <Lead x={-half - leadLen / 2} z={0} len={1.1} r={0.3} />
      <Lead x={half + leadLen / 2} z={0} len={1.1} r={0.3} />
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[bw, bw, body.w, 18]} />
        <meshStandardMaterial {...mat(color)} />
      </mesh>
      {bandColors.map((c, i) => {
        const pos = -half + 2 + i * 2.4;
        return (
          <mesh key={i} rotation={[0, 0, Math.PI / 2]} position={[pos, 0, 0]}>
            <cylinderGeometry args={[bw + 0.08, bw + 0.08, 1.5, 18]} />
            <meshStandardMaterial {...mat(c, { roughness: 0.9 })} />
          </mesh>
        );
      })}
    </>
  );
}

function BoardBody({ kind }: { kind: string }) {
  const LW = kind.includes('uno') ? 160 : kind.includes('mega') ? 200 : 140;
  const LD = kind.includes('uno') ? 130 : kind.includes('mega') ? 180 : 110;
  const sidePins = Math.max(2, Math.round(LW / 22));
  const hdr: ReactNode[] = [];
  for (let i = 0; i < sidePins; i++) {
    const x = -LW / 2 + 16 + i * 20;
    hdr.push(
      <mesh key={i} position={[x, 5, -LD / 2 + 3]}>
        <cylinderGeometry args={[1.4, 1.4, 8, 10]} />
        <meshStandardMaterial {...mat(CHIP)} />
      </mesh>,
      <mesh key={`a${i}`} position={[x, 5, LD / 2 - 3]}>
        <cylinderGeometry args={[1.4, 1.4, 8, 10]} />
        <meshStandardMaterial {...mat(CHIP)} />
      </mesh>,
    );
  }
  return (
    <>
      <mesh position={[0, 1.6, 0]} castShadow receiveShadow>
        <boxGeometry args={[LW, 3.2, LD]} />
        <meshStandardMaterial {...mat(PCB, { roughness: 0.7 })} />
      </mesh>
      <mesh position={[0, 3.3, 0]}>
        <boxGeometry args={[LW - 6, 0.2, 3]} />
        <meshStandardMaterial {...mat('#f4f4f4', { roughness: 0.9 })} />
      </mesh>
      <mesh position={[0, 3.3, 0]}>
        <boxGeometry args={[3, 0.2, LD - 6]} />
        <meshStandardMaterial {...mat('#f4f4f4', { roughness: 0.9 })} />
      </mesh>
      <mesh position={[0, 5.4, 8]} castShadow>
        <boxGeometry args={[34, 4.4, 26]} />
        <meshStandardMaterial {...mat(CHIP)} />
      </mesh>
      {hdr}
      <mesh position={[LW / 2 - 14, 3.5, -LD / 2 + 12]}>
        <sphereGeometry args={[1.6, 10, 8]} />
        <meshStandardMaterial {...mat('#ef4444', { emissive: '#ff2b2b', emissiveIntensity: 1.2 })} />
      </mesh>
      <mesh position={[-LW / 2 + 14, 3.5, -LD / 2 + 12]}>
        <sphereGeometry args={[1.6, 10, 8]} />
        <meshStandardMaterial {...mat('#ffb020', { emissive: '#ffa500', emissiveIntensity: 1.1 })} />
      </mesh>
    </>
  );
}

function ModuleBody({ color = PCB, accent }: { color?: string; accent?: ReactNode }) {
  return (
    <>
      <mesh position={[0, 2, 0]} castShadow>
        <boxGeometry args={[22, 4, 16]} />
        <meshStandardMaterial {...mat(color, { roughness: 0.7 })} />
      </mesh>
      <mesh position={[0, 4.1, 0]}>
        <boxGeometry args={[22, 0.2, 16]} />
        <meshStandardMaterial {...mat('#ffffff55', { transparent: true, roughness: 1 })} />
      </mesh>
      {accent}
    </>
  );
}

function LedBody({ color, rgb, live }: { color: string; rgb: boolean; live: LiveRef }) {
  return (
    <>
      <mesh position={[0, 2, 0]} castShadow>
        <boxGeometry args={[5.2, 4, 5.2]} />
        <meshStandardMaterial {...mat('#2a2e33', { roughness: 0.4 })} />
      </mesh>
      <LedDome color={color} rgb={rgb} live={live} />
      <Lead x={-1.2} z={0} len={3} r={0.4} />
      <Lead x={1.2} z={0} len={3} r={0.4} />
    </>
  );
}

type PartStyle =
  | 'ic' | 'led' | 'resistor' | 'cap' | 'diode' | 'transistor' | 'servo'
  | 'motor' | 'button' | 'pot' | 'sensor' | 'display' | 'battery' | 'generic';

function classify(kind: string): PartStyle {
  if (kind.includes('7segment') || kind.includes('lcd') || kind.includes('ssd1306') || kind.includes('epaper') || kind.includes('ili9341') || kind.includes('matrix') || kind.includes('led-ring') || kind.includes('led-bar-graph') || kind.includes('neopixel')) return 'display';
  if (kind === 'led' || kind === 'rgb-led' || kind.startsWith('led-')) return 'led';
  if (kind === 'resistor' || kind.startsWith('resistor-')) return 'resistor';
  if (kind === 'capacitor' || kind === 'capacitor-electrolytic' || kind.startsWith('cap') || kind.startsWith('cap-elec') || kind === 'inductor' || kind.startsWith('ind-')) return 'cap';
  if (kind.startsWith('diode') || kind.startsWith('zener')) return 'diode';
  if (kind.startsWith('bjt') || kind.startsWith('mosfet') || kind.startsWith('opto')) return 'transistor';
  if (kind.includes('servo')) return 'servo';
  if (kind.includes('motor') || kind.includes('a4988') || kind.includes('stepper') || kind.includes('biaxial')) return 'motor';
  if (kind === 'pushbutton' || kind === 'pushbutton-6mm' || kind === 'dip-switch-8' || kind === 'slide-switch') return 'button';
  if (kind.includes('potentiometer')) return 'pot';
  if (kind === 'dht22' || kind === 'hc-sr04' || kind === 'bmp280' || kind === 'mpu6050' || kind === 'gps-neo6m' || kind === 'flame-sensor' || kind === 'gas-sensor' || kind === 'pir-motion-sensor' || kind.includes('sound') || kind.includes('joystick') || kind.includes('heart') || kind.includes('temperature')) return 'sensor';
  if (kind === 'battery-9v' || kind === 'battery-aa' || kind === 'battery-coin-cell') return 'battery';
  return kind === 'breadboard' || kind === 'breadboard-mini' ? 'generic' : 'ic';
}

/* ── top-level renderer ────────────────────────────────────────────────── */

export function Part3D(props: Part3DProps) {
  const { board, kind, liveSourceId, properties = {} } = props;
  const hasLive = liveSourceId !== undefined;

  // Live bridge: read the real 2D element's sim state every frame into a shared
  // ref. Each animated leaf reads only from this ref (no React re-renders).
  const live = useRef<LiveState>({ level: 0, pressed: false });
  useFrame(() => {
    if (!hasLive) return;
    const el = document.getElementById(liveSourceId as string) as
      | (HTMLElement & Record<string, unknown>)
      | null;
    if (!el) return;
    const s: LiveState = {};
    if (typeof el.angle === 'number' && Number.isFinite(el.angle)) s.angle = el.angle as number;
    if (typeof el.brightness === 'number' && Number.isFinite(el.brightness)) {
      s.level = Math.max(0, Math.min(1, el.brightness as number));
    } else if (typeof el.value === 'number' && Number.isFinite(el.value)) {
      const v = el.value as number;
      s.level = Math.max(0, Math.min(1, v > 1 ? v / 1023 : v));
    }
    if (typeof el.pressed === 'boolean') s.pressed = el.pressed as boolean;
    if (typeof el.color === 'string' && el.color) s.color = el.color as string;
    live.current = s;
  });

  const state = Boolean(properties.state);
  const color = (properties.color as string) || (properties.color0 as string) || 'red';

  if (board) {
    return (
      <group>
        <BoardBody kind={kind} />
      </group>
    );
  }

  const style = classify(kind);

  switch (style) {
    case 'led':
      return (
        <group>
          <LedBody color={color} rgb={kind === 'rgb-led'} live={live} />
        </group>
      );
    case 'resistor': {
      const val = (properties.value as string) || (properties.resistance as string) || '';
      const bands =
        /k/i.test(val) ? ['#b91c1c', '#3a3a3a', '#b91c1c'] :
        val === '220' ? ['#d32f2f', '#d32f2f', '#ffb300'] :
        val === '330' ? ['#f97316', '#f97316', '#ffb300'] :
        /m/i.test(val) ? ['#7c3aed', '#22c55e'] :
        ['#3a3a3a', '#3a3a3a', '#ffb300'];
      return (
        <group>
          <AxialBody body={{ w: 14, h: 6 }} color="#d9a066" bandColors={bands} />
        </group>
      );
    }
    case 'diode':
      return (
        <group>
          <AxialBody body={{ w: 10, h: 6 }} color="#22262b" bandColors={['#d1d5db']} />
        </group>
      );
    case 'cap':
      if (kind === 'capacitor-electrolytic' || kind.startsWith('cap-elec')) {
        return (
          <group>
            <mesh position={[0, 4, 0]} castShadow>
              <cylinderGeometry args={[3.4, 3.4, 8, 20]} />
              <meshStandardMaterial {...mat('#2f4b5c', { roughness: 0.35, metalness: 0.4 })} />
            </mesh>
            <mesh position={[0, 8.1, 0]}>
              <cylinderGeometry args={[3.4, 3.4, 0.5, 20]} />
              <meshStandardMaterial {...mat('#8f9aa6', { metalness: 0.7, roughness: 0.3 })} />
            </mesh>
            <Lead x={-1.5} z={0} len={3} />
            <Lead x={1.5} z={0} len={3} />
          </group>
        );
      }
      return (
        <group>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <sphereGeometry args={[3.4, 16, 12]} />
            <meshStandardMaterial {...mat('#e7d7b1')} />
          </mesh>
          <Lead x={-3.4} z={0} len={1.2} r={0.35} />
          <Lead x={3.4} z={0} len={1.2} r={0.35} />
        </group>
      );
    case 'transistor': {
      return (
        <group>
          <mesh position={[0, 6, 0]} castShadow>
            <cylinderGeometry args={[2.6, 2.6, 9, 14, 1, false, 0, Math.PI]} />
            <meshStandardMaterial {...mat('#1d2024')} />
          </mesh>
          <Lead x={0} z={0} len={2} />
          <Lead x={-1.6} z={0} len={2} r={0.3} />
          <Lead x={1.6} z={0} len={2} r={0.3} />
        </group>
      );
    }
    case 'servo':
      return (
        <group>
          <mesh position={[0, 10, 0]} castShadow>
            <boxGeometry args={[22, 20, 12]} />
            <meshStandardMaterial {...mat('#e8722a', { roughness: 0.6 })} />
          </mesh>
          <mesh position={[0, 20.1, 0]}>
            <boxGeometry args={[24, 1, 13]} />
            <meshStandardMaterial {...mat('#c75e1c')} />
          </mesh>
          <mesh position={[0, 22, 0]}>
            <cylinderGeometry args={[1.4, 1.4, 3, 12]} />
            <meshStandardMaterial {...mat(PIN, { metalness: 0.8 })} />
          </mesh>
          {/* horn tracks the real el.angle (deg) about Y */}
          <group position={[0, 23.5, 0]}>
            <TrackAngleY live={live} canDemo={!hasLive}>
              <mesh castShadow>
                <boxGeometry args={[14, 1.2, 2.4]} />
                <meshStandardMaterial {...mat('#2f343a')} />
              </mesh>
              <mesh position={[8.5, 0.4, 0]}>
                <cylinderGeometry args={[1, 1, 1.4, 10]} />
                <meshStandardMaterial {...mat(PAD)} />
              </mesh>
            </TrackAngleY>
          </group>
        </group>
      );
    case 'motor': {
      const stepper = kind.includes('stepper') || kind.includes('biaxial');
      const length = stepper ? 10 : 18;
      const bodyR = stepper ? 7 : 6;
      const top = bodyR;
      // casing lies along X; shaft + key spin about X driven by accumulated angle
      return (
        <group>
          <mesh position={[0, top, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[bodyR, bodyR, length, 22]} />
            <meshStandardMaterial {...mat('#5a5f66', { metalness: 0.5, roughness: 0.35 })} />
          </mesh>
          <mesh position={[length / 2, top, 0]}>
            <cylinderGeometry args={[bodyR + 0.3, bodyR + 0.3, 1.4, 22]} />
            <meshStandardMaterial {...mat('#3a3f45', { metalness: 0.5 })} />
          </mesh>
          <group position={[length / 2 + 3, top, 0]}>
            <TrackAngleAxis axis="x" live={live} canDemo={!hasLive} demo={0.9}>
              <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[1.3, 1.3, 5, 10]} />
                <meshStandardMaterial {...mat(METAL, { metalness: 0.9, roughness: 0.25 })} />
              </mesh>
              <mesh position={[3, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <boxGeometry args={[1.5, 1.5, 1.4]} />
                <meshStandardMaterial {...mat('#c9c9c9', { metalness: 0.8 })} />
              </mesh>
            </TrackAngleAxis>
          </group>
        </group>
      );
    }
    case 'button':
      if (kind === 'slide-switch') {
        const on = hasLive ? live.current.pressed : state;
        return (
          <group>
            <mesh position={[0, 2, 0]} castShadow>
              <boxGeometry args={[16, 4, 7]} />
              <meshStandardMaterial {...mat('#1f242b')} />
            </mesh>
            <mesh position={[on ? 4 : -4, 5, 0]} castShadow>
              <boxGeometry args={[4, 4, 4.4]} />
              <meshStandardMaterial {...mat('#f0b429')} />
            </mesh>
          </group>
        );
      }
      return (
        <group>
          <mesh position={[0, 2.2, 0]} castShadow>
            <boxGeometry args={[8, 4.4, 8]} />
            <meshStandardMaterial {...mat('#20242a')} />
          </mesh>
          <group position={[0, 6.2, 0]}>
            <PressShift live={live} canDemo={!hasLive} travel={1.6}>
              <mesh castShadow>
                <cylinderGeometry args={[2.8, 2.8, 4.4, 18]} />
                <meshStandardMaterial {...mat('#ef4444')} />
              </mesh>
            </PressShift>
          </group>
          <Lead x={-2} z={-2} len={2} r={0.4} />
          <Lead x={2} z={2} len={2} r={0.4} />
        </group>
      );
    case 'pot':
      return (
        <group>
          <mesh position={[0, 3, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[4.4, 4.4, 6, 18]} />
            <meshStandardMaterial {...mat('#262a30')} />
          </mesh>
          {/* knob turns with live value; a pointer ridge shows the rotation */}
          <group position={[0, 8.5, 0]}>
            <PotKnob live={live} canDemo={!hasLive}>
              <mesh castShadow>
                <cylinderGeometry args={[2.2, 2.2, 5, 14]} />
                <meshStandardMaterial {...mat('#d9a066')} />
              </mesh>
              <mesh position={[0, 1.2, 2.1]}>
                <boxGeometry args={[1.2, 1, 0.6]} />
                <meshStandardMaterial {...mat('#7c4a12')} />
              </mesh>
            </PotKnob>
          </group>
          <Lead x={0} z={-3.4} len={2} r={0.4} />
          <Lead x={0} z={0} len={2} r={0.4} />
          <Lead x={0} z={3.4} len={2} r={0.4} />
        </group>
      );
    case 'display':
      if (kind.includes('7segment')) {
        // representative lit segments (full 7-seg digit mapping is out of scope
        // for a parametric body, but they read as alive)
        return (
          <group>
            <mesh position={[0, 2, 0]} castShadow>
              <boxGeometry args={[13, 4, 20]} />
              <meshStandardMaterial {...mat('#181c21')} />
            </mesh>
            {[[-2.5, 4.6], [2.5, 2.2], [-2.5, 0], [2.5, -2.2], [-2.5, -4.6]].map(([x, z], i) => (
              <mesh key={i} position={[x, 4.2, z]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.7, 0.7, 2.6, 8]} />
                <meshStandardMaterial {...mat('#ff2b2b', { emissive: '#ff0000', emissiveIntensity: 0.5 })} />
              </mesh>
            ))}
          </group>
        );
      }
      return (
        <group>
          <mesh position={[0, 2.6, 0]} castShadow>
            <boxGeometry args={[40, 5.2, 20]} />
            <meshStandardMaterial {...mat(PCB, { roughness: 0.7 })} />
          </mesh>
          <mesh position={[0, 5.4, 0]}>
            <boxGeometry args={[34, 1, 14]} />
            <meshStandardMaterial {...mat('#1c2027')} />
          </mesh>
          <mesh position={[0, 6.1, 0]}>
            <boxGeometry args={[30, 0.6, 11]} />
            <meshStandardMaterial {...mat('#9ad0ff', { emissive: '#7fc4ff', emissiveIntensity: 0.35, roughness: 0.15 })} />
          </mesh>
        </group>
      );
    case 'battery':
      if (kind === 'battery-9v') {
        return (
          <group>
            <mesh position={[0, 8, 0]} castShadow>
              <boxGeometry args={[12, 16, 26]} />
              <meshStandardMaterial {...mat('#c9ced4', { metalness: 0.5, roughness: 0.4 })} />
            </mesh>
            <mesh position={[0, 17, 0]}>
              <boxGeometry args={[4, 1.5, 4]} />
              <meshStandardMaterial {...mat(CHIP)} />
            </mesh>
          </group>
        );
      }
      return (
        <group>
          <mesh position={[0, 6.5, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[6.5, 6.5, 26, 20]} />
            <meshStandardMaterial {...mat('#3fae5a', { roughness: 0.5 })} />
          </mesh>
        </group>
      );
    case 'sensor':
      if (kind === 'dht22') {
        return (
          <group>
            <ModuleBody color="#3b82f6">
              <mesh position={[0, 4.3, 0]}>
                <boxGeometry args={[16, 0.4, 10]} />
                <meshStandardMaterial {...mat('#2563eb', { roughness: 0.8 })} />
              </mesh>
            </ModuleBody>
          </group>
        );
      }
      if (kind === 'hc-sr04') {
        return (
          <group>
            <ModuleBody color={PCB}>
              <mesh position={[-5, 5.2, 6]} castShadow>
                <cylinderGeometry args={[4.5, 4.5, 2.4, 24]} />
                <meshStandardMaterial {...mat('#d8dde3', { metalness: 0.6, roughness: 0.25 })} />
              </mesh>
              <mesh position={[5, 5.2, 6]} castShadow>
                <cylinderGeometry args={[4.5, 4.5, 2.4, 24]} />
                <meshStandardMaterial {...mat('#262a30', { metalness: 0.4, roughness: 0.3 })} />
              </mesh>
            </ModuleBody>
          </group>
        );
      }
      return (
        <group>
          <ModuleBody color={PCB} />
        </group>
      );
    default:
      if (kind === 'breadboard' || kind === 'breadboard-mini') {
        const holes: ReactNode[] = [];
        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 30; c++) {
            holes.push(
              <mesh key={`${r}-${c}`} position={[-116 + c * 8, 4.6, -16 + r * 8]}>
                <cylinderGeometry args={[1.1, 1.1, 0.6, 8]} />
                <meshStandardMaterial {...mat('#20242a')} />
              </mesh>,
            );
          }
        }
        return (
          <group>
            <mesh position={[0, 3.5, 0]} castShadow>
              <boxGeometry args={[220, 7, 32]} />
              <meshStandardMaterial {...mat('#f2efe9', { roughness: 0.8 })} />
            </mesh>
            {holes}
          </group>
        );
      }
      const pins = 8;
      return (
        <group>
          <mesh position={[0, 3, 0]} castShadow>
            <boxGeometry args={[14, 6, 8]} />
            <meshStandardMaterial {...mat(CHIP, { roughness: 0.4 })} />
          </mesh>
          <DipLegs count={pins} start={-7.5} pitch={2.1} height={2.8} />
          <mesh position={[-3, 6.2, 0]}>
            <boxGeometry args={[2, 0.6, 5]} />
            <meshStandardMaterial {...mat('#c9c9c9')} />
          </mesh>
        </group>
      );
  }
}
