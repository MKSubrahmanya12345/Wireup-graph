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
  PinRestriction,
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

// ── Pin safety ──────────────────────────────────────────────────────────────
// The ESP32 reads certain GPIOs at boot (strapping), has no output driver on
// ADC1 pins, and bonds GPIO6–11 to flash. Assigning a module to one of these
// produces firmware that compiles cleanly but never boots or never drives —
// a failure class no compiler can catch. The board profile carries the table;
// these helpers enforce it during allocation and graph overlay.

function pinNumber(pin: string): number | null {
  const match = pin.toUpperCase().match(/^GPIO?(\d+)$/);
  return match ? Number(match[1]) : null;
}

/** The board's engineering constraint for a pin, if any (null = free for use). */
export function pinConstraint(
  board: BoardProfile,
  pin: string,
): { restriction: PinRestriction; note: string } | null {
  const n = pinNumber(pin);
  if (n === null) return null;
  return board.gpioConstraints?.[`GPIO${n}`] ?? null;
}

/** True when the pin can drive a signal (PWM, I2C, one-wire, digital out). */
export function isOutputSafe(board: BoardProfile, pin: string): boolean {
  const constraint = pinConstraint(board, pin);
  if (!constraint) return true;
  // Input-only, flash and strapping pins are all excluded from auto-allocated
  // outputs. Strapping pins could technically work as outputs, but a module
  // that dials the wrong level at power-up prevents boot — not worth the risk
  // in generated wiring.
  return false;
}

