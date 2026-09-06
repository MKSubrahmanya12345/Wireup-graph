/**
 * archAdapter.ts — run the net solver over the ARCHITECTURE graph.
 *
 * The 2D bench solves BenchDiagrams parsed from diagram.json; the 3D view
 * renders ArchitectureNodes. This adapter re-expresses the arch graph as a
 * bench diagram (same part ids, port ids as pin names) so solveNets() +
 * commitSolved() work unchanged — wires, LEDs and IC readouts in 3D follow
 * the same nets the bench would.
 *
 * archNetKey() reproduces netKeyFor() for arch connections (empty net name
 * → endpoint-pair key), so level lookups agree exactly with the solver.
 */

import type { ArchitectureConnection, ArchitectureNode } from '../types/architecture';
import type { BenchConnection, BenchDiagram } from './diagram';

export const pinOf = (port: string | null | undefined): string => port ?? '';

/** Net key for an arch connection — identical rule to netKeyFor(). */
export function archNetKey(c: {
  from: string;
  to: string;
  fromPort: string | null;
  toPort: string | null;
}): string {
  return `~${c.from}:${pinOf(c.fromPort)}~${c.to}:${pinOf(c.toPort)}`;
}

/** Architecture graph → bench diagram (ids preserved, no DOM wiring). */
export function archToBench(
  nodes: ArchitectureNode[],
  connections: ArchitectureConnection[],
): BenchDiagram {
  return {
    source: 'arch-live',
    version: 1,
    parts: nodes.map((n) => ({
      id: n.id,
      type: `${n.partNumber ?? ''} ${n.name}`.trim() || n.id,
      tag: null,
      role: n.type,
      model: n.partNumber ?? undefined,
      attrs: {},
    })),
    connections: connections
      .filter((c) => c.from && c.to && c.from !== c.to)
      .map(
        (c): BenchConnection => ({
          fromPart: c.from,
          fromPin: pinOf(c.fromPort),
          toPart: c.to,
          toPin: pinOf(c.toPort),
          net: '',
        }),
      ),
    unrendered: [],
  };
}
