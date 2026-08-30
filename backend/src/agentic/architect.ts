/**
 * Deterministic architect — the no-LLM engine behind /interpret and /plan.
 *
 * The agentic standard this repo holds itself to: the planner is a knowledge
 * engine with engineering rules, not an API call. Only parts retrieved from
 * the knowledge base enter the graph; the graph is then run through the same
 * engineering checks + structural verifier every path uses.
 */

import {
  catalogMatches,
  catalogSources,
  officialComponentCatalog,
} from '../data/componentCatalog.js';
import { runStructuralChecks } from '../data/architectureVerifier.js';
import { hasBlockingIssue, runEngineeringChecks, type Issue } from '../data/engineeringRules.js';
import type { PlanResult } from '../services/architectureService.js';
import type {
  ArchitectureConnection,
  ArchitectureGraph,
  ArchitectureNode,
  VerificationReport,
} from '../schemas/architecture.js';
import type {
  InterpretResponse,
  Question,
  RequirementsSpec,
} from '../schemas/requirements.js';
import { DEVICE_KNOWLEDGE, type DeviceKnowledge } from './knowledge/devices.js';
import { detectBoard, retrieveFromBrief, type RetrievalHit } from './knowledge/retriever.js';
import { resolveBuildPlan, slugify } from './planResolver.js';

// ── Interpret ───────────────────────────────────────────────────────────────

function projectNameFor(brief: string, hits: RetrievalHit[]): string {
  if (/\bweather|environment|climate/.test(brief.toLowerCase())) return 'Environmental Monitor';
  const first = hits[0];
  if (first) {
    const main =
      first.device.id === 'dht22'
        ? 'DHT22'
        : (first.device.name.split(' ')[0] ?? 'Device').toUpperCase();
    return `${main} Monitor`;
  }
  return 'Wireup Device';
}

function domainFor(brief: string, hits: RetrievalHit[]): string {
  const text = brief.toLowerCase();
  if (/plant|soil|garden|irrigation/.test(text)) return 'agriculture';
  if (/weather|environment|temperature|humidity|climate/.test(text)) return 'environmental-monitoring';
  if (/motion|security|pir|alarm/.test(text)) return 'security';
  if (/gas|smoke|air quality/.test(text)) return 'safety';
  if (hits.length > 0) return 'sensing';
  return 'general';
}

/** Only ask what genuinely changes the design. */
function questionsFor(
  brief: string,
  hits: RetrievalHit[],
  boardName: string,
  webIntent: boolean,
): Question[] {
  const questions: Question[] = [];
  const text = brief.toLowerCase();

  if (!/esp32|esp32-s3/i.test(brief)) {
    questions.push({
      id: 'board',
      prompt: 'Which controller board are you using?',
      why: 'Pin map, Wi-Fi capability and the firmware template all depend on the board. The brief does not name one.',
      impact: 'Changes every GPIO assignment and the platformio.ini target.',
      kind: 'single',
      options: [
        { value: 'esp32', label: 'ESP32 DevKit', hint: 'Most common — Wi-Fi + BT, 3.3 V logic' },
        { value: 'esp32-s3', label: 'ESP32-S3 DevKitC', hint: 'Newer core, native USB' },
      ],
      default: 'esp32',
    });
  }

  if (webIntent && !/ssid|password/i.test(text)) {
    questions.push({
      id: 'wifi',
      prompt: 'How should the device join your network?',
      why: 'The dashboard reaches the device over Wi-Fi — credentials are flashed into firmware/config.h, and they are yours, not something to invent.',
      impact: 'Determines whether a fallback hotspot is the primary way in.',
      kind: 'single',
      options: [
        { value: 'later', label: "I'll set SSID/password in config.h", hint: 'Device joins your Wi-Fi once flashed' },
        { value: 'fallback-ap', label: 'Use the device hotspot', hint: 'Connect your laptop to the board’s own network' },
      ],
      default: 'later',
    });
  }

  if (webIntent && hits.length > 0 && !/every\s+\d+/.test(text)) {
    questions.push({
      id: 'sample-interval',
      prompt: 'How often should the device sample its sensors?',
      why: 'The DHT family cannot be read faster than once per 2 s; faster polling just returns stale values.',
      impact: 'Sets SAMPLE_INTERVAL_MS in firmware and the dashboard refresh rate.',
      kind: 'number',
      options: [],
      default: '2000',
      unit: 'ms',
      min: 2000,
      max: 600000,
    });
  }

  void boardName;
  return questions.slice(0, 4);
}

export interface DeterministicInterpretInput {
  brief: string;
  answers?: Record<string, string>;
  priorQuestions?: Question[];
}