/** True when the pin can at least be read (ADC / digital in). */
export function isInputSafe(board: BoardProfile, pin: string): boolean {
  const constraint = pinConstraint(board, pin);
  if (!constraint) return true;
  return constraint.restriction === 'input-only' || constraint.restriction === 'strapping';
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

/** Deterministic GPIO allocation: bus preference list, first safe+free wins. */
function allocatePins(
  device: DeviceKnowledge,
  board: BoardProfile,
  used: Set<string>,
  warnings: string[],
): Record<string, string> {
  const pins: Record<string, string> = {};
  const prefs = board.pinPreferences;
  const take = (
    listKey: string,
    fallback: string[],
    safe: (pin: string) => boolean,
    label: string,
  ): string => {
    const pool = [...(prefs[listKey] ?? []), ...fallback];
    // Never hand back a board-constrained pin (strapping/flash/input-only),
    // nor one another module already holds.
    const free = pool.find((pin) => !used.has(pin) && safe(pin));
    if (free) {
      used.add(free);
      return free;
    }
    // Nothing safe in the preferred pool — search every GPIO and take the
    // first legal one rather than emitting a pin that will not boot.
    for (let n = 0; n <= 48; n += 1) {
      const candidate = `GPIO${n}`;
      if (used.has(candidate) || !safe(candidate)) continue;
      used.add(candidate);
      warnings.push(
        `${device.name}: preferred ${label} pins were exhausted/unsafe — assigned ${candidate} automatically.`,
      );
      return candidate;
    }
    const lastResort = pool[0] ?? 'GPIO4';
    warnings.push(
      `${device.name}: no safe free GPIO left for ${label} — fell back to ${lastResort}, which is board-constrained. Review the wiring.`,
    );
    used.add(lastResort);
    return lastResort;
  };

  for (const port of device.ports) {
    if (port.signal === 'power' || port.signal === 'ground') continue;
    // Only an ANALOG signal is read by the MCU (it needs a readable/ADC pin).
    // Every other role — digital inputs the MCU samples (PIR, echo) AND the
    // relay IN pin — is driven or sampled on a general GPIO and must be
    // output-capable. The KB `direction` is the MODULE side (relay IN is an
    // input to the relay but the MCU drives it), so it must not decide this.
    const mcuReads = port.signal === 'analog';
    const safe = mcuReads
      ? (pin: string) => isInputSafe(board, pin)
      : (pin: string) => isOutputSafe(board, pin);
    switch (device.bus) {
      case 'single-wire':
      case 'gpio':
        pins[port.role] =
          port.role === 'trig'
            ? take('gpio', ['GPIO13', 'GPIO14', 'GPIO27'], safe, `${port.role} (trigger)`)
            : port.role === 'echo'
              ? take('gpio', ['GPIO14', 'GPIO27', 'GPIO33'], safe, `${port.role} (echo)`)
              : port.role === 'in'
                ? take('gpio', ['GPIO26', 'GPIO25', 'GPIO33'], safe, port.role)
                : take('single-wire', ['GPIO4', 'GPIO16'], safe, port.role);
        break;
      case 'analog':
        pins[port.role] = take('analog', ['GPIO34', 'GPIO35', 'GPIO32', 'GPIO33'], safe, port.role);
        break;
      case 'pwm':
        pins[port.role] = take('pwm', ['GPIO18', 'GPIO19', 'GPIO25', 'GPIO26'], safe, port.role);
        break;
      case 'i2c': {
        // The default I2C bus is SDA=21/SCL=22 on both profiles — both safe.
        const pin = port.role === 'scl' ? 'GPIO22' : 'GPIO21';
        if (!isOutputSafe(board, pin) || used.has(pin)) {
          const reassigned = take('gpio', ['GPIO13', 'GPIO14'], safe, `i2c ${port.role}`);
          pins[port.role] = reassigned;
        } else {
          pins[port.role] = pin;
          used.add(pin);
        }
        break;
      }
      case 'uart': {
        // TX drives; RX is an input. Both UART pins default safe on the profiles.
        const defaultPin = port.role === 'tx' ? 'GPIO17' : 'GPIO16';
        if (!safe(defaultPin) || used.has(defaultPin)) {
          pins[port.role] = take('gpio', ['GPIO13', 'GPIO14'], safe, `uart ${port.role}`);
        } else {
          pins[port.role] = defaultPin;
          used.add(defaultPin);
        }
        break;
      }
    }
  }
  return pins;
}

const PIN_NAME = /(GPIO\d+|ADC\d+|VP|VN)\b/i;

/**
 * The graph the human approved on page 02 is the pin-level ground truth.
 * Its port labels ("DATA → GPIO16") and connection labels carry the pin
 * assignments — overlay them onto the KB defaults so firmware/config.h
 * matches what the graph draws. Anything that does not look like a pin is
 * ignored.
 */
function overlayGraphPins(
  node: ArchitectureGraph['nodes'][number] | undefined,
  graph: ArchitectureGraph,
  allocated: Record<string, string>,
  board: BoardProfile,
  device: DeviceKnowledge,
  warnings: string[],
): Record<string, string> {
  if (!node) return allocated;
  const pins = { ...allocated };
  const seenWarnings = new Set<string>();
  // Every signal role this device owns — union of the KB port roles and the
  // roles already allocated, so a graph that names a role by a slightly
  // different convention still validates against the board constraints.
  const knownRoles = new Set([
    ...device.ports.map((p) => p.role),
    ...Object.keys(pins),
  ]);
  const apply = (role: string | null, pin: string) => {
    if (!role) return;
    const normalised = pin.toUpperCase();
    if (!knownRoles.has(role)) {
      // Unknown role on a recognised node — trust the auto-assigned wiring.
      return;
    }
    // Respect a pin the human deliberately drew, but flag board-constrained
    // choices (strapping/flash/input-only) instead of silently burning them
    // into firmware — the compiler can never catch a bad strapping level.
    const port = device.ports.find((p) => p.role === role);
    // Analog signals are read by the MCU (need a readable pin); everything
    // else, including a relay's "IN" pin, is driven by the MCU.
    const mcuDrives = port ? port.signal !== 'analog' : true;
    const ok = mcuDrives ? isOutputSafe(board, normalised) : isInputSafe(board, normalised);
    if (!ok) {
      const constraint = pinConstraint(board, normalised);
      const key = `${role}:${normalised}`;
      if (!seenWarnings.has(key)) {
        seenWarnings.add(key);
        warnings.push(
          `${device.name}: the graph pins ${role} to ${normalised}, but that is a ${constraint?.restriction ?? 'restricted'} pin (${constraint?.note ?? 'board-limited'}). Firmware keeps the safe auto-assigned ${pins[role] ?? 'pin'} — change the graph to a free GPIO.`,
        );
      }
      return;
    }
    pins[role] = normalised;
  };

  for (const port of node.ports ?? []) {
    const match = port.label?.match(/→\s*([A-Za-z0-9]+)/);
    if (!match || !PIN_NAME.test(match[1] ?? '')) continue;
    // Port ids are "<nodeId>-<role>" (e.g. "sensor-dht22-data") — the last
    // segment names the signal role, but the graph's spelling can differ from
    // the KB port role; fall back to the device's single signal port.
    let role = (port.id ?? '').split('-').pop()?.toLowerCase() ?? '';
    if (!knownRoles.has(role)) {
      const signalPorts = device.ports.filter(
        (p) => p.signal !== 'power' && p.signal !== 'ground',
      );
      role = signalPorts.length === 1 ? signalPorts[0]!.role : role;
    }
    apply(role, match[1]!.toUpperCase());
  }
  for (const connection of graph.connections) {
    if (connection.from !== node.id && connection.to !== node.id) continue;
    const label = connection.label?.trim() ?? '';
    if (!PIN_NAME.test(label)) continue;
    const portRef = connection.from === node.id ? connection.fromPort : connection.toPort;
    let role = (portRef ?? '').split('-').pop()?.toLowerCase() ?? '';
    // The graph port-id tail ("...-sig"/"...-data") may spell the role
    // differently than this device's KB port role — fall back to the device's
    // single signal (non-power/ground) port so the constraint still applies.
    if (!knownRoles.has(role)) {
      const signalPorts = device.ports.filter(
        (p) => p.signal !== 'power' && p.signal !== 'ground',
      );
      role = signalPorts.length === 1 ? signalPorts[0]!.role : role;
    }
    apply(role, label.toUpperCase());
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

  // A graph that genuinely carries TWO of the same part cannot be built
  // (shared globals/routes would collide) — say so instead of silently
  // keeping the first.
  const graphNodeCounts = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.type !== 'sensor' && node.type !== 'actuator' && node.type !== 'interface') continue;
    const device = deviceForNode(node, graphHits);
    if (device) graphNodeCounts.set(device.id, (graphNodeCounts.get(device.id) ?? 0) + 1);
  }
  for (const [deviceId, count] of graphNodeCounts) {
    if (count < 2) continue;
    const device = DEVICE_KNOWLEDGE.find((d) => d.id === deviceId);
    warnings.push(
      `The graph contains ${count} ${device?.name ?? deviceId} nodes — only one per build is supported, the first is used.`,
    );
  }

  // Union: graph hits first (approved design), then anything the brief adds.
  // Brief + graph both naming the same part is the NORMAL flow — deduped
  // silently.
  const hitOrder = [...graphHits, ...briefHits];
  const seen = new Set<string>();
  const chosen: RetrievalHit[] = hitOrder.filter((hit) => {
    if (seen.has(hit.device.id)) return false;
    seen.add(hit.device.id);
    return true;
  });

  const modules: ResolvedModule[] = [];
  const usedPins = new Set<string>();

  for (const hit of chosen) {
    // Match a graph node so naming stays stable; brief-only modules get one.
    const node = graph.nodes.find((n) => deviceForNode(n, [hit])?.id === hit.device.id);
    const allocated = allocatePins(hit.device, board, usedPins, warnings);
    const pins = overlayGraphPins(node, graph, allocated, board, hit.device, warnings);
    // Everything the graph pinned counts as taken — later modules must not
    // silently collide with a pin the human chose.
    for (const pin of Object.values(pins)) usedPins.add(pin);

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
