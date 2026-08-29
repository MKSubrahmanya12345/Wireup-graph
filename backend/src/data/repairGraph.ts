import {
  architectureGraphSchema,
  type ArchitectureGraph,
  type ArchitectureNode,
} from '../schemas/architecture.js';

/**
 * Deterministic repair pass over raw LLM output.
 *
 * The planner is a language model, so its JSON is *nearly* right: port
 * references arrive as labels instead of ids, ids get reused, an endpoint
 * points at a node it forgot to emit, coordinates are omitted. None of that
 * is a reason to fail the request — but all of it silently breaks the graph
 * the human is looking at.
 *
 * Everything here is pure arithmetic and string matching. No tokens, no
 * opinions, and every change is recorded so the UI can say what happened
 * instead of quietly disagreeing with the model.
 *
 * Repairs are always *conservative*: they prefer to detach a connection from
 * an unknown port (keeping the connection visible) over dropping it, and they
 * never move a node that already has usable coordinates.
 */

export type RepairCode =
  | 'NODE_DUPLICATE_ID'
  | 'NODE_MISSING_ID'
  | 'PORT_MISSING_ID'
  | 'PORT_ID_DUPLICATE'
  | 'PORT_REF_RESOLVED'
  | 'PORT_REF_DROPPED'
  | 'CONNECTION_DANGLING'
  | 'CONNECTION_SELF_LOOP'
  | 'CONNECTION_DUPLICATE_ID'
  | 'CONNECTION_DUPLICATE_PAIR'
  | 'NODE_POSITION_ASSIGNED'
  | 'NODE_OVERLAP_SEPARATED';

export type RepairSeverity = 'info' | 'warning';

export interface RepairRecord {
  code: RepairCode;
  severity: RepairSeverity;
  /** Short human-readable sentence, safe to show to a non-technical user. */
  message: string;
  /** Canonical node/connection id the repair touched, when there is one. */
  targetId?: string;
}

export interface RepairResult {
  graph: ArchitectureGraph;
  repairs: RepairRecord[];
}

/** Raw, pre-default shape. Deliberately loose — the schema validates later. */
interface RawPort {
  id?: unknown;
  label?: unknown;
  direction?: unknown;
  signal?: unknown;
}

interface RawNode {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  partNumber?: unknown;
  x?: unknown;
  y?: unknown;
  description?: unknown;
  ports?: unknown;
  [key: string]: unknown;
}

interface RawConnection {
  id?: unknown;
  from?: unknown;
  to?: unknown;
  fromPort?: unknown;
  toPort?: unknown;
  [key: string]: unknown;
}

/** Just enough shape for the layering pass, which only reads ids and types. */
interface LayoutInput {
  nodes: { id: string; type: string }[];
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim();

const num = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const slugify = (value: string, fallback: string): string => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
};

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Case/punctuation-insensitive key, so "GPIO 4", "gpio4" and "GPIO4" match. */
function portKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Builds the lookup used to resolve a connection's port reference.
 *
 * The planner is told to emit `"fromPort": "port-id or signal name"`, and in
 * practice it sends a mix of ids, labels and signal names. We index every
 * plausible spelling so the common case resolves instead of floating.
 */
function indexPorts(ports: RawPort[]): Map<string, number> {
  const index = new Map<string, number>();
  ports.forEach((port, position) => {
    const candidates = [port.id, port.label].map(text).filter(Boolean);
    for (const candidate of candidates) {
      const key = portKey(candidate);
      // First declaration wins: stable and predictable.
      if (key && !index.has(key)) index.set(key, position);
    }
    const signal = text(port.signal);
    if (signal) {
      const key = portKey(signal);
      if (key && !index.has(key)) index.set(key, position);
    }
  });
  return index;
}

// ---- layout ---------------------------------------------------------------

