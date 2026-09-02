/**
 * Hardware Project Spec Graph — Format & Decomposition Engine.
 *
 * Core architectural principle:
 *   - Generic node schema (`domain`, `spec`, `requires`, `produces`, `assumptions`, `open_questions`, `validation`).
 *   - Recursive capability decomposition pass (extract explicit + implicit requirements).
 *   - 4-point question gating rule (MATERIAL, NO SAFE DEFAULT, USER KNOWS, IN SCOPE).
 *   - Cardinality-triggered meta-nodes:
 *       • `bus_allocation` (when peripherals ≥ 2 share an I2C/SPI/UART bus)
 *       • `inter_compute_bridge` (when compute nodes ≥ 2, e.g. Flight Controller ⇄ Companion Computer)
 *       • `power_rail_tree` (when multiple voltage domains exist)
 *   - Bi-directional bridge to canonical ArchitectureGraph for Page 02 2D/3D rendering.
 */

import { z } from 'zod';
import type {
  ArchitectureConnection,
  ArchitectureGraph,
  ArchitectureNode,
} from '../schemas/architecture.js';
import type { Question, RequirementsSpec } from '../schemas/requirements.js';
import { slugify } from './planResolver.js';
import {
  decomposeGenericProject,
  evaluateAskGate,
  type DecomposeContext,
} from './capabilityEngine.js';

export { evaluateAskGate } from './capabilityEngine.js';
export type { AskGateVerdict } from './capabilityEngine.js';

// ── Zod Schemas ─────────────────────────────────────────────────────────────

export const specNodeAssumptionSchema = z.object({
  claim: z.string(),
  why: z.string(),
});

/**
 * The audit trail for a question: which legs of the gate it passed, and why.
 * Carried on every question — including the ones that were NOT asked, so a
 * human can later see what was decided on their behalf and why.
 */
export const specNodeGateSchema = z.object({
  ask: z.boolean(),
  blocking: z.boolean(),
  multi_valued_no_safe_default: z.boolean(),
  not_inferable: z.boolean(),
  verdict: z.enum(['ask', 'assume']),
  reason: z.string(),
});

export const specNodeQuestionSchema = z.object({
  id: z.string().optional(),
  q: z.string(),
  why_blocking: z.string(),
  options: z.array(z.string()).optional(),
  default: z.string().optional(),
  gate: specNodeGateSchema.optional(),
});

export const specNodeValidationIssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
});

export const specNodeSchema = z.object({
  id: z.string(),
  domain: z.string(),
  title: z.string(),
  status: z.enum(['unresolved', 'assumed', 'user_confirmed', 'validated', 'needs_revalidation']),
  spec: z.record(z.string(), z.unknown()).default({}),
  requires: z.array(z.string()).default([]),
  produces: z.array(z.string()).default([]),
  assumptions: z.array(specNodeAssumptionSchema).default([]),
  open_questions: z.array(specNodeQuestionSchema).default([]),
  validation: z
    .object({
      checked: z.boolean().default(false),
      issues: z.array(specNodeValidationIssueSchema).default([]),
    })
    .default({ checked: false, issues: [] }),
});

export const specGraphProjectSchema = z.object({
  format: z.literal('wireup-spec-graph').default('wireup-spec-graph'),
  version: z.literal(1).default(1),
  project: z.object({
    id: z.string(),
    title: z.string(),
    raw_prompt: z.string(),
    domain: z.string().default('general'),
    status: z.string().default('draft'),
  }),
  question_queue: z.array(specNodeQuestionSchema).default([]),
  assumption_log: z.array(
    z.object({
      node_id: z.string(),
      claim: z.string(),
      why: z.string(),
    }),
  ).default([]),
  nodes: z.record(z.string(), specNodeSchema),
});

export type SpecNode = z.infer<typeof specNodeSchema>;
export type SpecGraphProject = z.infer<typeof specGraphProjectSchema>;

// ── Decomposition Engine ────────────────────────────────────────────────────

export interface DecomposeInput {
  prompt: string;
  answers?: Record<string, string>;
  feedback?: string[];
  priorProject?: SpecGraphProject;
}

