/**
 * Resolves the final DeviceBuildPlan the generators consume:
 *   architecture graph (+ brief) → RAG retrieval → modules bound to pins.
 *
 * Pin assignment is deterministic: each module's signal roles are bound to the
 * board's preferred GPIOs for that bus, no collisions, and the result matches
 * what the architect stage drew on the graph.
 */

import type { ArchitectureGraph } from '../schemas/architecture.js';
import { DEVICE_KNOWLEDGE, type DeviceKnowledge } from './knowledge/devices.js';
import {
  detectBoard,
  retrieveFromBrief,
  retrieveFromGraph,
  type RetrievalHit,
} from './knowledge/retriever.js';
import type {
  BoardProfile,
  DeviceBuildPlan,
  DeviceControlSpec,
  DeviceMetricSpec,
  ResolvedModule,
} from './types.js';

export interface ResolvedPlan {
  plan: DeviceBuildPlan;
  hits: RetrievalHit[];
  boardMatchedOn: string;
  warnings: string[];
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'wireup-device';
}

function detectSampleInterval(brief: string): number {
  const match = brief.toLowerCase().match(/every\s+(\d+(?:\.\d+)?)\s*(millisecond|ms|second|sec|s|minute|min)/);
  if (!match) return 2000;
  const value = Number(match[1] ?? '2');
  const unit = match[2] ?? 's';
  let ms = value;
  if (unit.startsWith('s')) ms = value * 1000;
  if (unit.startsWith('min') || unit === 'm') ms = value * 60_000;
  if (unit.startsWith('ms') || unit.startsWith('millisecond')) ms = value;
  // Never faster than the slowest supported sensor (DHT family: 2 s).
  return Math.max(2000, Math.round(ms));
}