/** Column order: energy flows left → right, which reads like a schematic. */
const LAYER_ORDER: Record<string, number> = {
  power: 0,
  passive: 1,
  controller: 2,
  communication: 3,
  interface: 3,
  sensor: 4,
  actuator: 4,
  mechanical: 5,
  software: 6,
  other: 6,
};

const COLUMN_GAP = 300;
const ROW_GAP = 150;
const ORIGIN_X = 80;
const ORIGIN_Y = 70;
/** Below this separation two nodes are visually stacked. */
const MIN_SEPARATION = 60;

function layoutLayers(graph: LayoutInput): Map<string, { x: number; y: number }> {
  const layerOf = (type: string): number => LAYER_ORDER[type] ?? 6;

  const buckets = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const layer = layerOf(node.type);
    if (!buckets.has(layer)) buckets.set(layer, []);
    buckets.get(layer)!.push(node.id);
  }

  const placed = new Map<string, { x: number; y: number }>();
  const orderedLayers = [...buckets.keys()].sort((a, b) => a - b);

  orderedLayers.forEach((layer, columnIndex) => {
    const ids = buckets.get(layer)!;
    ids.forEach((id, rowIndex) => {
      placed.set(id, {
        x: ORIGIN_X + columnIndex * COLUMN_GAP,
        y: ORIGIN_Y + rowIndex * ROW_GAP,
      });
    });
  });

  return placed;
}

function separated(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) >= MIN_SEPARATION || Math.abs(a.y - b.y) >= MIN_SEPARATION;
}

/**
 * Pushes visually stacked nodes apart.
 *
 * Nodes are processed in order and each one is tested against everything
 * already settled, so a pile of five nodes at the same coordinate fans out
 * instead of oscillating. The first node always keeps its position.
 */
function deoverlap(nodes: ArchitectureNode[]): {
  positions: Map<string, { x: number; y: number }>;
  moved: { node: ArchitectureNode; blockedBy: ArchitectureNode }[];
} {
  const settled: { node: ArchitectureNode; x: number; y: number }[] = [];
  const positions = new Map<string, { x: number; y: number }>();
  const moved: { node: ArchitectureNode; blockedBy: ArchitectureNode }[] = [];

  for (const node of nodes) {
    const blocker = settled.find((entry) => !separated(entry, node));

    if (!blocker) {
      settled.push({ node, x: node.x, y: node.y });
      positions.set(node.id, { x: node.x, y: node.y });
      continue;
    }

    // First slot clear of everything settled so far, scanning right along the
    // blocker's row and then down a row at a time.
    let x = blocker.x;
    let y = blocker.y;
    let clear = false;
    while (!clear) {
      x += COLUMN_GAP;
      clear = settled.every((entry) => separated(entry, { x, y }));
      if (clear) break;
      if (x - blocker.x >= COLUMN_GAP * 4) {
        x = blocker.x;
        y += ROW_GAP;
      }
    }

    settled.push({ node, x, y });
    positions.set(node.id, { x, y });
    moved.push({ node, blockedBy: blocker.node });
  }

  return { positions, moved };
}

// ---- the pass -------------------------------------------------------------

/**
 * Repairs raw planner output, then validates it with the canonical schema.
 *
 * Throws only when the payload is not remotely graph-shaped (no object, no
 * node array) — that is a genuine upstream failure, not something to paper over.
 */
