/**
 * parts/passives.tsx — the jellybeans, at true scale.
 *
 * Resistor colour bands are DECODED from the value string (IEC 60062), the
 * electrolytic can grows with capacitance, ceramics stay discs, TO-220s get
 * their tab hole, DIP ICs get pin-1 dots and legs. A 6.3 mm resistor body
 * next to a 68.6 mm Uno is exactly why the ratio complaints disappear.
 */

import { mm } from './common';
import type { PartViewProps } from './common';
import { chip, pin, plastic, resistorBands, silk, steel } from '../materials';

function AxialLeads({ span = 12 }: { span?: number }) {
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm((s * span) / 2), 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[mm(0.3), mm(0.3), mm(span - 6), 8]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
    </group>
  );
}

function Resistor({ value }: { value?: string }) {
  const bands = resistorBands(value);
  return (
    <group>
      <AxialLeads />
      <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[mm(1.15), mm(1.15), mm(6.3), 18]} />
        <meshStandardMaterial color="#d5b597" roughness={0.6} />
      </mesh>
      {(bands ?? ['#6b4226', '#111111', '#d62626']).map((c, i) => (
        <mesh key={i} position={[mm(-1.8 + i * 1.5), 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[mm(1.22), mm(1.22), mm(0.9), 18]} />
          <meshStandardMaterial color={c} roughness={0.6} />
        </mesh>
      ))}
      {/* tolerance gold */}
      <mesh position={[mm(2.4), 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[mm(1.22), mm(1.22), mm(0.9), 18]} />
        <meshStandardMaterial color="#d8b25a" metalness={0.7} roughness={0.4} />
      </mesh>
    </group>
  );
}

function Ceramic({ dia = 5 }: { dia?: number }) {
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 2), mm(-1.5), 0]}>
          <cylinderGeometry args={[mm(0.25), mm(0.25), mm(5), 8]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
      <mesh position={[0, mm(1.5), 0]} castShadow>
        <sphereGeometry args={[mm(dia / 2), 18, 12]} />
        <meshStandardMaterial color="#c98a2e" roughness={0.5} />
      </mesh>
      <mesh position={[0, mm(1.5), mm(dia / 2 + 0.1)]} scale={[1, 1, 0.2]}>
        <sphereGeometry args={[mm(1), 10, 8]} />
        <meshStandardMaterial color="#8a5a1a" roughness={0.6} />
      </mesh>
    </group>
  );
}

function ECap({ d = 5, h = 11 }: { d?: number; h?: number }) {
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 2), mm(-1.5), 0]}>
          <cylinderGeometry args={[mm(0.3), mm(0.3), mm(4), 8]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
      <mesh position={[0, mm(h / 2), 0]} castShadow>
        <cylinderGeometry args={[mm(d / 2), mm(d / 2), mm(h), 24]} />
        <meshStandardMaterial color="#101216" roughness={0.4} />
      </mesh>
      {/* sleeve stripe marks negative */}
      <mesh position={[mm(-d / 2 + 0.4), mm(h / 2), 0]}>
        <boxGeometry args={[mm(0.8), mm(h - 2), mm(1.2)]} />
        <meshStandardMaterial color="#c0c0c0" roughness={0.5} />
      </mesh>
      <mesh position={[0, mm(h + 0.1), 0]}>
        <cylinderGeometry args={[mm(d / 2 - 0.6), mm(d / 2 - 0.6), mm(0.4), 24]} />
        <meshStandardMaterial {...plastic('#2a2e34')} />
      </mesh>
    </group>
  );
}

function Inductor() {
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 4), mm(-1.5), 0]}>
          <cylinderGeometry args={[mm(0.3), mm(0.3), mm(5), 8]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
      <mesh position={[0, mm(2.5), 0]} castShadow>
        <cylinderGeometry args={[mm(3), mm(3), mm(4), 18]} />
        <meshStandardMaterial color="#2e7d32" roughness={0.55} />
      </mesh>
      <mesh position={[0, mm(2.5), 0]}>
        <torusGeometry args={[mm(3), mm(0.7), 10, 24]} />
        <meshStandardMaterial color="#c87f3a" metalness={0.8} roughness={0.35} />
      </mesh>
    </group>
  );
}

function Diode() {
  return (
    <group>
      <AxialLeads span={11} />
      <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[mm(1.35), mm(1.35), mm(5.2), 16]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.45} />
      </mesh>
      {/* cathode stripe */}
      <mesh position={[mm(1.8), 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[mm(1.4), mm(1.4), mm(0.8), 16]} />
        <meshStandardMaterial color="#c0c0c0" roughness={0.4} />
      </mesh>
    </group>
  );
}