export function interpretDeterministically(input: DeterministicInterpretInput): InterpretResponse {
  const brief = input.brief.trim();
  const hits = retrieveFromBrief(brief);
  const { board } = detectBoard(brief);
  const webIntent = /website|web\s*app|dashboard|browser|local computer|http|access this/i.test(brief);
  const project = projectNameFor(brief, hits);

  const assumptions: string[] = [];
  const modules = hits.map((hit) => hit.device.id);
  assumptions.push(`Controller: ${board.name} (${board.mcu}) — ${board.wifi ? 'Wi-Fi built in' : 'no radio'}.`);
  if (modules.length > 0) {
    assumptions.push(
      `Detected ${hits.length} supported module(s): ${hits.map((h) => h.device.name).join('; ')}.`,
    );
  } else {
    assumptions.push('No supported sensor/actuator named yet — the knowledge base covers DHT11/22, BME280, DS18B20, soil moisture, MQ-2, HC-SR04, PIR, relay, servo, LED, OLED.');
  }
  if (webIntent) assumptions.push('Web access: local-network HTTP — the firmware serves JSON, a MERN dashboard talks to it. No cloud.');
  if (/battery|rechargeable|solar/.test(brief.toLowerCase())) {
    assumptions.push('Power: battery operation noted — sleep cadence and rail budget are enforced by the engineering rules.');
  }

  const requirements: RequirementsSpec = {
    project,
    intent: `Build a ${domainFor(brief, hits)} system around an ${board.name}${hits.length ? ` reading ${hits.map((h) => h.device.name).join(', ')}` : ''}${webIntent ? ' and serve the data to a local web dashboard.' : '.'}`,
    domain: domainFor(brief, hits),
    mechanical: {},
    power: {
      source: /battery/.test(brief.toLowerCase()) ? 'battery' : /usb/.test(brief.toLowerCase()) ? 'usb' : 'usb',
      rechargeable: /rechargeable/.test(brief.toLowerCase()) || undefined,
    },
    constraints: {
      board: board.id,
      web: webIntent,
      sampleIntervalMs: Number(input.answers?.['sample-interval']) || 2000,
      modules,
    },
    assumptions,
    confidence: hits.length > 0 ? 0.9 : 0.55,
  };

  // Questions already answered in a previous round stay answered.
  const freshQuestions = questionsFor(brief, hits, board.name, webIntent).filter(
    (question) => !input.answers?.[question.id],
  );

  return {
    requirements,
    questions: freshQuestions,
    assumptions,
    ready: freshQuestions.length === 0,
  };
}

// ── Plan ────────────────────────────────────────────────────────────────────

interface NodeSpec {
  node: ArchitectureNode;
  device?: DeviceKnowledge;
}

function moduleNode(
  device: DeviceKnowledge,
  index: number,
  total: number,
  pins: Record<string, string>,
): ArchitectureNode {
  const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
  const cx = 640 + Math.round(Math.cos(angle) * 340);
  const cy = 320 + Math.round(Math.sin(angle) * 220);
  const id = `${device.kind === 'sensor' ? 'sensor' : device.kind === 'actuator' ? 'actuator' : 'module'}-${device.id}`;

  const ports = device.ports.map((port) => ({
    id: `${id}-${port.role}`,
    label: pins[port.role] ? `${port.label} → ${pins[port.role]}` : port.label,
    direction: port.direction,
    signal: port.signal,
  }));

  return {
    id,
    type: device.kind === 'display' ? 'interface' : device.kind,
    name: device.name,
    partNumber: device.partNumber,
    x: cx,
    y: cy,
    description: device.summary,
    properties: [
      { label: 'Supply', value: `${device.supplyMinV}–${device.supplyMaxV} V` },
      { label: 'Bus', value: device.bus },
      { label: 'Datasheet', value: device.datasheet },
      ...device.metrics.map((metric) => ({
        label: metric.label,
        value: `${metric.min}–${metric.max} ${metric.unit}`.trim(),
      })),
    ],
    ports,
    details: [...device.wiringNotes],
    spatial: {
      position3d: { x: (cx - 640) / 160, y: 0, z: (cy - 320) / 160 },
      rotation3d: { x: 0, y: 0, z: 0 },
      dimensions: { w: 0.03, h: 0.012, d: 0.045 },
      massGrams: 12,
    },
  };
}

