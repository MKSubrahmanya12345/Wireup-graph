/**
 * Dependency-aware layered layout for the Spec Graph canvas.
 *
 * This is presentation only: it reads the AI-produced `requires`/`spawned`
 * edges and lays them out as a left-to-right hierarchy. Sources (nodes with no
 * `requires`) sit on the left; dependents fan out to the right by depth.
 * `spawned`-only children are anchored beside their spawner.
 */

import type { SpecGraphProject, SpecNode } from '../types/specGraph';

export interface LayoutPosition {
  x: number;
  y: number;
}

const COLUMN_GAP = 320;
const ROW_GAP = 150;
const MID_Y = 360;

export function layoutSpecGraph(specGraph: SpecGraphProject): Record<string, LayoutPosition> {
  const entries: SpecNode[] = Object.values(specGraph.nodes);
  if (entries.length === 0) return {};

  const depth = new Map<string, number>();

  const computeDepth = (id: string, stack: Set<string>): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (stack.has(id)) {
      depth.set(id, 0);
      return 0;
    }
    stack.add(id);
    const node = specGraph.nodes[id];
    const deps = node?.requires ?? [];
    const result =
      deps.length === 0
        ? 0
        : 1 + Math.max(...deps.map((depId) => computeDepth(depId, stack)));
    stack.delete(id);
    depth.set(id, result);
    return result;
  };

  for (const node of entries) computeDepth(node.id, new Set());

  // `spawned`-only nodes (no `requires`) are anchored one column after their
  // spawner rather than being dumped on the source column.
  for (const node of entries) {
    if ((node.requires?.length ?? 0) > 0) continue;
    const spawner = entries.find((other) => (other.spawned ?? []).includes(node.id));
    if (spawner) depth.set(node.id, (depth.get(spawner.id) ?? 0) + 1);
  }

  const byLayer = new Map<number, SpecNode[]>();
  for (const node of entries) {
    const layer = depth.get(node.id) ?? 0;
    const list = byLayer.get(layer) ?? [];
    list.push(node);
    byLayer.set(layer, list);
  }

  const layers = [...byLayer.keys()].sort((a, b) => a - b);

  // Order within each layer by the barycenter of parent positions (a couple of
  // sweeps) to reduce edge crossings.
  const order = new Map<string, number>();
  for (const layer of layers) {
    const members = byLayer.get(layer) ?? [];
    for (const node of members) {
      const parents = (node.requires ?? []).filter((id) => specGraph.nodes[id]);
      if (parents.length === 0) {
        order.set(node.id, members.indexOf(node));
        continue;
      }
      let sum = 0;
      let count = 0;
      for (const parent of parents) {
        const idx = order.get(parent);
        if (idx !== undefined) {
          sum += idx;
          count += 1;
        }
      }
      order.set(node.id, count > 0 ? sum / count : members.indexOf(node));
    }
    // Re-sort this layer by computed barycenter.
    members.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    members.forEach((node, index) => order.set(node.id, index));
  }

  const positions: Record<string, LayoutPosition> = {};
  for (const layer of layers) {
    const members = byLayer.get(layer) ?? [];
    const startY = MID_Y - ((members.length - 1) * ROW_GAP) / 2;
    members.forEach((node, index) => {
      positions[node.id] = {
        x: 40 + layer * COLUMN_GAP,
        y: startY + index * ROW_GAP,
      };
    });
  }

  return positions;
}
