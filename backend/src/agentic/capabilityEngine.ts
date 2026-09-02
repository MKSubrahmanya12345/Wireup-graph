/**
 * Generic capability decomposition — the "freestyle" half of the spec graph.
 *
 * The node SCHEMA is fixed (see specGraph.ts); the DOMAINS are not. There is
 * no hardcoded list of subsystems. Instead:
 *
 *   1. EXTRACT   — the explicit requirements the human named (parts, board,
 *                  the outcome they want), retrieved from the device KB.
 *   2. INFER     — the implicit CAPABILITIES those requirements demand.
 *                  "website on my computer" implies an off-board network path,
 *                  which implies a connectivity capability.
 *   3. GAP-CHECK — for each capability, can something already named satisfy
 *                  it? (ESP32 has Wi-Fi → no gap. Arduino Uno doesn't → gap.)
 *   4. SPAWN     — one node per gap/domain, named after the domain that fits.
 *   5. RECURSE   — a spawned node can imply further capabilities (an MQTT
 *                  connectivity node implies a broker node), until nothing new
 *                  is implied.
 *
 * Which questions survive is decided by the ASK/ASSUME GATE (§4 of the spec
 * graph design): a question is asked only when it is simultaneously blocking,
 * genuinely multi-valued with no safe default, and not inferable from anything
 * already known. Everything else is decided here and logged as an assumption.
 */

import { z } from 'zod';

import type { SpecNode } from './specGraph.js';
import { specNodeQuestionSchema } from './specGraph.js';
import { BOARD_PROFILES, type DeviceKnowledge } from './knowledge/devices.js';
import { retrieveFromBrief, type RetrievalHit } from './knowledge/retriever.js';

// ── The ask/decide gate ─────────────────────────────────────────────────────

export interface AskGateInput {
  /** Unresolved, this yields wrong or non-buildable output (bad wiring, wrong target). */
  blocking: boolean;
  /** ≥2 materially different resolutions exist and none is safely "more correct". */
  multiValued: boolean;
  /** Derivable from the brief, from resolved siblings, or from convention. */
  inferable: boolean;
  blockingReason?: string;
  multiValuedReason?: string;
  inferableReason?: string;
}

export interface AskGateVerdict {
  ask: boolean;
  blocking: boolean;
  multi_valued_no_safe_default: boolean;
  not_inferable: boolean;
  verdict: 'ask' | 'assume';
  /** Shown in the UI so a human can audit WHY the engine asked (or didn't). */
  reason: string;
}

/**
 * A node may add an open question only when ALL THREE legs hold.
 * Fail any one and the engine resolves it itself and logs an assumption.
 */
export function evaluateAskGate(input: AskGateInput): AskGateVerdict {
  const notInferable = !input.inferable;
  const ask = input.blocking && input.multiValued && notInferable;

  const reason = ask
    ? `Asked: ${input.blockingReason ?? 'leaving it unresolved produces a wrong build'}; ${input.multiValuedReason ?? 'no safe default'}; ${input.inferableReason ?? 'not derivable from the brief'}.`
    : !input.blocking
      ? `Assumed: ${input.blockingReason ?? 'the build stays correct either way — a wrong guess is recoverable and does not change the wiring or the firmware target'}.`
      : !input.multiValued
        ? `Assumed: ${input.multiValuedReason ?? 'one resolution is clearly the standard choice here'}.`
        : `Assumed: ${input.inferableReason ?? 'the brief (or a already-resolved node) determines this'}.`;

  return {
    ask,
    blocking: input.blocking,
    multi_valued_no_safe_default: input.multiValued,
    not_inferable: notInferable,
    verdict: ask ? 'ask' : 'assume',
    reason,
  };
}

// ── Decomposition context ───────────────────────────────────────────────────

export type SpecNodeQuestion = z.infer<typeof specNodeQuestionSchema>;

export interface DecomposeContext {
  /** Lowercased brief. */
  text: string;
  /** The raw brief, preserved for titles. */
  raw: string;
  answers: Record<string, string>;
  nodes: Record<string, SpecNode>;
  questionQueue: SpecNodeQuestion[];
  assumptionLog: { node_id: string; claim: string; why: string }[];
  /** Called as each node is spawned — drives the live-graph stream. */
  onNode?: (node: SpecNode) => void;
}

export interface QuestionCandidate {
  id: string;
  q: string;
  why_blocking: string;
  options: string[];
  default: string;
  gate: AskGateInput;
}

/**
 * Run one decision through the gate.
 *
 * Asked  → the question joins the node's open_questions and the project
 *          question_queue (batched, asked once, not per node).
 * Assumed → the chosen value lands in the node's spec and the decision is
 *          logged as an assumption the human can audit and override.
 *
 * Returns the value to build the node's spec with: the human's answer when
 * there is one, otherwise this candidate's default.
 */