function To92() {
  return (
    <group>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[mm(i * 1.27), mm(-2), 0]}>
          <boxGeometry args={[mm(0.5), mm(5), mm(0.5)]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
      <mesh position={[0, mm(2.4), 0]} castShadow>
        <cylinderGeometry args={[mm(2.4), mm(2.4), mm(4.8), 16, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#14161a" roughness={0.45} />
      </mesh>
      <mesh position={[0, mm(2.4), mm(-1.2)]}>
        <boxGeometry args={[mm(4.6), mm(4.8), mm(1.4)]} />
        <meshStandardMaterial color="#14161a" roughness={0.45} />
      </mesh>
    </group>
  );
}

function To220() {
  return (
    <group>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[mm(i * 2.54), mm(-2.5), 0]}>
          <boxGeometry args={[mm(0.8), mm(6), mm(0.8)]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
      <mesh position={[0, mm(4.5), 0]} castShadow>
        <boxGeometry args={[mm(10), mm(9), mm(4.5)]} />
        <meshStandardMaterial color="#14161a" roughness={0.45} />
      </mesh>
      {/* tab with hole */}
      <mesh position={[0, mm(11.5), 0]}>
        <boxGeometry args={[mm(10), mm(5), mm(1.2)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
      <mesh position={[0, mm(11.5), 0]}>
        <cylinderGeometry args={[mm(1.8), mm(1.8), mm(1.6), 14]} />
        <meshStandardMaterial color="#0c0d10" roughness={0.5} />
      </mesh>
    </group>
  );
}

function Dip({ pins = 8, wide = false }: { pins?: number; wide?: boolean }) {
  const per = pins / 2;
  const len = (per - 1) * 2.54 + 4;
  const w = wide ? 7.6 : 6.4;
  return (
    <group>
      <mesh position={[0, mm(1.8), 0]} castShadow>
        <boxGeometry args={[mm(len), mm(3.6), mm(w)]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      {/* pin-1 dot */}
      <mesh position={[mm(-len / 2 + 2), mm(3.65), 0]}>
        <cylinderGeometry args={[mm(0.7), mm(0.7), mm(0.15), 10]} />
        <meshStandardMaterial {...silk} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          {Array.from({ length: per }).map((_, i) => (
            <mesh
              key={i}
              position={[mm(-len / 2 + 2 + i * 2.54), mm(0.6), mm((s * (w / 2 + 0.6)))]}
            >
              <boxGeometry args={[mm(0.6), mm(2.4), mm(0.6)]} />
              <meshStandardMaterial {...pin} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Crystal() {
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[mm(s * 2), mm(-1), 0]}>
          <cylinderGeometry args={[mm(0.25), mm(0.25), mm(3), 8]} />
          <meshStandardMaterial {...pin} />
        </mesh>
      ))}
      <mesh position={[0, mm(2), 0]} castShadow>
        <boxGeometry args={[mm(11), mm(4), mm(4.6)]} />
        <meshStandardMaterial {...steel} />
      </mesh>
    </group>
  );
}

export default function Passives3D(props: PartViewProps) {
  const { kind, value, accent } = props;
  const v = value ?? accent;
  if (kind.startsWith('resistor')) return <Resistor value={v} />;
  if (kind.startsWith('cap-elec')) {
    const m = /cap-elec-([0-9a-z.]+)/.exec(kind)?.[1];
    const table: Record<string, [number, number]> = {
      '1u': [5, 11],
      '10u': [5, 11],
      '47u': [6.3, 11],
      '100u': [6.3, 11],
      '470u': [8, 12],
      '1000u': [10, 20],
    };
    const size = (m && table[m]) || [5, 11];
    return <ECap d={size[0]} h={size[1]} />;
  }
  if (kind.startsWith('cap-') || kind === 'capacitor' || kind === 'capacitor-electrolytic') {
    if (kind === 'capacitor-electrolytic') return <ECap />;
    return <Ceramic dia={5} />;
  }
  if (kind.startsWith('ind-') || kind === 'inductor') return <Inductor />;
  if (kind.startsWith('diode') || kind.startsWith('zener') || kind === 'diode') return <Diode />;
  if (
    kind.startsWith('mosfet-irf') ||
    kind.startsWith('mosfet-fqp') ||
    kind.startsWith('bjt-2n3055') ||
    kind.startsWith('reg-') ||
    kind === 'reg-lm317'
  ) {
    return <To220 />;
  }
  if (kind.startsWith('bjt-') || kind.startsWith('mosfet-') || kind.startsWith('opto')) return <To92 />;
  if (kind === 'opamp-lm324') return <Dip pins={14} wide />;
  if (kind.startsWith('opamp-')) return <Dip pins={8} />;
  if (kind === 'ne555') return <Dip pins={8} />;
  if (kind === 'cd4017' || kind === 'hc595' || kind === 'hc165') return <Dip pins={16} wide />;
  if (/^hc(00|02|04|08|14|32|86)$/.test(kind) || kind === 'cd4011') return <Dip pins={14} />;
  if (
    kind.startsWith('ic-74hc') ||
    kind.startsWith('logic-gate') ||
    kind.startsWith('flip-flop') ||
    kind === 'logic-ic' ||
    kind === 'logic-ic-wide' ||
    kind === 'custom-chip'
  ) {
    const wide = kind === 'logic-ic-wide' || /-3$|-4$/.test(kind) || kind.includes('74hc00');
    return <Dip pins={wide ? 16 : 14} wide={wide} />;
  }
  if (kind === 'crystal') return <Crystal />;
  if (kind === 'transistor-power' || kind === 'regulator') return <To220 />;
  if (kind === 'transistor' || kind === 'logic-ic') return <Dip pins={8} />;
  return <Resistor value={v} />;
}