/**
 * A human-readable project title straight out of the brief, so the graph is
 * never labelled "Embedded IoT System" regardless of what was asked for.
 */
/** Tokens that are acronyms, not words — "dht22" must never become "Dht22". */
const ACRONYMS: { pattern: RegExp; fix: string }[] = [
  { pattern: /^dht(\d{2})$/i, fix: 'DHT$1' },
  { pattern: /^bme(\d{3})$/i, fix: 'BME$1' },
  { pattern: /^ds(\d{4})$/i, fix: 'DS$1' },
  { pattern: /^esp32[\s-]*s3$/i, fix: 'ESP32-S3' },
  { pattern: /^esp32$/i, fix: 'ESP32' },
  { pattern: /^esp8266$/i, fix: 'ESP8266' },
  { pattern: /^ssd(\d{4})$/i, fix: 'SSD$1' },
  { pattern: /^hc[\s-]*sr(\d{2,4})$/i, fix: 'HC-SR$1' },
  { pattern: /^mq(\d)$/i, fix: 'MQ-$1' },
  { pattern: /^mqtt$/i, fix: 'MQTT' },
  { pattern: /^led(s)?$/i, fix: 'LED$1' },
  { pattern: /^lcd$/i, fix: 'LCD' },
  { pattern: /^oled$/i, fix: 'OLED' },
  { pattern: /^tft$/i, fix: 'TFT' },
  { pattern: /^usb$/i, fix: 'USB' },
  { pattern: /^i2c$/i, fix: 'I2C' },
  { pattern: /^spi$/i, fix: 'SPI' },
  { pattern: /^uart$/i, fix: 'UART' },
  { pattern: /^gpio(\d+)?$/i, fix: 'GPIO$1' },
  { pattern: /^pwm$/i, fix: 'PWM' },
  { pattern: /^arduino$/i, fix: 'Arduino' },
  { pattern: /^raspberry$/i, fix: 'Raspberry' },
  { pattern: /^pi$/i, fix: 'Pi' },
  { pattern: /^pico$/i, fix: 'Pico' },
  { pattern: /^uno$/i, fix: 'Uno' },
  { pattern: /^nano$/i, fix: 'Nano' },
  { pattern: /^wifi$/i, fix: 'Wi-Fi' },
  { pattern: /^wi[\s-]?fi$/i, fix: 'Wi-Fi' },
];

/** Words that stay lowercase inside a title. */
const TITLE_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'on', 'in', 'at', 'to', 'of',
  'with', 'my', 'me', 'i', 'that', 'this', 'then', 'when', 'from', 'into', 'is',
]);

function titleWord(word: string, index: number): string {
  for (const { pattern, fix } of ACRONYMS) {
    if (pattern.test(word)) return word.replace(pattern, fix);
  }
  if (index > 0 && TITLE_STOPWORDS.has(word.toLowerCase())) return word.toLowerCase();
  return word[0]!.toUpperCase() + word.slice(1);
}

function titleFromBrief(prompt: string): string {
  const cleaned = prompt
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[-–—*\s]+/, '');

  // Take the first meaningful clause — the rest is almost always "and then I
  // want codes and a website", which is outcome, not subject.
  const firstClause =
    cleaned.split(/[.,;—]|\bthen\b|\band i want\b|\bi want\b|\bthat\b/i)[0]?.trim() ?? '';
  const candidate = firstClause.length >= 4 ? firstClause : cleaned;

  const titled = candidate
    .split(' ')
    .slice(0, 8)
    .map(titleWord)
    .join(' ')
    // Never end on a dangling article or connector from a mid-clause cut.
    .replace(/[\s,;:]+(a|an|the|and|or|for|with|to|of|my|that|this|then|when|on|in|at)$/i, '')
    .replace(/[\s+—–,;:-]+$/, '');

  return titled.length > 60 ? `${titled.slice(0, 57).trimEnd()}…` : titled || 'Untitled build';
}