export function resolveChoice(
  ctx: DecomposeContext,
  node: SpecNode,
  candidate: QuestionCandidate,
): string {
  const gate = evaluateAskGate(candidate.gate);
  const answered = ctx.answers[candidate.id];
  const chosen = answered ?? candidate.default;

  const question: SpecNodeQuestion = {
    id: candidate.id,
    q: candidate.q,
    why_blocking: candidate.why_blocking,
    options: candidate.options,
    default: candidate.default,
    gate,
  };

  if (gate.ask && !answered) {
    node.open_questions.push(question);
    ctx.questionQueue.push(question);
  } else {
    const claim = `${candidate.q} → ${chosen}`;
    node.assumptions.push({ claim, why: gate.reason });
    ctx.assumptionLog.push({ node_id: node.id, claim, why: gate.reason });
  }

  return chosen;
}

function logAssumption(
  ctx: DecomposeContext,
  node: SpecNode,
  claim: string,
  why: string,
): void {
  node.assumptions.push({ claim, why });
  ctx.assumptionLog.push({ node_id: node.id, claim, why });
}

// ── Board detection (broader than the buildable KB) ─────────────────────────

interface CatalogBoard {
  id: string;
  name: string;
  voltage: number;
  wifi: boolean;
  /** The Wireup pipeline can emit firmware for this target today. */
  buildable: boolean;
  patterns: RegExp[];
}

/**
 * Detection needs to know about boards the pipeline cannot (yet) build for —
 * an Arduino Uno has no radio, which is exactly the fact that makes the
 * connectivity gap question legitimate. `buildable: false` is surfaced as an
 * honest assumption rather than silently swapped for an ESP32.
 */
const BOARD_CATALOG: CatalogBoard[] = [
  {
    id: 'esp32-s3-devkit',
    name: 'ESP32-S3 DevKitC',
    voltage: 3.3,
    wifi: true,
    buildable: true,
    patterns: [/\besp32[\s-]*s3\b/, /\besp32s3\b/],
  },
  {
    id: 'esp32-devkit',
    name: 'ESP32 DevKit',
    voltage: 3.3,
    wifi: true,
    buildable: true,
    patterns: [/\besp32\b/, /\besp[\s-]*wroom\b/, /\bdevkit\s*v?\d?\b/],
  },
  {
    id: 'esp8266',
    name: 'ESP8266 (NodeMCU)',
    voltage: 3.3,
    wifi: true,
    buildable: false,
    patterns: [/\besp8266\b/, /\bnode\s?mcu\b/, /\bwemos\s?d1\b/, /\bd1\s?mini\b/],
  },
  {
    id: 'arduino-uno',
    name: 'Arduino Uno (ATmega328P)',
    voltage: 5,
    wifi: false,
    buildable: false,
    patterns: [/\barduino\s*uno\b/, /\buno\s*r?\d*\b/, /\batmega\s?328\b/],
  },
  {
    id: 'arduino-nano',
    name: 'Arduino Nano',
    voltage: 5,
    wifi: false,
    buildable: false,
    patterns: [/\barduino\s*nano\b/, /\bnano\s*(v?\d|every)\b/],
  },
  {
    id: 'rpi-pico',
    name: 'Raspberry Pi Pico (RP2040)',
    voltage: 3.3,
    wifi: false,
    buildable: false,
    patterns: [/\brpi\s*pico\b/, /\braspberry\s*pi\s*pico\b/, /\brp2040\b/, /\bpico\s*w\b/],
  },
  {
    id: 'stm32',
    name: 'STM32 (generic)',
    voltage: 3.3,
    wifi: false,
    buildable: false,
    patterns: [/\bstm32\w*\b/, /\bblue\s?pill\b/, /\bnucleo\b/],
  },
];

interface DetectedBoard extends CatalogBoard {
  matchedOn: string | null;
}

function detectBoardFromText(text: string): DetectedBoard {
  for (const board of BOARD_CATALOG) {
    for (const pattern of board.patterns) {
      if (pattern.test(text)) return { ...board, matchedOn: board.id };
    }
  }
  return { ...BOARD_CATALOG[1]!, matchedOn: null };
}

// ── Capability inference ────────────────────────────────────────────────────

