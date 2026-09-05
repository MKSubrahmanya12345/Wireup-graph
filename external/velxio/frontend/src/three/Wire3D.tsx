/**
 * Wire3D — a wire as a 3D polyline running under the parts (Stage 1: no sag
 * yet; Stage 4 adds catenary cables). Endpoints/waypoints are already canvas
 * coordinates, so the line is simply lifted onto the bench at WIRE_LIFT.
 */
import React, { useMemo } from 'react';
import { Line } from '@react-three/drei';
import type { Wire } from '../types/wire';

/** Height of the wire plane above the bench (world units). */
export const WIRE_LIFT = 2.5;

interface Wire3DProps {
  wire: Wire;
}

export function Wire3D({ wire }: Wire3DProps) {
  const points = useMemo<[number, number, number][]>(() => {
    const pts: [number, number, number][] = [];
    const push = (p: { x: number; y: number }) => pts.push([p.x, WIRE_LIFT, p.y]);
    push(wire.start);
    for (const wp of wire.waypoints ?? []) push(wp);
    push(wire.end);
    return pts;
  }, [wire]);

  return <Line points={points} color={wire.color} lineWidth={2.4} transparent opacity={0.92} />;
}