function mcuNode(boardName: string, mcu: string, x = 640, y = 320): ArchitectureNode {
  const id = 'mcu-main';
  return {
    id,
    type: 'controller',
    name: `${boardName}`,
    partNumber: mcu,
    x,
    y,
    description:
      'Main controller: runs the generated firmware, hosts the Wi-Fi web API the dashboard talks to.',
    properties: [
      { label: 'Logic level', value: '3.3 V' },
      { label: 'Radio', value: 'Wi-Fi 802.11 b/g/n + BT' },
      { label: 'Framework', value: 'Arduino (PlatformIO)' },
    ],
    ports: [
      { id: 'mcu-3v3', label: '3.3 V', direction: 'out', signal: 'power' },
      { id: 'mcu-5v', label: 'VIN 5 V', direction: 'out', signal: 'power' },
      { id: 'mcu-gnd', label: 'GND', direction: 'out', signal: 'ground' },
      { id: 'mcu-gpio4', label: 'GPIO4', direction: 'bidirectional', signal: 'digital' },
      { id: 'mcu-gpio-data', label: 'GPIO (assigned)', direction: 'bidirectional', signal: 'digital' },
      { id: 'mcu-adc', label: 'ADC1', direction: 'in', signal: 'analog' },
      { id: 'mcu-i2c', label: 'SDA/SCL (21/22)', direction: 'bidirectional', signal: 'i2c' },
    ],
    details: [
      'Flashed with the Wireup firmware zip (PlatformIO or Arduino IDE).',
      'Prints its IP on Serial at 115200 baud on boot.',
    ],
    spatial: {
      position3d: { x: 0, y: 0, z: 0 },
      rotation3d: { x: 0, y: 0, z: 0 },
      dimensions: { w: 0.055, h: 0.014, d: 0.028 },
      massGrams: 10,
    },
  };
}

function powerNode(x = 240, y = 320): ArchitectureNode {
  return {
    id: 'power-usb',
    type: 'power',
    name: 'USB 5 V supply',
    partNumber: 'USB-5V-2A',
    x,
    y,
    description: '5 V USB supply feeding the devkit VIN; the onboard regulator produces the 3.3 V rail.',
    properties: [
      { label: 'Output', value: '5 V / up to 2 A' },
      { label: 'Rails', value: '5 V (VIN), 3.3 V (regulated)' },
    ],
    ports: [
      { id: 'power-usb-5v', label: '5 V', direction: 'out', signal: 'power' },
      { id: 'power-usb-gnd', label: 'GND', direction: 'out', signal: 'ground' },
    ],
    details: ['Any 5 V USB adapter ≥ 500 mA; add margin for relay/servo loads.'],
    spatial: {
      position3d: { x: -2.2, y: 0, z: 0 },
      rotation3d: { x: 0, y: 0, z: 0 },
      dimensions: { w: 0.02, h: 0.05, d: 0.02 },
      massGrams: 40,
    },
  };
}

function buildConnections(
  module: ArchitectureNode,
  device: DeviceKnowledge,
  pins: Record<string, string>,
): ArchitectureConnection[] {
  const connections: ArchitectureConnection[] = [];
  const push = (
    from: string,
    to: string,
    fromPort: string | null,
    toPort: string | null,
    label: string,
    kind: ArchitectureConnection['kind'],
    details = '',
  ) =>
    connections.push({
      id: `conn-${connections.length + 1}`,
      from,
      to,
      fromPort,
      toPort,
      label,
      kind,
      details,
    });

  const portId = (role: string) => `${module.id}-${role}`;
  const needs5v = device.supplyMinV >= 4.5;

  // Power + ground rails.
  if (device.ports.some((p) => p.role === 'vcc')) {
    push(
      needs5v ? 'power-usb' : 'mcu-main',
      module.id,
      needs5v ? 'power-usb-5v' : 'mcu-3v3',
      portId('vcc'),
      needs5v ? '5 V' : '3.3 V',
      'power',
      needs5v ? `${device.name} requires ${device.supplyMinV} V — fed from VIN/USB, never the 3V3 rail.` : '',
    );
  }
  if (device.ports.some((p) => p.role === 'gnd')) {
    push('mcu-main', module.id, 'mcu-gnd', portId('gnd'), 'GND', 'ground', 'Common ground.');
  }

  // Signal lines with the resolved pins.
  for (const [role, pin] of Object.entries(pins)) {
    if (role === 'vcc' || role === 'gnd') continue;
    const signal = device.ports.find((p) => p.role === role)?.signal ?? 'digital';
    const kind: ArchitectureConnection['kind'] = signal === 'analog' ? 'analog' : 'data';
    const pullup =
      device.bus === 'single-wire' && role === 'data'
        ? 'Pull-up required: 10 kΩ between DATA and 3V3 (DHT family / 1-Wire).'
        : '';
    push('mcu-main', module.id, 'mcu-gpio-data', portId(role), pin, kind, pullup);
  }
  return connections;
}