/** Does the human want the device reachable from something other than a serial monitor? */
const REMOTE_VIEW = /\bwebsite|web\s*app|web\s*page|dashboard|browser|local\s*computer|my\s*pc|laptop|phone|mobile\s*app|remote|monitor\s*(it|this)|access\s*this|see\s*(it|the\s*data)|http|ui\b/i;
/** Data has to leave the local network. */
const OFF_SITE = /\bexternal|internet|anywhere|cloud|public(ly)?\s*(accessible|url)|not\s*on\s*my\s*(wifi|network)|mqtt|broker|telegram|email\s*me|away\s*from\s*home/i;
/** History persistence. */
const PERSISTENCE = /\blog(ging|s)?\b|\bhistory\b|\brecord(ing)?\b|\bsd\s*card\b|\bcsv\b|\bstore\s*(the\s*)?(data|readings)\b|\bgraph\s*over\s*time\b/i;
const BATTERY = /\bbatter(y|ies|ies-powered|y-powered)\b|\brechargeable\b|\blipo\b|\bli[\s-]?ion\b|\bsolar\b|\bportable\b|\boff[\s-]?grid\b|\b18650\b/i;
const MAINS = /\bmains\b|\bwall\s*(plug|adapter|wart)\b|\bplug(ged)?\s*in\b|\badapter\b|\b12\s?v\b|\b24\s?v\b/i;
const ENCLOSURE = /\benclosure\b|\bcase\b|\bbox\b|\bhousing\b|\b3d[\s-]?print\w*\b|\bmount(ing)?\b|\bweatherproof\b|\bip\d\d\b/i;
const ACTUATOR_HINTS: { id: string; label: string; pattern: RegExp }[] = [
  { id: 'relay', label: 'relay', pattern: /\brelay\b|\bswitch\s*(on|off)?\s*(a|the)\b|\bpump\b|\bwater(ing)?\b|\bvalve\b|\bsolenoid\b|\bfan\b|\bheater\b/ },
  { id: 'motor', label: 'motor', pattern: /\bmotor\b|\bservo\b|\bstepper\b|\bdrive\s*wheel\b|\brover\b/ },
  { id: 'buzzer', label: 'buzzer', pattern: /\bbuzzer\b|\balarm\b|\bsiren\b|\bpiezo\b|\bbeep\w*/ },
  { id: 'light', label: 'indicator', pattern: /\bled\b|\blight\b|\blamp\b|\bstrip\b|\bneopixel\b|\brgb\b/ },
];
const DISPLAY_HINT = /\boled\b|\blcd\b|\bdisplay\b|\bscreen\b|\bssd1306\b|\btft\b|\bshow\s*(it|the\s*data|readings)\s*on\b/i;

/** Rough per-part current draw, mA — enough to catch a real budget problem. */
const TYPICAL_CURRENT_MA: Record<string, number> = {
  dht22: 1.5,
  dht11: 1,
  bme280: 0.4,
  ds18b20: 1,
  'soil-moisture': 5,
  'relay-1ch': 70,
  'servo-sg90': 350,
  'led-indicator': 20,
  ssd1306: 25,
  'mq2-gas': 160,
  hcsr04: 15,
  'pir-hcsr501': 0.3,
};

/** Board 3V3 rail budget when fed from a USB port, mA. */
const USB_RAIL_BUDGET_MA = 500;

/**
 * The node id for a knowledge-base device, named after the CAPABILITY it
 * provides rather than the part number — so a BME280 and a DHT22 both land in
 * `node_temp_sensor` and the graph stays stable when a part is swapped.
 */
function deviceNodeId(device: DeviceKnowledge): string {
  const key = `${device.id} ${device.name}`.toLowerCase();

  if (device.kind === 'display') return 'node_display';
  if (device.kind === 'actuator') {
    if (/relay|pump|valve|solenoid|fan|heater/.test(key)) return 'node_relay';
    if (/servo|motor|stepper/.test(key)) return 'node_motor';
    if (/led|light|rgb|neopixel|lamp/.test(key)) return 'node_light';
    return `node_${device.id.replace(/[^a-z0-9]+/g, '_')}_actuator`;
  }

  if (/dht|bme|ds18b20|temp|humidity|pressure|baromet/.test(key)) return 'node_temp_sensor';
  if (/soil|moisture|water\s*level|capacitive/.test(key)) return 'node_soil_sensor';
  if (/mq-|gas|smoke|co2|air\s*quality/.test(key)) return 'node_gas_sensor';
  if (/hcsr04|ultrasonic|distance|range/.test(key)) return 'node_distance_sensor';
  if (/pir|motion|presence/.test(key)) return 'node_motion_sensor';
  return `node_${device.id.replace(/[^a-z0-9]+/g, '_')}_sensor`;
}

/** A second part in the same family gets its own node rather than vanishing. */
function uniqueNodeId(ctx: DecomposeContext, base: string): string {
  if (!ctx.nodes[base]) return base;
  let n = 2;
  while (ctx.nodes[`${base}_${n}`]) n += 1;
  return `${base}_${n}`;
}

