/**
 * Wire3D — a wire as a round, physical conductor.
 *
 * Endpoints/waypoints are already canvas coordinates, so the wire is lifted
 * onto the bench at WIRE_LIFT and rendered as an actual tube (a cross-section,
 * not a flat screen-space polyline) so it reads as a real jumper from any
 * angle. Corners get a smooth curve via a Catmull-Rom spine, and small ball
 * joints cap the ends where they meet a pin/lead.
 */
import { useMemo } from 'react';
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import type { Wire } from '../types/wire';

/** Height of the wire plane above the bench (world units). */
export const WIRE_LIFT = 2.5;

/** Conductor radius in world units (roughly a 22 AWG jumper at this scale). */
const RADIUS = 1.1;
/** Number of radial segments around the tube. */
const RADIAL = 8;

interface Wire3DProps {
  wire: Wire;
}

export function Wire3D({ wire }: Wire3DProps) {
  const geom = useMemo<TubeGeometry | null>(() => {
    const raw: { x: number; y: number }[] = [wire.start];
    for (const wp of wire.waypoints ?? []) raw.push(wp);
    raw.push(wire.end);
    if (raw.length < 2) return null;

    const pts = raw.map((p) => new Vector3(p.x, WIRE_LIFT, p.y));
    const curve = new CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const tubular = Math.max(8, raw.length * 10);
    return new TubeGeometry(curve, tubular, RADIUS, RADIAL, false);
  }, [wire]);

  const joints = useMemo(() => {
    const a = new Vector3(wire.start.x, WIRE_LIFT, wire.start.y);
    const b = new Vector3(wire.end.x, WIRE_LIFT, wire.end.y);
    return [a, b];
  }, [wire]);

  return (
    <group>
      {geom ? (
        <mesh geometry={geom}>
          <meshStandardMaterial
            color={wire.color}
            emissive={wire.color}
            emissiveIntensity={0.25}
            roughness={0.35}
            metalness={0.3}
          />
        </mesh>
      ) : null}
      {joints.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[RADIUS * 1.15, 8, 8]} />
          <meshStandardMaterial color={wire.color} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}