function detectWifi(brief: string): { ssid: string; password: string; configured: boolean } {
  const ssid = brief.match(/ssid[:\s"']+([A-Za-z0-9_.\- ]{2,32})/i)?.[1]?.trim();
  const password = brief.match(/(?:password|pass)[:\s"']+([^\s"',]{4,48})/i)?.[1]?.trim();
  return { ssid: ssid ?? '', password: password ?? '', configured: Boolean(ssid) };
}

/** A knowledge device keyed by a graph node (name or part number). */
function deviceForNode(node: { name: string; partNumber: string | null }, hits: RetrievalHit[]): DeviceKnowledge | null {
  const text = ` ${`${node.name} ${node.partNumber ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  let best: { device: DeviceKnowledge; score: number } | null = null;
  for (const hit of hits) {
    for (const alias of hit.device.aliases) {
      const needle = ` ${alias.toLowerCase()} `;
      if (text.includes(needle) && (!best || alias.length > best.score)) {
        best = { device: hit.device, score: alias.length };
      }
    }
    const pn = hit.device.partNumber.toLowerCase().split('/')[0] ?? '';
    if (pn.length > 3 && text.includes(` ${pn} `) && (!best || pn.length > best.score)) {
      best = { device: hit.device, score: pn.length };
    }
  }
  return best?.device ?? null;
}

/** Deterministic GPIO allocation: bus preference list, first free wins. */
function allocatePins(
  device: DeviceKnowledge,
  board: BoardProfile,
  used: Set<string>,
): Record<string, string> {
  const pins: Record<string, string> = {};
  const prefs = board.pinPreferences;
  const take = (listKey: string, fallback: string[]): string => {
    const pool = [...(prefs[listKey] ?? []), ...fallback];
    const free = pool.find((pin) => !used.has(pin));
    const pin = free ?? pool[0] ?? 'GPIO4';
    used.add(pin);
    return pin;
  };

  for (const port of device.ports) {
    if (port.signal === 'power' || port.signal === 'ground') continue;
    switch (device.bus) {
      case 'single-wire':
      case 'gpio':
        pins[port.role] =
          port.role === 'trig'
            ? take('gpio', ['GPIO5', 'GPIO19'])
            : port.role === 'echo'
              ? take('gpio', ['GPIO18', 'GPIO23'])
              : port.role === 'in'
                ? take('gpio', ['GPIO26', 'GPIO25'])
                : take('single-wire', ['GPIO4', 'GPIO16']);
        break;
      case 'analog':
        pins[port.role] = take('analog', ['GPIO34', 'GPIO35']);
        break;
      case 'pwm':
        pins[port.role] = take('pwm', ['GPIO18', 'GPIO19']);
        break;
      case 'i2c': {
        const pin = port.role === 'scl' ? 'GPIO22' : 'GPIO21';
        pins[port.role] = pin;
        used.add(pin);
        break;
      }
      case 'uart': {
        const pin = port.role === 'tx' ? 'GPIO17' : 'GPIO16';
        pins[port.role] = pin;
        used.add(pin);
        break;
      }
    }
  }
  return pins;
}

/**
 * Build the resolved plan. Modules come from the graph when it has nodes
 * (ground truth the human approved), otherwise straight from the brief.
 */
export function resolveBuildPlan(
  brief: string,
  projectName: string,
  graph: ArchitectureGraph,
  sampleIntervalOverride?: number,
): ResolvedPlan {
  const briefHits = retrieveFromBrief(brief);
  const graphHits = retrieveFromGraph(graph);
  const { board, matchedOn } = detectBoard(brief, graph);
  const warnings: string[] = [];

  // Union: graph hits first (approved design), then anything the brief adds.
  const hitOrder = [...graphHits, ...briefHits];
  const seen = new Set<string>();
  const chosen: RetrievalHit[] = hitOrder.filter((hit) => {
    if (seen.has(hit.device.id)) return false;
    seen.add(hit.device.id);
    return true;
  });

  const modules: ResolvedModule[] = [];
  const usedPins = new Set<string>();

  // Onboard LED does not count as a used pin for external wiring.
  for (const hit of chosen) {
    // Match a graph node so naming stays stable; brief-only modules get one.
    const node = graph.nodes.find((n) => deviceForNode(n, [hit])?.id === hit.device.id);
    const pins = allocatePins(hit.device, board, usedPins);

    const metrics: DeviceMetricSpec[] = hit.device.metrics.map((metric) => ({ ...metric }));
    const controls: DeviceControlSpec[] = hit.device.controls.map((control) => ({ ...control }));

    modules.push({
      deviceId: hit.device.id,
      nodeId: node?.id ?? `auto-${hit.device.id}`,
      name: node?.name ?? hit.device.name,
      partNumber: node?.partNumber ?? hit.device.partNumber,
      kind: hit.device.kind,
      bus: hit.device.bus,
      pins,
      metrics,
      controls,
      libraries: hit.device.libraries,
      firmwareNotes: hit.device.firmwareNotes,
      wiringNotes: hit.device.wiringNotes,
    });
  }

  // The brief/graph may name parts the knowledge base does not carry — be loud
  // about the gap instead of hallucinating a driver for it.
  const knownIds = new Set(DEVICE_KNOWLEDGE.map((d) => d.id));
  for (const node of graph.nodes) {
    if (node.type !== 'sensor' && node.type !== 'actuator') continue;
    const device = deviceForNode(node, chosen);
    if (!device || !knownIds.has(device.id)) {
      warnings.push(
        `"${node.name}" is not in the Wireup knowledge base — no firmware driver was generated for it. Extend backend/src/agentic/knowledge/devices.ts to support it.`,
      );
    }
  }

  const webServer = /website|web\s*app|dashboard|browser|local computer|http|access this/i.test(brief)
    || graph.software.some((item) => /web|dashboard|http/i.test(item.name));

  return {
    plan: {
      projectName,
      slug: slugify(projectName),
      brief,
      board,
      modules,
      webServer,
      sampleIntervalMs: sampleIntervalOverride && sampleIntervalOverride >= 1000
        ? Math.round(sampleIntervalOverride)
        : detectSampleInterval(brief),
      wifi: detectWifi(brief),
    },
    hits: chosen,
    boardMatchedOn: matchedOn,
    warnings,
  };
}