function busPinPool(boardId: string, bus: string): string[] {
  const profile = BOARD_PROFILES.find((b) => b.id === boardId) ?? BOARD_PROFILES[0]!;
  switch (bus) {
    case 'i2c':
      return profile.pinPreferences.i2c ?? [];
    case 'single-wire':
      return profile.pinPreferences['single-wire'] ?? [];
    case 'analog':
      return profile.pinPreferences.analog ?? [];
    case 'pwm':
      return profile.pinPreferences.pwm ?? [];
    default:
      return profile.pinPreferences.gpio ?? [];
  }
}

/** Deterministic allocator: one pin per peripheral, walking the board's safe pool. */
function createPinAllocator(boardId: string) {
  const used = new Map<string, number>();
  return (bus: string): string => {
    const pool = busPinPool(boardId, bus);
    const next = used.get(bus) ?? 0;
    used.set(bus, next + 1);
    return pool[next] ?? pool[pool.length - 1] ?? 'GPIO4';
  };
}

function spawn(ctx: DecomposeContext, node: SpecNode): SpecNode {
  ctx.nodes[node.id] = node;
  ctx.onNode?.(node);
  return node;
}

// ── Stage 1 — controller ────────────────────────────────────────────────────

function decomposeController(ctx: DecomposeContext): DetectedBoard {
  const detected = detectBoardFromText(ctx.text);
  const named = detected.matchedOn !== null;

  const node: SpecNode = {
    id: 'node_mcu',
    domain: 'controller',
    title: `${detected.name} controller`,
    status: 'assumed',
    spec: {
      board: detected.name,
      board_id: detected.id,
      voltage: detected.voltage,
      wifi: detected.wifi,
      buildable: detected.buildable,
    },
    requires: [],
    produces: [],
    assumptions: [],
    open_questions: [],
    validation: { checked: false, issues: [] },
  };

  // Which board? Only a real fork when the brief never names one: the pin map
  // and the firmware target both change, and there is no safe default between
  // "the ESP32 everybody owns" and "the Uno on your desk".
  const choice = resolveChoice(ctx, node, {
    id: 'board',
    q: 'Which controller board are you using?',
    // (the `default` below is the detected board when the brief names one)
    why_blocking:
      'The pin map, the firmware target and the Wi-Fi capability all follow from the board — an Uno and an ESP32 produce different wiring and different code.',
    options: ['ESP32 DevKit', 'ESP32-S3 DevKitC', 'Arduino Uno', 'Raspberry Pi Pico'],
    // When the brief names a board, THAT is the default — the gate then
    // classifies it as inferable and assumes it. Only an un-named board
    // defaults to the house ESP32.
    default: detected.name,
    gate: {
      blocking: true,
      multiValued: true,
      inferable: named,
      blockingReason: 'the pin map, firmware target and radio support all depend on it',
      multiValuedReason: 'the common boards differ in radio, voltage and pin-out',
      inferableReason: named
        ? `the brief names the board (${detected.name})`
        : 'no board is named in the brief',
    },
  });

  // An answered question can override the regex-detected board.
  const resolved =
    BOARD_CATALOG.find((b) => b.name.toLowerCase() === choice.toLowerCase()) ?? detected;

  node.spec = {
    ...node.spec,
    board: resolved.name,
    board_id: resolved.id,
    voltage: resolved.voltage,
    wifi: resolved.wifi,
    buildable: resolved.buildable,
  };
  node.title = `${resolved.name} controller`;

  if (!resolved.buildable) {
    logAssumption(
      ctx,
      node,
      `Wireup's firmware pipeline targets the ESP32 family; ${resolved.name} is recorded as your board`,
      'The spec graph records the board you named. Firmware generation will flag the target migration rather than silently substituting an ESP32.',
    );
  }

  spawn(ctx, node);
  return { ...resolved, matchedOn: named ? resolved.id : null };
}

// ── Stage 2 — explicit parts, straight out of the knowledge base ─────────────

