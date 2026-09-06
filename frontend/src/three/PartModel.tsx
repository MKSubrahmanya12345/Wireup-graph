/**
 * PartModel.tsx — dispatcher from graph node → true-scale parametric mesh.
 *
 * identity (partIdentity) picks the fine key, dimensions (dimForKey) the
 * true outline, family the builder. Unknown parts degrade to a correctly
 * sized generic module with a silkscreen label — never a wrong-size box,
 * never invisible.
 */

import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import type { ArchitectureNode } from '../types/architecture';
import { identifyPart } from './partIdentity';
import { dimForKey, footprintLabel } from './dimensions';
import { mm } from './parts/common';
import Boards3D from './parts/boards';
import Sensors3D from './parts/sensors';
import Displays3D from './parts/displays';
import Actuators3D from './parts/actuators';
import Passives3D from './parts/passives';
import Inputs3D from './parts/inputs';
import { chip, pcb, plastic, silk } from './materials';

export function partKeyForNode(node: ArchitectureNode): string {
  return identifyPart({ name: node.name, partNumber: node.partNumber, type: node.type }).key;
}

export function partLabelForNode(node: ArchitectureNode): string {
  return identifyPart({ name: node.name, partNumber: node.partNumber, type: node.type }).label;
}

/** LED colour hint from the node name ("green LED", "RGB red"…). */
function accentForNode(node: ArchitectureNode): string | undefined {
  const hay = `${node.name} ${node.partNumber ?? ''}`.toLowerCase();
  for (const c of ['red', 'green', 'blue', 'yellow', 'white', 'orange', 'purple']) {
    if (hay.includes(c)) return c;
  }
  return undefined;
}

/** Resistor/cap value hint from name or part number. */
function valueForNode(node: ArchitectureNode): string | undefined {
  const hay = `${node.name} ${node.partNumber ?? ''}`;
  const m = /([0-9]+(?:[.,][0-9]+)?\s*[kKmM]?\s*(?:Ω|ohm)?)\b/.exec(hay);
  return m ? m[1].replace(/\s+/g, '') : undefined;
}

function GenericModule({ w, h, d }: { w: number; h: number; d: number; label: string }) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...pcb('#0f7a3d')} />
      </mesh>
      <mesh position={[0, h + 0.0002, 0]}>
        <boxGeometry args={[w * 0.9, 0.0004, d * 0.12]} />
        <meshStandardMaterial {...silk} />
      </mesh>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w * 0.4, h * 0.5, d * 0.5]} />
        <meshStandardMaterial {...chip} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, mm(1), mm((s * d * 1000) / 2 + s * 1.2)]}>
          <boxGeometry args={[mm(w * 1000 * 0.8), mm(2), mm(2)]} />
          <meshStandardMaterial {...plastic('#101216')} />
        </mesh>
      ))}
    </group>
  );
}

interface PartModelProps {
  node: ArchitectureNode;
  /** Stable live id for sim binding (node.id in graph views, undefined in preview). */
  liveId?: string;
  selected: boolean;
  hovered: boolean;
}

export default function PartModel({ node, liveId, selected, hovered }: PartModelProps) {
  const identity = useMemo(
    () => identifyPart({ name: node.name, partNumber: node.partNumber, type: node.type }),
    [node.name, node.partNumber, node.type],
  );
  const dims = useMemo(() => dimForKey(identity.key), [identity.key]);
  const accent = useMemo(() => accentForNode(node), [node.name, node.partNumber]);
  const value = useMemo(() => valueForNode(node), [node.name, node.partNumber]);

  const body = (() => {
    const props = { kind: identity.key, liveId, accent, value };
    switch (identity.family) {
      case 'board':
        return <Boards3D {...props} />;
      case 'sensor':
        return <Sensors3D {...props} />;
      case 'display':
        return <Displays3D {...props} />;
      case 'actuator':
        return <Actuators3D {...props} />;
      case 'passive':
      case 'logic':
        return <Passives3D {...props} />;
      case 'input':
      case 'power':
      case 'bench':
        return <Inputs3D {...props} />;
      default:
        return <GenericModule w={dims.w} h={dims.h} d={dims.d} label={identity.label} />;
    }
  })();

  return (
    <group position={[0, dims.lift, 0]}>
      {body}
      {/* selection halo — a true-outline wire box, not a blob */}
      {selected ? (
        <mesh position={[0, dims.h / 2, 0]}>
          <boxGeometry args={[dims.w + 0.004, dims.h + 0.004, dims.d + 0.004]} />
          <meshBasicMaterial color="#000000" wireframe transparent opacity={0.55} />
        </mesh>
      ) : null}
      {(selected || hovered) && (
        <Html
          position={[0, dims.h + 0.018, 0]}
          center
          distanceFactor={0.55}
          zIndexRange={[20, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className="three-tag">
            <strong>{node.name}</strong>
            <span>{footprintLabel(identity.key)}</span>
          </div>
        </Html>
      )}
    </group>
  );
}
