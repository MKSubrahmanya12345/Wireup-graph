/**
 * partGeometry.ts
 * Parametric geometry helpers for the 3D viewport.
 * Returns { w, h, d } in metres for BoxGeometry construction.
 * All callers should memoize the result — do NOT call per render.
 *
 * ??$$$ — no generative 3D here; shapes are programmatic primitives
 * keyed entirely to node type and optional spatial.dimensions.
 */

import type { NodeType } from '../types/architecture';

export interface BoxDimensions {
  w: number;
  h: number;
  d: number;
}

/** Default bounding box in metres per node type. */
const TYPE_DEFAULTS: Record<NodeType, BoxDimensions> = {
  controller:    { w: 0.07, h: 0.02, d: 0.05 }, // e.g. Arduino Nano
  sensor:        { w: 0.02, h: 0.005, d: 0.02 },
  actuator:      { w: 0.04, h: 0.04, d: 0.04 }, // e.g. servo
  power:         { w: 0.07, h: 0.02, d: 0.02 }, // e.g. 18650 cell
  interface:     { w: 0.04, h: 0.01, d: 0.04 },
  passive:       { w: 0.008, h: 0.003, d: 0.008 }, // SMD resistor/cap
  communication: { w: 0.03, h: 0.01, d: 0.02 },
  software:      { w: 0.03, h: 0.01, d: 0.03 },
  mechanical:    { w: 0.05, h: 0.03, d: 0.05 },
  other:         { w: 0.04, h: 0.015, d: 0.04 },
};

/**
 * Resolve the box dimensions for a node, preferring explicit spatial.dimensions
 * from the graph, falling back to the per-type default.
 */
export function resolveBoxDimensions(
  type: NodeType,
  spatial?: { dimensions?: { w: number; h: number; d: number } | undefined } | undefined,
): BoxDimensions {
  const dims = spatial?.dimensions;
  if (dims && dims.w > 0 && dims.h > 0 && dims.d > 0) {
    return { w: dims.w, h: dims.h, d: dims.d };
  }
  return TYPE_DEFAULTS[type] ?? TYPE_DEFAULTS.other;
}

/**
 * Derive a deterministic 3D position from 2D canvas coordinates when no
 * explicit spatial.position3d is available.
 *
 * Documented mapping (matches backend schema comment):
 *   x3d = (x2d - 400) / 200   →  ~-2 to +2 m for typical canvas range 0-800
 *   y3d = 0                    →  flat on the XZ plane
 *   z3d = (y2d - 300) / 200   →  canvas Y maps to 3D Z
 */
export function fallbackPosition3d(x2d: number, y2d: number): { x: number; y: number; z: number } {
  return {
    x: (x2d - 400) / 200,
    y: 0,
    z: (y2d - 300) / 200,
  };
}

/**
 * Resolve the 3D world position for a node, preferring spatial.position3d
 * over the deterministic 2D fallback.
 */
export function resolvePosition3d(
  x2d: number,
  y2d: number,
  spatial?: { position3d?: { x: number; y: number; z: number } } | undefined,
): { x: number; y: number; z: number } {
  const p = spatial?.position3d;
  // Both null coalescing and explicit zero check: a zero vector IS valid.
  if (p !== undefined && p !== null) return p;
  return fallbackPosition3d(x2d, y2d);
}

/**
 * Resolve 3D euler rotation, defaulting to no rotation.
 */
export function resolveRotation3d(
  spatial?: { rotation3d?: { x: number; y: number; z: number } } | undefined,
): { x: number; y: number; z: number } {
  return spatial?.rotation3d ?? { x: 0, y: 0, z: 0 };
}