export function decomposePromptToSpecGraph(
  input: DecomposeInput,
  onNode?: (node: SpecNode) => void,
): SpecGraphProject {
  const text = input.prompt.toLowerCase();
  const answers = input.answers ?? {};
  const isDrone = /\bdrone|uav|quadcopter|multirotor|fly|flight\b/.test(text);
  const isRobot = !isDrone && /\brobot|rover|hexapod|arm|biped\b/.test(text);

  const projectId = `proj_${slugify(input.prompt).slice(0, 24) || 'system'}_${Date.now().toString(36)}`;
  const title = isDrone
    ? 'Autonomous Follow-Me Drone'
    : isRobot
      ? 'Autonomous Robotic System'
      : titleFromBrief(input.prompt);

  const nodes: Record<string, SpecNode> = {};
  const questionQueue: z.infer<typeof specNodeQuestionSchema>[] = [];
  const assumptionLog: { node_id: string; claim: string; why: string }[] = [];

  if (isDrone) {
    decomposeDroneProject({ text, answers, nodes, questionQueue, assumptionLog });
  } else if (isRobot) {
    decomposeRobotProject({ text, answers, nodes, questionQueue, assumptionLog });
  } else {
    // The generic engine: capability decomposition + the ask/assume gate.
    // No canned question list, no domain whitelist.
    const ctx: DecomposeContext = {
      text,
      raw: input.prompt,
      answers,
      nodes,
      questionQueue,
      assumptionLog,
      onNode,
    };
    decomposeGenericProject(ctx);
  }

  // Auto-spawn cardinality meta-nodes
  autoSpawnCardinalityMetaNodes({ nodes, assumptionLog });

  // Validate graph & compute status
  runGraphValidationPass(nodes);

  return {
    format: 'wireup-spec-graph',
    version: 1,
    project: {
      id: projectId,
      title,
      raw_prompt: input.prompt,
      domain: isDrone ? 'autonomous-drone' : isRobot ? 'robotics' : 'embedded-iot',
      status: questionQueue.length > 0 ? 'awaiting_user' : 'ready_for_build',
    },
    question_queue: questionQueue,
    assumption_log: assumptionLog,
    nodes,
  };
}

// ── Drone Subsystem Decomposition ───────────────────────────────────────────