export function repairGraph(raw: unknown): RepairResult {
  const source = (raw ?? {}) as Record<string, unknown>;
  const rawNodes = asArray<RawNode>(source.nodes);
  const rawConnections = asArray<RawConnection>(source.connections);

  const repairs: RepairRecord[] = [];

  // ---- 1. nodes: stable, unique, non-empty ids -----------------------------
  const usedIds = new Set<string>();
  const nodes: RawNode[] = [];

  rawNodes.forEach((node, index) => {
    const copy: RawNode = { ...node };
    let id = text(copy.id);

    if (!id) {
      id = slugify(`${text(copy.name) || text(copy.type) || 'component'}-${index + 1}`, `node-${index + 1}`);
      copy.id = id;
      repairs.push({
        code: 'NODE_MISSING_ID',
        severity: 'warning',
        message: `A component (${text(copy.name) || 'unnamed'}) had no id, so it was given "${id}".`,
        targetId: id,
      });
    }

    if (usedIds.has(id)) {
      const base = id;
      let suffix = 2;
      while (usedIds.has(`${base}-${suffix}`)) suffix += 1;
      id = `${base}-${suffix}`;
      copy.id = id;
      repairs.push({
        code: 'NODE_DUPLICATE_ID',
        severity: 'warning',
        message: `Two components shared the id "${base}"; the second is now "${id}".`,
        targetId: id,
      });
    }

    usedIds.add(id);
    nodes.push(copy);
  });

  // ---- 2. ports: every port needs an id connections can point at ----------
  const portIndexByNode = new Map<string, Map<string, number>>();
  const idToNode = new Map<string, RawNode>();

  for (const node of nodes) {
    const id = text(node.id);
    idToNode.set(id, node);

    const rawPorts = asArray<RawPort>(node.ports);
    const usedPortIds = new Set<string>();
    const ports = rawPorts.map((port, portPosition) => {
      const copy: RawPort = { ...port };
      let portId = text(copy.id);
      const label = text(copy.label);

      if (!portId) {
        portId = slugify(label, `port-${portPosition + 1}`);
        copy.id = portId;
        repairs.push({
          code: 'PORT_MISSING_ID',
          severity: 'info',
          message: `${text(node.name) || id}: a pin had no id, so "${label || portId}" now identifies it.`,
          targetId: id,
        });
      }

      if (usedPortIds.has(portId)) {
        const base = portId;
        let suffix = 2;
        while (usedPortIds.has(`${base}-${suffix}`)) suffix += 1;
        portId = `${base}-${suffix}`;
        copy.id = portId;
        repairs.push({
          code: 'PORT_ID_DUPLICATE',
          severity: 'info',
          message: `${text(node.name) || id}: duplicate pin id "${base}" renamed to "${portId}".`,
          targetId: id,
        });
      }

      usedPortIds.add(portId);
      return copy;
    });

    node.ports = ports;
    portIndexByNode.set(id, indexPorts(ports));
  }

  // ---- 3. connections: resolvable endpoints, unique ids, real ports -------
  const usedConnectionIds = new Set<string>();
  const seenPairs = new Set<string>();
  const connections: RawConnection[] = [];

  for (const connection of rawConnections) {
    const from = text(connection.from);
    const to = text(connection.to);
    const label = text(connection.label) || 'link';

    if (!from || !to || !idToNode.has(from) || !idToNode.has(to)) {
      repairs.push({
        code: 'CONNECTION_DANGLING',
        severity: 'warning',
        message: `Dropped a link (${from || '?'} → ${to || '?'}, "${label}") because one end is not a component in this design.`,
      });
      continue;
    }

    if (from === to) {
      repairs.push({
        code: 'CONNECTION_SELF_LOOP',
        severity: 'warning',
        message: `Dropped a link from ${text(idToNode.get(from)?.name) || from} back to itself ("${label}").`,
        targetId: from,
      });
      continue;
    }

    const copy: RawConnection = { ...connection };

    // Ports: resolve labels/signals to the real port id, else detach.
    for (const side of ['from', 'to'] as const) {
      const field = side === 'from' ? 'fromPort' : 'toPort';
      const reference = text(copy[field]);
      if (!reference) {
        copy[field] = null;
        continue;
      }

      const nodeId = side === 'from' ? from : to;
      const index = portIndexByNode.get(nodeId);
      const position = index?.get(portKey(reference));

      if (position === undefined) {
        // Keep the link, drop the pin: a floating edge is a visible defect the
        // human can fix, a vanished connection is not.
        copy[field] = null;
        repairs.push({
          code: 'PORT_REF_DROPPED',
          severity: 'warning',
          message: `"${label}": ${text(idToNode.get(nodeId)?.name) || nodeId} has no pin called "${reference}", so the link is attached to the component instead of a specific pin.`,
          targetId: nodeId,
        });
        continue;
      }

      const resolvedId = text(asArray<RawPort>(idToNode.get(nodeId)?.ports)[position]?.id);
      if (resolvedId !== reference) {
        copy[field] = resolvedId;
        repairs.push({
          code: 'PORT_REF_RESOLVED',
          severity: 'info',
          message: `"${label}": matched "${reference}" to the ${text(idToNode.get(nodeId)?.name) || nodeId} pin "${resolvedId}".`,
          targetId: nodeId,
        });
      }
    }

    // Unique connection ids.
    let id = text(copy.id);
    if (!id) id = slugify(`${from}-${to}-${label}`, `${from}-${to}`);
    if (usedConnectionIds.has(id)) {
      const base = id;
      let suffix = 2;
      while (usedConnectionIds.has(`${base}-${suffix}`)) suffix += 1;
      id = `${base}-${suffix}`;
      copy.id = id;
      repairs.push({
        code: 'CONNECTION_DUPLICATE_ID',
        severity: 'warning',
        message: `Two links shared the id "${base}"; the second is now "${id}".`,
        targetId: id,
      });
    } else {
      copy.id = id;
    }
    usedConnectionIds.add(id);

    // Exact-duplicate wiring (same endpoints, ports and kind) is noise.
    const pairKey = [from, to, text(copy.fromPort), text(copy.toPort), text(copy.kind)].join('|');
    if (seenPairs.has(pairKey)) {
      repairs.push({
        code: 'CONNECTION_DUPLICATE_PAIR',
        severity: 'info',
        message: `Removed a duplicate link between ${from} and ${to} ("${label}").`,
        targetId: id,
      });
      continue;
    }
    seenPairs.add(pairKey);

    connections.push(copy);
  }

  // ---- 4. coordinates ------------------------------------------------------
  // Only nodes with no usable coordinate get placed. A user-dragged node keeps
  // its position, which the planner is explicitly told to preserve.
  const needsLayout = (node: RawNode): boolean =>
    num(node.x) === undefined || num(node.y) === undefined;

  const missing = nodes.filter(needsLayout);
  if (missing.length) {
    const placed = layoutLayers({
      nodes: nodes.map((node) => ({ id: text(node.id), type: text(node.type) })),
    });
    for (const node of missing) {
      const position = placed.get(text(node.id));
      if (!position) continue;
      node.x = position.x;
      node.y = position.y;
      repairs.push({
        code: 'NODE_POSITION_ASSIGNED',
        severity: 'info',
        message: `${text(node.name) || text(node.id)} had no position on the canvas, so it was placed automatically.`,
        targetId: text(node.id),
      });
    }
  }

  // ---- 5. validate, then de-overlap ---------------------------------------
  const parsed = architectureGraphSchema.safeParse({ ...source, nodes, connections });
  if (!parsed.success) {
    throw new Error(
      `Planner returned a graph that could not be repaired: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'graph'}: ${issue.message}`)
        .join('; ')}`,
    );
  }

  const graph = parsed.data;

  // Nudge stacked nodes apart. Deterministic, and it never touches a node that
  // is already clear of every other node.
  const { positions, moved } = deoverlap(graph.nodes);
  for (const move of moved) {
    repairs.push({
      code: 'NODE_OVERLAP_SEPARATED',
      severity: 'info',
      message: `${move.node.name} was stacked on top of ${move.blockedBy.name}; it was moved aside.`,
      targetId: move.node.id,
    });
  }

  const repaired: ArchitectureGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const position = positions.get(node.id)!;
      return position.x === node.x && position.y === node.y
        ? node
        : { ...node, x: Math.round(position.x), y: Math.round(position.y) };
    }),
  };

  return { graph: repaired, repairs };
}
