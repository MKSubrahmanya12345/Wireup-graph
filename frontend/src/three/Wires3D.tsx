/**
 * Wires3D.tsx — graph connections as physical, LIVE conductors.
 *
 * Each connection becomes a catenary-ish tube between the two part bodies,
 * lifted to terminal height and arcing just enough to read as a jumper.
 * Colour follows the connection kind (power red, ground slate, data green,
 * analog blue — same key as the 2D canvas), but a net driven HIGH glows
 * green: the levels come from the same solveNets() pass that drives the
 * bench, so a 555 clocking a 4017 visibly chases down the wire. Selecting
 * a part spotlights its nets and dims the rest. Geometry is memoised per
 * wire and disposed on change so dragging parts never leaks GPU buffers.
 */

import { useEffect, useMemo } from 'react';
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import type { ArchitectureConnection, ArchitectureNode } from '../types/architecture';
import { connectionColor } from '../lib/palette';
import { archNetKey } from '../sim/archAdapter';
import { resolvePosition3d } from './partGeometry';
import { dimForKey } from './dimensions';
import { partKeyForNode } from './PartModel';

interface Wires3DProps {
  nodes: ArchitectureNode[];
  connections: ArchitectureConnection[];
  /** Solved net levels (HIGH nets glow). Absent = kind colours only. */
  levels?: Record<string, boolean>;
  /** Spotlight this node's nets; dims everything else. */
  selectedId?: string | null;
}

function WireTube({
  a,
  b,
  color,
  hot,
  dim,
}: {
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  color: string;
  hot: boolean;
  dim: boolean;
}) {
  const geom = useMemo(() => {
    const start = new Vector3(a.x, a.y, a.z);
    const end = new Vector3(b.x, b.y, b.z);
    const mid = start.clone().lerp(end, 0.5);
    const span = start.distanceTo(end);
    mid.y += Math.min(0.06, 0.012 + span * 0.12);
    const q1 = start.clone().lerp(end, 0.25);
    q1.y = Math.max(start.y, end.y) + 0.008;
    const q3 = start.clone().lerp(end, 0.75);
    q3.y = Math.max(start.y, end.y) + 0.008;
    const curve = new CatmullRomCurve3([start, q1, mid, q3, end], false, 'catmullrom', 0.4);
    return new TubeGeometry(curve, 24, 0.0009, 6, false);
  }, [a.x, a.y, a.z, b.x, b.y, b.z]);

  useEffect(() => () => geom.dispose(), [geom]);

  const ends = useMemo(
    () => [new Vector3(a.x, a.y, a.z), new Vector3(b.x, b.y, b.z)],
    [a.x, a.y, a.z, b.x, b.y, b.z],
  );

  const glow = hot ? '#22c55e' : color;
  return (
    <group>
      <mesh geometry={geom} castShadow>
        <meshStandardMaterial
          color={color}
          emissive={glow}
          emissiveIntensity={hot ? 1.4 : 0.28}
          roughness={0.42}
          metalness={0.25}
          transparent={dim}
          opacity={dim ? 0.25 : 1}
        />
      </mesh>
      {ends.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[0.0016, 10, 8]} />
          <meshStandardMaterial
            color={glow}
            emissive={glow}
            emissiveIntensity={hot ? 1 : 0}
            roughness={0.5}
            transparent={dim}
            opacity={dim ? 0.25 : 1}
          />
        </mesh>
      ))}
    </group>
  );
}

export default function Wires3D({ nodes, connections, levels, selectedId }: Wires3DProps) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const wires = useMemo(() => {
    const out: {
      id: string;
      a: { x: number; y: number; z: number };
      b: { x: number; y: number; z: number };
      color: string;
      hot: boolean;
      dim: boolean;
    }[] = [];
    for (const c of connections) {
      const from = byId.get(c.from);
      const to = byId.get(c.to);
      if (!from || !to || from.id === to.id) continue;
      const pa = resolvePosition3d(from.x, from.y, from.spatial);
      const pb = resolvePosition3d(to.x, to.y, to.spatial);
      const ha = dimForKey(partKeyForNode(from));
      const hb = dimForKey(partKeyForNode(to));
      // Terminals at the facing edges, at body mid-height.
      const dx = pb.x - pa.x;
      const dz = pb.z - pa.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len;
      const uz = dz / len;
      const hot = levels?.[archNetKey(c)] === true;
      out.push({
        id: c.id,
        a: {
          x: pa.x + ux * (ha.w / 2),
          y: Math.max(ha.lift + ha.h * 0.6, 0.006),
          z: pa.z + uz * (ha.d / 2),
        },
        b: {
          x: pb.x - ux * (hb.w / 2),
          y: Math.max(hb.lift + hb.h * 0.6, 0.006),
          z: pb.z - uz * (hb.d / 2),
        },
        color: connectionColor(c.kind),
        hot,
        dim: Boolean(selectedId) && c.from !== selectedId && c.to !== selectedId,
      });
    }
    return out;
  }, [byId, connections, levels, selectedId]);

  return (
    <group>
      {wires.map((w) => (
        <WireTube key={w.id} a={w.a} b={w.b} color={w.color} hot={w.hot} dim={w.dim} />
      ))}
    </group>
  );
}