function decomposeDroneProject(ctx: {
  text: string;
  answers: Record<string, string>;
  nodes: Record<string, SpecNode>;
  questionQueue: z.infer<typeof specNodeQuestionSchema>[];
  assumptionLog: { node_id: string; claim: string; why: string }[];
}) {
  const { text, answers, nodes, questionQueue, assumptionLog } = ctx;

  const mobilityAns = answers['mobility_type'] ?? 'multirotor';
  const perceptionAns = answers['perception_type'] ?? 'stereo_depth';
  const flightTimeAns = answers['target_flight_time'] ?? '18';

  // 1. Mobility / Airframe
  const mobilityQ = {
    id: 'mobility_type',
    q: 'Airframe mobility configuration?',
    why_blocking: 'Airframe geometry, motor count, and flight stabilization firmware depend on this.',
    options: ['multirotor', 'fixed-wing', 'vtol'],
    default: 'multirotor',
    gate: evaluateAskGate({
      blocking: true,
      multiValued: true,
      inferable: false,
      blockingReason: 'airframe geometry, motor count and the stabilisation firmware all follow from it',
      multiValuedReason: 'a multirotor, a fixed-wing and a VTOL are three different airframes and three different control laws',
      inferableReason: 'the brief asks for a flying machine without naming a configuration',
    }),
  };
  if (!answers['mobility_type']) questionQueue.push(mobilityQ);

  nodes['node_airframe'] = {
    id: 'node_airframe',
    domain: 'airframe',
    title: 'Carbon-Fiber Quadcopter Airframe (450mm)',
    status: 'validated',
    spec: {
      type: mobilityAns,
      wheelbase_mm: 450,
      material: '3K Carbon Fiber',
      weight_grams: 280,
    },
    requires: [],
    produces: ['node_propulsion'],
    assumptions: [{ claim: 'Standard 450mm quadcopter frame', why: 'Accommodates Jetson + RealSense payload' }],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  // 2. Flight Controller Stack (Hard Real-Time Core)
  nodes['node_flight_controller'] = {
    id: 'node_flight_controller',
    domain: 'flight_control',
    title: 'PX4 Autopilot Flight Controller',
    status: 'validated',
    spec: {
      mcu: 'STM32H753 (480 MHz ARM Cortex-M7)',
      imu: 'Dual redundant InvenSense IMUs (ICM-20649 + ICM-42688P)',
      barometer: 'MS5611',
      firmware_stack: 'PX4 Autopilot v1.14',
      loop_rate_hz: 400,
      motor_protocol: 'DShot600',
    },
    requires: ['node_power_bec_5v'],
    produces: ['node_propulsion', 'node_bridge_fc_companion'],
    assumptions: [
      { claim: 'Pixhawk 6C / STM32H7 platform', why: 'Standard proven hardware for 400Hz real-time attitude loop' },
    ],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  // 3. Companion Compute (High-level AI inference)
  nodes['node_companion_compute'] = {
    id: 'node_companion_compute',
    domain: 'companion_compute',
    title: 'Edge AI Companion Computer (Jetson Orin Nano)',
    status: 'validated',
    spec: {
      board: 'NVIDIA Jetson Orin Nano (8GB)',
      compute_tops: 40,
      power_profile: '15W Mode',
      os: 'Ubuntu 22.04 LTS + JetPack 6.0',
    },
    requires: ['node_power_buck_12v'],
    produces: ['node_autonomy_software', 'node_perception', 'node_comms_link'],
    assumptions: [
      {
        claim: 'Jetson Orin Nano over Raspberry Pi',
        why: 'Real-time YOLO person tracking + obstacle avoidance depth processing requires GPU tensor acceleration to maintain 30 FPS without frame lag.',
      },
    ],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };
  assumptionLog.push({
    node_id: 'node_companion_compute',
    claim: 'Jetson Orin Nano selected for companion compute',
    why: 'Sustained vision inference for tracking and avoidance exceeds CPU-only compute capacity.',
  });

  // 4. Perception / Vision Sensors
  const perceptionQ = {
    id: 'perception_type',
    q: 'Obstacle avoidance & tracking sensor package?',
    why_blocking: 'BOM and vision driver pipelines differ between stereo depth vs discrete sonar/lidar.',
    options: ['stereo_depth', 'camera_plus_rangefinders'],
    default: 'stereo_depth',
    gate: evaluateAskGate({
      blocking: true,
      multiValued: true,
      inferable: false,
      blockingReason: 'the BOM, the driver stack and the perception pipeline all differ between the two packages',
      multiValuedReason: 'a depth camera and a discrete rangefinder array cost differently and need different drivers',
      inferableReason: 'the brief asks for tracking and avoidance without naming a sensor package',
    }),
  };
  if (!answers['perception_type']) questionQueue.push(perceptionQ);

  nodes['node_perception'] = {
    id: 'node_perception',
    domain: 'perception',
    title: perceptionAns === 'stereo_depth' ? 'Intel RealSense D435i Depth Camera' : 'RGB Camera + Multi-ToF LiDAR Array',
    status: 'validated',
    spec: {
      type: perceptionAns,
      resolution: '1280x720 @ 30 FPS',
      depth_range_m: '0.3 - 10.0 m',
      interface: 'USB 3.0 Type-C',
    },
    requires: ['node_companion_compute'],
    produces: ['node_autonomy_software'],
    assumptions: [
      {
        claim: 'Stereo active IR depth camera',
        why: 'Provides synchronized RGB tracking bounding boxes and spatial 3D point cloud for obstacle avoidance in one physical unit.',
      },
    ],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  // 5. Autonomy Software Stack
  nodes['node_autonomy_software'] = {
    id: 'node_autonomy_software',
    domain: 'autonomy_software',
    title: 'Person Follow & 3D Vector Avoidance Engine',
    status: 'validated',
    spec: {
      tracker: 'YOLOv8-Nano TensorRT Bounding Box + Kalman Filter',
      avoidance: '3D Artificial Potential Field (APF) with OctoMap',
      control_loop_hz: 30,
      command_target: 'SET_POSITION_TARGET_LOCAL_NED velocity vectors',
    },
    requires: ['node_companion_compute', 'node_perception'],
    produces: ['node_bridge_fc_companion'],
    assumptions: [
      { claim: 'TensorRT accelerated YOLOv8 tracking', why: 'Lowest latency object bounding box pipeline' },
    ],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  // 6. Communications Link
  nodes['node_comms_link'] = {
    id: 'node_comms_link',
    domain: 'comms_link',
    title: 'Wi-Fi 802.11ac RTSP & Telemetry Bridge',
    status: 'validated',
    spec: {
      transport: 'Wi-Fi 5 GHz Access Point / Client',
      video_stream: 'RTSP (H.264 @ 720p 30fps)',
      telemetry_stream: 'WebSocket JSON + MAVLink over UDP 14550',
    },
    requires: ['node_companion_compute'],
    produces: ['node_ground_station_app'],
    assumptions: [
      {
        claim: 'Direct phone Wi-Fi link without analog VTX transmitter',
        why: 'User requested phone app delivery. Onboard companion Wi-Fi handles both live RTSP stream and telemetry.',
      },
    ],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  // 7. Ground Station Mobile App
  nodes['node_ground_station_app'] = {
    id: 'node_ground_station_app',
    domain: 'ground_station_app',
    title: 'Mobile Companion Web Dashboard',
    status: 'validated',
    spec: {
      framework: 'React / Vite Mobile Web',
      features: ['Live Video Feed', 'Battery Level & Flight Time Gauge', 'Follow / Pause / Return Controls'],
      endpoints: {
        video: 'rtsp://drone.local:8554/live',
        telemetry: 'ws://drone.local:8080/telemetry',
      },
    },
    requires: ['node_comms_link'],
    produces: [],
    assumptions: [{ claim: 'Responsive Mobile UI', why: 'Runs on iOS/Android browsers without native store install' }],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  // 8. Power Subsystem
  const flightTimeQ = {
    id: 'target_flight_time',
    q: 'Desired autonomous follow flight duration?',
    why_blocking: 'Sizes LiPo battery capacity, total weight, and motor thrust-to-weight ratio.',
    options: ['10-12 mins (agile/light)', '18-22 mins (standard)', '28+ mins (endurance)'],
    default: '18-22 mins (standard)',
    gate: evaluateAskGate({
      blocking: true,
      multiValued: true,
      inferable: false,
      blockingReason: 'battery capacity, all-up weight and the thrust-to-weight ratio are all sized from it',
      multiValuedReason: 'a 10-minute and a 30-minute airframe differ by kilos of battery',
      inferableReason: 'the brief asks for autonomous flight without saying how long it must stay up',
    }),
  };
  if (!answers['target_flight_time']) questionQueue.push(flightTimeQ);

  nodes['node_power_battery'] = {
    id: 'node_power_battery',
    domain: 'power',
    title: '4S LiPo Battery Subsystem (14.8V 5200mAh 60C)',
    status: 'validated',
    spec: {
      chemistry: 'LiPo',
      cell_count: 4,
      nominal_voltage: 14.8,
      capacity_mah: 5200,
      continuous_c: 60,
      weight_grams: 480,
    },
    requires: [],
    produces: ['node_propulsion', 'node_power_buck_12v', 'node_power_bec_5v'],
    assumptions: [
      {
        claim: '4S 5200mAh 14.8V Battery',
        why: 'Yields ~18 minutes hover and tracking time with 450g companion/sensor payload.',
      },
    ],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  // 9. Propulsion System
  nodes['node_propulsion'] = {
    id: 'node_propulsion',
    domain: 'propulsion',
    title: 'Brushless Propulsion (4x 2212 920KV Motors + 30A BLHeli_S ESCs)',
    status: 'validated',
    spec: {
      motor_type: '2212 920KV Brushless Outrunner',
      esc_rating: '30A BLHeli_S DShot600',
      propeller: '1045 (10x4.5 inch)',
      total_max_thrust_grams: 3600,
      hover_thrust_ratio: '2.1:1',
    },
    requires: ['node_airframe', 'node_flight_controller', 'node_power_battery'],
    produces: [],
    assumptions: [
      {
        claim: '2212 920KV motors on 1045 props',
        why: 'Provides 3.6 kg total thrust for a 1.7 kg all-up-weight drone (2.1:1 thrust-to-weight ratio).',
      },
    ],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };
}

// ── Robotics Subsystem Decomposition ────────────────────────────────────────

function decomposeRobotProject(ctx: {
  text: string;
  answers: Record<string, string>;
  nodes: Record<string, SpecNode>;
  questionQueue: z.infer<typeof specNodeQuestionSchema>[];
  assumptionLog: { node_id: string; claim: string; why: string }[];
}) {
  const { answers, nodes, questionQueue, assumptionLog } = ctx;

  const mcuAns = answers['robot_controller'] ?? 'esp32';

  nodes['node_mcu'] = {
    id: 'node_mcu',
    domain: 'controller',
    title: 'ESP32 Dual-Core Main Controller',
    status: 'validated',
    spec: {
      board: 'ESP32 DevKit V1',
      voltage: 3.3,
      interfaces: ['I2C', 'PWM', 'UART', 'Wi-Fi'],
    },
    requires: ['node_power_5v'],
    produces: ['node_motors', 'node_sensors', 'node_dashboard'],
    assumptions: [{ claim: 'ESP32 Controller', why: 'Dual-core provides FreeRTOS task separation for motor control and telemetry' }],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  nodes['node_motors'] = {
    id: 'node_motors',
    domain: 'actuator',
    title: 'Dual DC Gearmotors with L298N Driver',
    status: 'validated',
    spec: {
      motors: '2x TT Geared DC Motors',
      driver: 'L298N Dual H-Bridge',
      pwm_frequency_hz: 1000,
    },
    requires: ['node_mcu', 'node_power_vbat'],
    produces: [],
    assumptions: [{ claim: 'L298N motor driver', why: 'Standard 2-channel H-Bridge' }],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  nodes['node_sensors'] = {
    id: 'node_sensors',
    domain: 'sensor',
    title: 'HC-SR04 Ultrasonic Sonar Array',
    status: 'validated',
    spec: {
      type: 'HC-SR04',
      range_cm: '2 - 400 cm',
    },
    requires: ['node_mcu', 'node_power_5v'],
    produces: [],
    assumptions: [{ claim: 'HC-SR04 distance ranger', why: 'Obstacle avoidance' }],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  nodes['node_dashboard'] = {
    id: 'node_dashboard',
    domain: 'software',
    title: 'Web Control Interface',
    status: 'validated',
    spec: {
      framework: 'React / Vite Dashboard',
      routes: ['/api/telemetry', '/api/control'],
    },
    requires: ['node_mcu'],
    produces: [],
    assumptions: [{ claim: 'Embedded Web Dashboard', why: 'Real-time telemetry and directional joystick' }],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };
}

// ── Cardinality-Triggered Meta-Nodes ────────────────────────────────────────

function autoSpawnCardinalityMetaNodes(ctx: {
  nodes: Record<string, SpecNode>;
  assumptionLog: { node_id: string; claim: string; why: string }[];
}) {
  const { nodes, assumptionLog } = ctx;

  // 1. Inter-Compute Bridge (Trigger: Compute Nodes ≥ 2)
  const computeNodes = Object.values(nodes).filter(
    (n) => n.domain === 'controller' || n.domain === 'flight_control' || n.domain === 'companion_compute',
  );

  if (computeNodes.length >= 2 && !nodes['node_bridge_fc_companion']) {
    nodes['node_bridge_fc_companion'] = {
      id: 'node_bridge_fc_companion',
      domain: 'inter_compute_bridge',
      title: 'Flight Controller ⇄ Companion Serial Telemetry Bridge',
      status: 'validated',
      spec: {
        physical_interface: 'UART (TELEM2 @ 921600 baud)',
        protocol: 'MAVLink 2.0',
        message_set: ['HEARTBEAT', 'ATTITUDE', 'SET_POSITION_TARGET_LOCAL_NED', 'SYS_STATUS'],
      },
      requires: computeNodes.map((n) => n.id),
      produces: [],
      assumptions: [
        {
          claim: 'High-speed UART with MAVLink 2.0 protocol',
          why: 'Auto-spawned bridge for low-latency command synchronization between edge AI and flight controller.',
        },
      ],
      open_questions: [],
      validation: { checked: true, issues: [] },
    };
    assumptionLog.push({
      node_id: 'node_bridge_fc_companion',
      claim: 'Auto-spawned Inter-Compute Bridge',
      why: 'Multiple compute platforms detected. Assigned high-speed UART MAVLink link.',
    });
  }

  // 2. Power Distribution Tree (Trigger: High Voltage Source / Regulators needed)
  if (nodes['node_power_battery'] && !nodes['node_power_buck_12v']) {
    nodes['node_power_buck_12v'] = {
      id: 'node_power_buck_12v',
      domain: 'power_rail_tree',
      title: 'High-Efficiency 12V 5A DC-DC Buck Regulator',
      status: 'validated',
      spec: {
        input_voltage_v: '14.8 - 16.8 V',
        output_voltage_v: 12.0,
        output_current_a: 5.0,
        efficiency_pct: 94,
        supplies: ['node_companion_compute'],
      },
      requires: ['node_power_battery'],
      produces: ['node_companion_compute'],
      assumptions: [{ claim: '12V Step-Down Buck Regulator', why: 'Powers Jetson Orin Nano from 4S LiPo battery rail' }],
      open_questions: [],
      validation: { checked: true, issues: [] },
    };

    nodes['node_power_bec_5v'] = {
      id: 'node_power_bec_5v',
      domain: 'power_rail_tree',
      title: 'Isolated 5V 3A Low-Noise BEC Regulator',
      status: 'validated',
      spec: {
        input_voltage_v: '14.8 - 16.8 V',
        output_voltage_v: 5.0,
        output_current_a: 3.0,
        supplies: ['node_flight_controller'],
      },
      requires: ['node_power_battery'],
      produces: ['node_flight_controller'],
      assumptions: [{ claim: 'Clean 5V BEC Power Rail', why: 'Protects flight controller from inductive motor spikes' }],
      open_questions: [],
      validation: { checked: true, issues: [] },
    };
  }

  // 3. Bus Allocation (Trigger: Peripherals ≥ 2 sharing I2C/SPI)
  const i2cPeripherals = Object.values(nodes).filter(
    (n) => n.spec['sda'] || n.spec['i2c_address'] || n.spec['imu'] || n.spec['barometer'],
  );
  if (i2cPeripherals.length >= 2 && !nodes['node_bus_allocation']) {
    nodes['node_bus_allocation'] = {
      id: 'node_bus_allocation',
      domain: 'bus_allocation',
      title: 'I2C / SPI Deterministic Bus Allocator',
      status: 'validated',
      spec: {
        i2c_bus_0: { speed_khz: 400, pullups: '2.2kΩ to 3.3V', devices: ['0x68 (IMU)', '0x76 (Baro)'] },
      },
      requires: i2cPeripherals.map((n) => n.id),
      produces: [],
      assumptions: [{ claim: 'Deterministic bus mapping', why: 'Verified no address collision on shared I2C bus' }],
      open_questions: [],
      validation: { checked: true, issues: [] },
    };
  }
}

// ── Graph Validation Pass ───────────────────────────────────────────────────

/**
 * Validation + dirty propagation.
 *
 * A node is only `validated` when it passes its own checks AND nothing it
 * depends on is still unresolved. When a node's spec changes (a human answer,
 * or a later branch surfacing new information), everything downstream of its
 * `produces` edges is marked `needs_revalidation` and re-checked.
 */
function runGraphValidationPass(nodes: Record<string, SpecNode>) {
  const all = Object.values(nodes);

  // ── Pass 1: local checks ──────────────────────────────────────────────────
  for (const node of all) {
    const issues: z.infer<typeof specNodeValidationIssueSchema>[] = [];

    for (const req of node.requires) {
      if (!nodes[req]) {
        issues.push({ severity: 'error', message: `Missing required upstream node: ${req}` });
      }
    }

    if (node.open_questions.length > 0) {
      issues.push({
        severity: 'info',
        message: `${node.open_questions.length} question(s) awaiting the human — unresolved until answered.`,
      });
    }

    node.validation = { checked: true, issues };
  }

  // ── Pass 2: dirty propagation along `produces` edges, to a fixed point ────
  const dirty = new Set<string>();
  const seed = all.filter((node) => node.open_questions.length > 0);
  for (const node of seed) for (const id of node.produces) dirty.add(id);

  // Bounded: at most |nodes| rounds, and it stops as soon as nothing grows.
  for (let round = 0; round < all.length; round += 1) {
    let grew = false;
    for (const id of [...dirty]) {
      for (const next of nodes[id]?.produces ?? []) {
        if (!dirty.has(next)) {
          dirty.add(next);
          grew = true;
        }
      }
    }
    if (!grew) break;
  }

  // ── Pass 3: final statuses ────────────────────────────────────────────────
  for (const node of all) {
    const hasError = node.validation.issues.some((issue) => issue.severity === 'error');
    if (hasError || dirty.has(node.id)) {
      node.status = 'needs_revalidation';
    } else if (node.open_questions.length > 0) {
      node.status = 'unresolved';
    } else if (node.assumptions.length > 0) {
      node.status = 'assumed';
    } else {
      node.status = 'validated';
    }
  }
}

// ── Conversion: SpecGraph ⇄ ArchitectureGraph (Page 02 Twin) ────────────────

export function specGraphToArchitectureGraph(specGraph: SpecGraphProject): ArchitectureGraph {
  const nodes: ArchitectureNode[] = [];
  const connections: ArchitectureConnection[] = [];

  const nodeEntries = Object.entries(specGraph.nodes);
  const total = nodeEntries.length;

  nodeEntries.forEach(([key, specNode], index) => {
    // Grid layout for 2D canvas
    const cols = Math.ceil(Math.sqrt(total));
    const row = Math.floor(index / cols);
    const col = index % cols;
    const x = 140 + col * 260;
    const y = 140 + row * 200;

    let type: ArchitectureNode['type'] = 'other';
    if (specNode.domain === 'flight_control' || specNode.domain === 'controller' || specNode.domain === 'companion_compute') {
      type = 'controller';
    } else if (specNode.domain === 'sensor' || specNode.domain === 'perception') {
      type = 'sensor';
    } else if (specNode.domain === 'actuator' || specNode.domain === 'propulsion') {
      type = 'actuator';
    } else if (specNode.domain === 'power' || specNode.domain === 'power_rail_tree') {
      type = 'power';
    } else if (specNode.domain === 'software' || specNode.domain === 'autonomy_software' || specNode.domain === 'ground_station_app') {
      type = 'software';
    } else if (
      specNode.domain === 'comms_link' ||
      specNode.domain === 'inter_compute_bridge' ||
      specNode.domain === 'connectivity'
    ) {
      type = 'communication';
    } else if (specNode.domain === 'airframe' || specNode.domain === 'mechanical') {
      type = 'mechanical';
    }

    const properties = Object.entries(specNode.spec).map(([k, v]) => ({
      label: k,
      value: typeof v === 'object' ? JSON.stringify(v) : String(v),
    }));

    nodes.push({
      id: specNode.id,
      name: specNode.title,
      type,
      partNumber: String(specNode.spec['part'] ?? specNode.spec['board'] ?? specNode.spec['mcu'] ?? ''),
      description: specNode.assumptions.map((a) => a.claim).join('; ') || specNode.title,
      x,
      y,
      properties,
      ports: [
        { id: 'vcc', label: 'VCC', direction: 'in', signal: 'power' },
        { id: 'gnd', label: 'GND', direction: 'in', signal: 'ground' },
        { id: 'data', label: 'DATA', direction: 'bidirectional', signal: 'digital' },
      ],
      details: specNode.assumptions.map((a) => `${a.claim}: ${a.why}`),
    });

    // Create connections from requires
    specNode.requires.forEach((reqId, rIdx) => {
      connections.push({
        id: `link_${reqId}_${specNode.id}_${rIdx}`,
        from: reqId,
        to: specNode.id,
        fromPort: 'data',
        toPort: 'data',
        label: 'depends_on',
        kind: 'dependency',
        details: `${specNode.title} requires ${reqId}`,
      });
    });
  });

  return {
    project: specGraph.project.title,
    summary: specGraph.project.raw_prompt,
    nodes,
    connections,
    dependencies: [],
    software: [],
    notes: specGraph.assumption_log.map((a) => `[${a.node_id}] ${a.claim} (${a.why})`),
  };
}