function decomposeParts(
  ctx: DecomposeContext,
  board: DetectedBoard,
  hits: RetrievalHit[],
): { peripherals: SpecNode[]; drawMa: number } {
  const allocatePin = createPinAllocator(board.id);
  const peripherals: SpecNode[] = [];
  let drawMa = 80; // the controller itself

  for (const hit of hits) {
    const device = hit.device;
    const nodeId = uniqueNodeId(ctx, deviceNodeId(device));

    const kind: 'sensor' | 'actuator' | 'display' =
      device.kind === 'actuator' ? 'actuator' : device.kind === 'display' ? 'display' : 'sensor';

    const spec: Record<string, unknown> = {
      part: device.partNumber,
      device_id: device.id,
      bus: device.bus,
      supply_v: `${device.supplyMinV}–${device.supplyMaxV} V`,
      metrics: device.metrics.map((m) => m.jsonField),
      libraries: device.libraries.map((l) => l.name),
    };

    if (device.bus === 'i2c') {
      spec.sda = allocatePin('i2c');
      spec.scl = allocatePin('i2c');
    } else if (device.bus === 'pwm') {
      spec.pin = allocatePin('pwm');
    } else if (device.bus === 'analog') {
      spec.pin = allocatePin('analog');
    } else {
      spec.pin = allocatePin(device.bus === 'single-wire' ? 'single-wire' : 'gpio');
    }

    const node: SpecNode = {
      id: nodeId,
      domain: kind,
      title: device.name,
      status: 'assumed',
      spec,
      requires: ['node_mcu'],
      produces: [],
      assumptions: [],
      open_questions: [],
      validation: { checked: false, issues: [] },
    };

    const levelShift =
      board.voltage === 3.3 && device.supplyMinV >= 4.5
        ? ' Needs 5 V and a level shifter on its data line — the ESP32 is 3.3 V tolerant at best.'
        : '';
    logAssumption(
      ctx,
      node,
      `${device.name} on ${String(spec.pin ?? String(spec.sda ?? 'GPIO4'))}${levelShift}`,
      `Retrieved from the Wireup device knowledge base on "${hit.matchedOn}" — pin, bus and driver library come from that entry, not from a guess.`,
    );

    peripherals.push(spawn(ctx, node));
    drawMa += TYPICAL_CURRENT_MA[device.id] ?? 10;
  }

  // Actuators the KB has no device entry for (a bare "pump", "fan", "buzzer").
  for (const hint of ACTUATOR_HINTS) {
    if (!hint.pattern.test(ctx.text)) continue;
    const nodeId = `node_${hint.id}`;
    if (ctx.nodes[nodeId]) continue;
    if (peripherals.some((p) => p.domain === 'actuator')) continue;

    const node: SpecNode = {
      id: nodeId,
      domain: 'actuator',
      title: `${hint.label[0]!.toUpperCase()}${hint.label.slice(1)} output stage`,
      status: 'assumed',
      spec: {
        role: hint.label,
        driven_by: board.voltage === 5 ? 'GPIO' : 'GPIO via driver',
        pin: allocatePin('gpio'),
      },
      requires: ['node_mcu'],
      produces: [],
      assumptions: [],
      open_questions: [],
      validation: { checked: false, issues: [] },
    };
    logAssumption(
      ctx,
      node,
      `${hint.label} driven from a GPIO through a driver stage`,
      'The brief asks for the behaviour but names no specific part; a driver stage is the safe default and the BOM stays editable later.',
    );
    peripherals.push(spawn(ctx, node));
    drawMa += hint.id === 'motor' ? 350 : hint.id === 'relay' ? 70 : 25;
  }

  // Discrete inputs — a button is a requirement, not a decision.
  if (/\bbutton\b|\bpush\s?button\b|\btact(ile)?\s*switch\b|\bkeypad\b|\brotary\s*encoder\b|\btouch\s*(sensor|pad)\b|\blimit\s*switch\b/i.test(ctx.text)) {
    const nodeId = 'node_inputs';
    if (!ctx.nodes[nodeId]) {
      const node: SpecNode = {
        id: nodeId,
        domain: 'input',
        title: 'Discrete input (button / switch)',
        status: 'assumed',
        spec: { pin: allocatePin('gpio'), pull: 'internal pull-up, active LOW' },
        requires: ['node_mcu'],
        produces: [],
        assumptions: [],
        open_questions: [],
        validation: { checked: false, issues: [] },
      };
      logAssumption(
        ctx,
        node,
        'Momentary input on a GPIO with the internal pull-up, read active-LOW',
        'There is exactly one conventional way to read a button on these boards. Debouncing is handled in firmware — this is a decision, not a question.',
      );
      peripherals.push(spawn(ctx, node));
    }
  }

  // A display the KB did not resolve (bare "screen"/"display").
  if (DISPLAY_HINT.test(ctx.text) && !ctx.nodes['node_display'] && !ctx.nodes['ssd1306']) {
    const node: SpecNode = {
      id: 'node_display',
      domain: 'display',
      title: 'Local readout display',
      status: 'assumed',
      spec: { bus: 'i2c', sda: allocatePin('i2c'), scl: allocatePin('i2c') },
      requires: ['node_mcu'],
      produces: [],
      assumptions: [],
      open_questions: [],
      validation: { checked: false, issues: [] },
    };
    logAssumption(
      ctx,
      node,
      'I2C readout display on the default SDA/SCL pair',
      'Seeing values on the device is useful and inert if wrong — the driver is one library call and no wiring decision depends on it.',
    );
    peripherals.push(spawn(ctx, node));
    drawMa += 25;
  }

  return { peripherals, drawMa };
}

