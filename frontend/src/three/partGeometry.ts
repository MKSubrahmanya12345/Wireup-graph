/**
 * partGeometry.ts — placement helpers for the 3D viewport.
 *
 * Dimensions resolve through dimensions.dimForKey (true datasheet outlines),
 * so an Uno is 68.6 mm and an OLED 27 mm BY CONSTRUCTION. The legacy
 * per-type table is gone; resolveBoxDimensions keeps its signature and gains
 * an optional fine key for callers that already identified the part.
 *
 * 2D → 3D fallback mapping (documented contract, true-scale edition):
 *   x3d = (x2d - 400) / 2000  →  canvas 0–800 lands on a 40 cm bench
 *   y3d = 0                   →  resting on the bench
 *   z3d = (y2d - 300) / 2000  →  canvas Y maps to 3D Z
 */

import type { NodeType } from '../types/architecture';
import { dimForKey } from './dimensions';
import type { BoxDimensions } from './dimensions';

export type { BoxDimensions };

/** Representative key per node type when the fine key is unknown. */
const TYPE_KEY: Record<NodeType, string> = {
  controller: 'esp32-devkit-v1',
  sensor: 'dht22',
  actuator: 'led',
  power: 'power-supply',
  interface: 'ssd1306',
  passive: 'resistor',
  communication: 'esp32-devkit-v1',
  software: 'generic',
  mechanical: 'servo',
  other: 'generic',
};

/**
 * Resolve the box outline for a node: explicit spatial.dimensions win,
 * otherwise the true-scale entry for the fine key (or the type fallback).
 */
export function resolveBoxDimensions(
  type: NodeType,
  spatial?: { dimensions?: { w: number; h: number; d: number } | undefined } | undefined,
  fineKey?: string,
): BoxDimensions {
  const dims = spatial?.dimensions;
  if (dims && dims.w > 0 && dims.h > 0 && dims.d > 0) {
    return { w: dims.w, h: dims.h, d: dims.d };
  }
  const entry = dimForKey(fineKey ?? TYPE_KEY[type] ?? 'generic');
  return { w: entry.w, h: entry.h, d: entry.d };
}

/**
 * Deterministic 3D position from 2D canvas coordinates when no explicit
 * spatial.position3d is available. True-scale edition: the whole 800×600
 * canvas fits on a 40×30 cm bench.
 */
export function fallbackPosition3d(x2d: number, y2d: number): { x: number; y: number; z: number } {
  return {
    x: (x2d - 400) / 2000,
    y: 0,
    z: (y2d - 300) / 2000,
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