export function deterministicPlan(
  request: string,
  answers: Record<string, string> = {},
  requirements?: RequirementsSpec | null,
): PlanResult {
  const hits = retrieveFromBrief(request);
  const { board } = detectBoard(request);
  const projectReq = projectNameFor(request, hits);
  const slug = slugify(answers['project-name'] ?? projectReq);

  // resolveBuildPlan gives us pin-accurate module bindings.
  const intervalFromQuestions = Number(answers['sample-interval']);
  const intervalFromRequirements = Number(
    (requirements?.constraints as { sampleIntervalMs?: number } | undefined)?.sampleIntervalMs,
  );
  const { plan: buildPlan, warnings } = resolveBuildPlan(request, projectReq, {
    project: projectReq,
    summary: '',
    nodes: [],
    connections: [],
    dependencies: [],
    software: [],
    notes: [],
  }, Number.isFinite(intervalFromRequirements) && intervalFromRequirements > 0
    ? intervalFromRequirements
    : Number.isFinite(intervalFromQuestions) && intervalFromQuestions > 0
      ? intervalFromQuestions
      : undefined);

  const moduleDevices = buildPlan.modules
    .map((module) => ({ module, device: DEVICE_KNOWLEDGE.find((d) => d.id === module.deviceId)! }))
    .filter((entry) => entry.device);

  // NOTE: partNumber 'ESP32-DEVKIT' resolves to the devkit part spec (5 V-tolerant VIN).
  const nodes: ArchitectureNode[] = [powerNode(), mcuNode(board.name, 'ESP32-DEVKIT')];
  const connections: ArchitectureConnection[] = [];

  moduleDevices.forEach(({ module, device }, index) => {
    const node = moduleNode(device, index, moduleDevices.length, module.pins);
    nodes.push(node);
    connections.push(...buildConnections(node, device, module.pins));
  });

  // USB → MCU power link.
  connections.unshift({
    id: 'conn-power-mcu',
    from: 'power-usb',
    to: 'mcu-main',
    fromPort: 'power-usb-5v',
    toPort: 'mcu-5v',
    label: 'USB 5 V',
    kind: 'power',
    details: 'Devkit VIN — the onboard regulator makes the 3.3 V rail.',
  });

  const libraries = new Map<string, string>();
  for (const { device } of moduleDevices) {
    device.libraries.forEach((lib) => libraries.set(lib.name, lib.source));
  }

  const webIntent = /website|web\s*app|dashboard|browser|local computer|http|access this/i.test(request);

  const graph: ArchitectureGraph = {
    project: projectReq,
    summary: `${board.name}-based ${nodes.length - 2} module system — ${moduleDevices.map(({ device }) => device.name).join(', ')}${webIntent ? ' — with local web dashboard' : ''}.`,
    nodes,
    connections,
    dependencies: [
      ...[...libraries.entries()].map(([name, source], i) => ({
        id: `lib-${i + 1}`,
        name,
        kind: 'firmware-library',
        version: source.split('@')[1] ?? null,
        reason: `Driver required by ${moduleDevices.map((e) => e.device.name).join(', ')}`,
      })),
      {
        id: 'lib-toolchain',
        name: 'PlatformIO / Arduino IDE (esp32 core)',
        kind: 'toolchain',
        version: null,
        reason: 'Builds and flashes the generated firmware.',
      },
    ],
    software: [
      {
        id: 'sw-firmware',
        name: `${slug} firmware (generated)`,
        kind: 'firmware',
        version: '1.0.0',
        details: 'Samples sensors, serves /api/sensors + /api/status over Wi-Fi.',
      },
      ...(webIntent
        ? [
            {
              id: 'sw-dashboard',
              name: `${slug} dashboard (MERN, generated)`,
              kind: 'web-app',
              version: '1.0.0',
              details: 'Local React + Express + optional Mongo dashboard polling the device over LAN.',
            },
          ]
        : []),
    ],
    notes: [
      ...warnings,
      'Pin assignments are deterministic and match the generated firmware config.h exactly.',
      ...moduleDevices.flatMap(({ device }) =>
        device.wiringNotes.slice(0, 1).map((note) => `${device.name}: ${note}`),
      ),
    ],
  };

  const issues: Issue[] = runEngineeringChecks(graph, undefined);
  const blocking = hasBlockingIssue(issues);
  const structuralChecks = runStructuralChecks(graph, officialComponentCatalog);
  const matchedSources = catalogMatches(graph as unknown as Record<string, unknown>);

  const passCount = structuralChecks.filter((c) => c.status === 'pass').length;
  const verification: VerificationReport = {
    status: blocking ? 'blocked' : issues.some((i) => i.severity === 'warning') ? 'review' : 'verified',
    score: Math.round((passCount / Math.max(1, structuralChecks.length)) * 100),
    summary:
      'Plan produced by the Wireup deterministic architect: every module comes from the device knowledge base with engineering-rule validation. Pin map is guaranteed to match the generated firmware.',
    checks: structuralChecks,
    sources: catalogSources(matchedSources),
  };

  return { graph, verification, issues, blocking, repairs: [] };
}