// ── Stage 3 — implied capabilities (the gap analysis) ───────────────────────

function decomposeCapabilities(
  ctx: DecomposeContext,
  board: DetectedBoard,
  peripherals: SpecNode[],
): void {
  const wantsRemoteView = REMOTE_VIEW.test(ctx.raw) || REMOTE_VIEW.test(ctx.text);
  const wantsOffSite = OFF_SITE.test(ctx.text);
  const wantsPersistence = PERSISTENCE.test(ctx.text);

  // ── Connectivity: implied by "show me the data on something else" ─────────
  if (wantsRemoteView || wantsOffSite) {
    const node: SpecNode = {
      id: 'node_connectivity',
      domain: 'connectivity',
      title: 'Device ⇄ viewer link',
      status: 'assumed',
      spec: {},
      requires: ['node_mcu'],
      produces: ['node_software_dashboard', 'node_offsite_path'],
      assumptions: [],
      open_questions: [],
      validation: { checked: false, issues: [] },
    };

    if (board.wifi) {
      // No gap: the named board already carries a radio. The only thing the
      // engine genuinely cannot invent is the credential.
      const credsInBrief = /\bssid\b|\bpassword\b|\bwifi\s*name\b/i.test(ctx.text);
      const mode = resolveChoice(ctx, node, {
        id: 'wifi_mode',
        q: 'How should the device join your network?',
        why_blocking:
          'Wi-Fi credentials are yours to supply — they are compiled into the firmware, and a wrong guess means a device you cannot reach.',
        options: [
          "I'll put my SSID/password in config.h",
          'Device hosts its own hotspot (I connect my laptop/phone to it)',
        ],
        default: "I'll put my SSID/password in config.h",
        gate: {
          blocking: true,
          multiValued: true,
          inferable: credsInBrief,
          blockingReason: 'without credentials the firmware cannot associate and the device is unreachable',
          multiValuedReason: 'station mode and a self-hosted hotspot are materially different network topologies',
          inferableReason: credsInBrief
            ? 'the brief states the network credentials'
            : 'no SSID or password appears in the brief',
        },
      });
      node.spec = {
        transport: mode.toLowerCase().includes('hotspot')
          ? 'Wi-Fi soft-AP (device hosts the network)'
          : 'Wi-Fi station (joins your network)',
        credentials_source: 'firmware/config.h',
        onboard_radio: true,
        reach: wantsOffSite ? 'off-site' : 'local network',
      };
      logAssumption(
        ctx,
        node,
        `${board.name} carries Wi-Fi, so no extra radio is needed`,
        'The connectivity the brief implies is already satisfiable by the named board — adding a module would be redundant cost.',
      );
    } else {
      // Real gap: board cannot reach a network. This is the canonical
      // "≥2 materially different resolutions, none safely more correct" case.
      const choice = resolveChoice(ctx, node, {
        id: 'connectivity_bridge',
        q: 'Your board has no network radio — how should it reach the viewer?',
        why_blocking:
          'The brief asks for a viewable/remote result but the named board cannot reach a network. The wiring diagram and the firmware target differ completely between these paths.',
        options: [
          'Add an ESP-01/ESP8266 as a serial Wi-Fi bridge',
          'Swap the controller for an ESP32 (Wi-Fi built in)',
          'Wired Ethernet shield',
          'Drop the remote view — serial/local readout only',
        ],
        default: 'Swap the controller for an ESP32 (Wi-Fi built in)',
        gate: {
          blocking: true,
          multiValued: true,
          inferable: false,
          blockingReason: 'no network path means the requested remote view cannot be built at all',
          multiValuedReason:
            'a serial bridge, a controller swap and an Ethernet shield are three different BOMs and three different firmware targets',
          inferableReason: 'the brief asks for the outcome but never says how to reach the network',
        },
      });
      node.spec = {
        transport: choice,
        onboard_radio: false,
        reach: wantsOffSite ? 'off-site' : 'local network',
      };
    }
    spawn(ctx, node);
  }

  // ── Off-site reach implies something on the far side ─────────────────────
  if (wantsOffSite) {
    const node: SpecNode = {
      id: 'node_offsite_path',
      domain: 'connectivity',
      title: 'Off-site access path',
      status: 'assumed',
      spec: {},
      requires: ['node_connectivity'],
      produces: [],
      assumptions: [],
      open_questions: [],
      validation: { checked: false, issues: [] },
    };
    const choice = resolveChoice(ctx, node, {
      id: 'offsite_path',
      q: 'How should the data reach you when you are off your own network?',
      why_blocking:
        'Reaching the device from outside your LAN decides whether the build needs a broker, a tunnel, or a hosted endpoint — three different backends.',
      options: [
        'MQTT broker I host',
        'Public tunnel (Cloudflare/ngrok) to the on-device server',
        'Hosted cloud IoT endpoint',
      ],
      default: 'Public tunnel (Cloudflare/ngrok) to the on-device server',
      gate: {
        blocking: true,
        multiValued: true,
        inferable: false,
        blockingReason: 'each path needs a different backend, credentials set and firmware client',
        multiValuedReason: 'a broker, a tunnel and a cloud endpoint are different architectures',
        inferableReason: 'the brief says "remote" without naming a transport',
      },
    });
    node.spec = { path: choice };
    spawn(ctx, node);
  }

  // ── Software surface: implied by "I want to see it" ──────────────────────
  if (wantsRemoteView) {
    const node: SpecNode = {
      id: 'node_software_dashboard',
      domain: 'software',
      title: 'Local web dashboard',
      status: 'assumed',
      spec: {
        framework: 'React + Vite (served by the generated Express backend)',
        transport: 'HTTP JSON from the device',
        endpoints: ['/api/sensors', '/api/history', '/api/wifi'],
      },
      requires: ['node_connectivity'],
      produces: [],
      assumptions: [],
      open_questions: [],
      validation: { checked: false, issues: [] },
    };
    logAssumption(
      ctx,
      node,
      'React + Vite dashboard served by the generated Express backend',
      'The brief asks to see the data, not for a particular stack. One stack is the house default and swapping it later changes no wiring — so this is decided, not asked.',
    );
    spawn(ctx, node);
  }

  // ── Persistence: implied by "log it"/"history" ───────────────────────────
  if (wantsPersistence) {
    const node: SpecNode = {
      id: 'node_storage',
      domain: 'software',
      title: 'Reading history store',
      status: 'assumed',
      spec: { medium: 'on-device ring buffer + SQLite on the dashboard host' },
      requires: ['node_mcu'],
      produces: [],
      assumptions: [],
      open_questions: [],
      validation: { checked: false, issues: [] },
    };
    logAssumption(
      ctx,
      node,
      'Ring buffer on the device, SQLite history on the dashboard host',
      'History is a software concern with a safe, reversible default — it changes no wiring and no BOM, so it is decided rather than asked.',
    );
    spawn(ctx, node);
  }

  // ── Enclosure: only ever exists if the human raised it ───────────────────
  if (ENCLOSURE.test(ctx.text)) {
    const node: SpecNode = {
      id: 'node_enclosure',
      domain: 'mechanical',
      title: 'Enclosure / mounting',
      status: 'assumed',
      spec: { noted: true },
      requires: [],
      produces: [],
      assumptions: [],
      open_questions: [],
      validation: { checked: false, issues: [] },
    };
    logAssumption(
      ctx,
      node,
      'Enclosure noted as a requirement',
      'The brief raises it, so the domain exists — but the exact box is a fit-and-finish choice that no wiring or firmware decision depends on.',
    );
    spawn(ctx, node);
  }

  // ── Bus contention: a genuine emergent constraint ────────────────────────
  const i2cDevices = peripherals.filter((p) => p.spec['sda'] !== undefined);
  if (i2cDevices.length >= 2) {
    const addresses = new Set(i2cDevices.map((p) => String(p.spec['sda'])));
    const node: SpecNode = {
      id: 'node_bus_allocation',
      domain: 'bus_allocation',
      title: 'I2C bus allocation',
      status: 'assumed',
      spec: {
        bus: 'I2C',
        speed_khz: 400,
        devices: i2cDevices.map((p) => p.title),
        shared_sda: [...addresses].join(', '),
      },
      requires: i2cDevices.map((p) => p.id),
      produces: [],
      assumptions: [],
      open_questions: [],
      validation: { checked: false, issues: [] },
    };
    logAssumption(
      ctx,
      node,
      `${i2cDevices.length} peripherals share the I2C bus at ${[...addresses].join(', ')}`,
      'Sharing the bus is standard and address collisions are checked by the validator — this is bookkeeping, not a decision the human needs to make.',
    );
    spawn(ctx, node);
  }
}

// ── Stage 4 — power ─────────────────────────────────────────────────────────

function decomposePower(ctx: DecomposeContext, board: DetectedBoard, drawMa: number): void {
  const battery = BATTERY.test(ctx.text);
  const mains = MAINS.test(ctx.text);
  const runtimeMatch = ctx.text.match(/(\d+)\s*(hour|hr|h)\b/);
  const runtimeKnown = Boolean(runtimeMatch) || Boolean(ctx.answers['target_runtime']);

  const node: SpecNode = {
    id: 'node_power',
    domain: 'power',
    title: battery ? 'Battery supply' : 'USB / mains supply',
    status: 'assumed',
    spec: { estimated_draw_ma: Math.round(drawMa), rail_v: board.voltage },
    requires: [],
    produces: ['node_mcu'],
    assumptions: [],
    open_questions: [],
    validation: { checked: false, issues: [] },
  };

  if (battery) {
    const choice = resolveChoice(ctx, node, {
      id: 'target_runtime',
      q: 'How long should it run on one charge?',
      why_blocking:
        'Battery capacity is sized directly from the target runtime and the measured draw — guess it wrong and you buy the wrong cell.',
      options: ['A few hours', 'About a day', 'Several days / a week', 'Weeks (deep sleep)'],
      default: 'About a day',
      gate: {
        blocking: true,
        multiValued: true,
        inferable: runtimeKnown,
        blockingReason: 'cell capacity, solar panel size and the sleep schedule all follow from it',
        multiValuedReason: 'a 3-hour and a 3-week target differ by an order of magnitude of cell size and cost',
        inferableReason: runtimeKnown
          ? 'the brief states a runtime'
          : 'the brief asks for battery power without saying how long it must last',
      },
    });
    node.spec = { ...node.spec, source: 'battery', target_runtime: choice };
  } else {
    logAssumption(
      ctx,
      node,
      mains ? 'Mains / wall adapter supply' : 'USB 5 V supply',
      mains
        ? 'The brief mentions a wall adapter or a fixed rail.'
        : 'No battery or outdoor use is mentioned, so USB 5 V is the default — it needs no extra BOM line and is trivially changed later.',
    );
    node.spec = { ...node.spec, source: mains ? 'mains' : 'usb' };
  }

  // Over-budget draw is a real engineering problem, not a preference.
  if (drawMa > USB_RAIL_BUDGET_MA * 1.5 && !battery) {
    const choice = resolveChoice(ctx, node, {
      id: 'power_budget',
      q: `Estimated draw is ~${Math.round(drawMa)} mA, over the ~${USB_RAIL_BUDGET_MA} mA a USB port gives. How should it be powered?`,
      why_blocking:
        'Under-supplied rails brown out — the symptom is random resets that look like firmware bugs. The supply has to be sized before the BOM is real.',
      options: [
        'Dedicated 5 V supply rated for the load',
        'Split the load across a second regulator',
        'Reduce the load (drop a peripheral)',
      ],
      default: 'Dedicated 5 V supply rated for the load',
      gate: {
        blocking: true,
        multiValued: true,
        inferable: false,
        blockingReason: 'the rail cannot supply the summed draw of the parts already in the graph',
        multiValuedReason: 'a bigger supply, a second regulator and a smaller load are three different BOMs',
        inferableReason: 'the brief says nothing about the supply',
      },
    });
    node.spec = { ...node.spec, power_resolution: choice };
  }

  spawn(ctx, node);
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Decompose any brief — no domain whitelist, no canned question list.
 *
 * The domain names that appear are whatever the brief implies: a weather
 * station never spawns `flight_control`, and a drone never spawns
 * `soil_sensor`, with no format change between them.
 */
export function decomposeGenericProject(ctx: DecomposeContext): void {
  const board = decomposeController(ctx);

  // Ground the parts in the real knowledge base: no retrieval, no part.
  const hits = retrieveFromBrief(ctx.raw).filter((hit) => hit.device.kind !== 'other');
  const { peripherals, drawMa } = decomposeParts(ctx, board, hits);

  // Back-fill the controller's `produces` edges now the parts are known, so a
  // later change to the board propagates dirty state onto every peripheral.
  const mcu = ctx.nodes['node_mcu'];
  if (mcu) {
    mcu.produces = [...new Set([...mcu.produces, ...peripherals.map((p) => p.id)])];
    ctx.onNode?.(mcu);
  }

  decomposeCapabilities(ctx, board, peripherals);
  decomposePower(ctx, board, drawMa);

  if (hits.length === 0 && peripherals.length === 0) {
    logAssumption(
      ctx,
      ctx.nodes['node_mcu']!,
      'No sensor or actuator in the knowledge base was named in the brief',
      'The graph carries the controller and the implied capabilities only. Name the parts on your bench and re-run to fill in the wiring.',
    );
  }
}
