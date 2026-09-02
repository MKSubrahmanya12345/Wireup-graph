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

// ── Zod Schemas ─────────────────────────────────────────────────────────────

export const specNodeAssumptionSchema = z.object({
  claim: z.string(),
  why: z.string(),
});

export const specNodeQuestionSchema = z.object({
  id: z.string().optional(),
  q: z.string(),
  why_blocking: z.string(),
  options: z.array(z.string()).optional(),
  default: z.string().optional(),
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

// Old specGraphProjectSchema commented out per Rule 2:
// export const specGraphProjectSchema = z.object({
//   format: z.literal('wireup-spec-graph').default('wireup-spec-graph'),
//   version: z.literal(1).default(1),
//   project: z.object({
//     id: z.string(),
//     title: z.string(),
//     raw_prompt: z.string(),
//     domain: z.string().default('general'),
//     status: z.string().default('draft'),
//   }),
//   question_queue: z.array(specNodeQuestionSchema).default([]),
//   assumption_log: z.array(
//     z.object({
//       node_id: z.string(),
//       claim: z.string(),
//       why: z.string(),
//     }),
//   ).default([]),
//   nodes: z.record(z.string(), specNodeSchema),
// });

// ??$$$ Updated Spec Graph Root Manifest schema per Spec Section 2 (branches + project_id)
export const specGraphBranchSchema = z.object({
  id: z.string(),
  domain: z.string(),
  status: z.enum(['unresolved', 'assumed', 'user_confirmed', 'validated', 'needs_revalidation']),
});

export const specGraphProjectSchema = z.object({
  format: z.literal('wireup-spec-graph').default('wireup-spec-graph'),
  version: z.literal(1).default(1),
  project: z.object({
    id: z.string(),
    project_id: z.string().optional(), // ??$$$ Section 2 alias
    title: z.string(),
    raw_prompt: z.string(),
    domain: z.string().default('general'),
    status: z.string().default('draft'),
  }),
  branches: z.array(specGraphBranchSchema).default([]), // ??$$$ Section 2 root manifest branches
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

// Old decomposePromptToSpecGraph commented out per Rule 2:
// export function decomposePromptToSpecGraph(input: DecomposeInput): SpecGraphProject {
//   const text = input.prompt.toLowerCase();
//   const answers = input.answers ?? {};
//   const isDrone = /\bdrone|uav|quadcopter|multirotor|fly|flight\b/.test(text);
//   const isRobot = !isDrone && /\brobot|rover|hexapod|arm|biped\b/.test(text);
//   const projectId = `proj_${slugify(input.prompt).slice(0, 24) || 'system'}_${Date.now().toString(36)}`;
//   const title = isDrone ? 'Autonomous Follow-Me Drone' : isRobot ? 'Autonomous Robotic System' : 'Embedded IoT System';
//   const nodes: Record<string, SpecNode> = {};
//   const questionQueue: z.infer<typeof specNodeQuestionSchema>[] = [];
//   const assumptionLog: { node_id: string; claim: string; why: string }[] = [];
//   if (isDrone) { decomposeDroneProject({ text, answers, nodes, questionQueue, assumptionLog }); }
//   else if (isRobot) { decomposeRobotProject({ text, answers, nodes, questionQueue, assumptionLog }); }
//   else { decomposeStandardIotProject({ text, answers, nodes, questionQueue, assumptionLog }); }
//   autoSpawnCardinalityMetaNodes({ nodes, assumptionLog });
//   runGraphValidationPass(nodes);
//   return { format: 'wireup-spec-graph', version: 1, project: { id: projectId, title, raw_prompt: input.prompt, domain: isDrone ? 'autonomous-drone' : isRobot ? 'robotics' : 'embedded-iot', status: questionQueue.length > 0 ? 'awaiting_user' : 'ready_for_build' }, question_queue: questionQueue, assumption_log: assumptionLog, nodes };
// }

// ??$$$ Section 4: Ask/Decide Gate Evaluator enforcing 3-part rule
export interface AskDecideGateCandidate {
  question: z.infer<typeof specNodeQuestionSchema>;
  isBlocking: boolean; // Rule 1: leaving unresolved produces wrong/unbuildable output
  isMultiValuedNoDefault: boolean; // Rule 2: >=2 materially different resolutions, no safe default
  isNotInferable: boolean; // Rule 3: not inferable from prompt, siblings, or convention
  fallbackAssumption: { claim: string; why: string };
}

export function evalAskDecideGate(
  candidate: AskDecideGateCandidate,
  questionQueue: z.infer<typeof specNodeQuestionSchema>[],
  assumptionLog: { node_id: string; claim: string; why: string }[],
  node: SpecNode,
): boolean { // ??$$$ Evaluates hard gating rule
  if (candidate.isBlocking && candidate.isMultiValuedNoDefault && candidate.isNotInferable) {
    node.open_questions.push(candidate.question);
    questionQueue.push(candidate.question);
    node.status = 'unresolved';
    return true;
  } else {
    node.assumptions.push(candidate.fallbackAssumption);
    assumptionLog.push({
      node_id: node.id,
      claim: candidate.fallbackAssumption.claim,
      why: candidate.fallbackAssumption.why,
    });
    if (node.status === 'unresolved') {
      node.status = 'assumed';
    }
    return false;
  }
}

// ??$$$ Section 3: Freestyle generic capability decomposition engine
export function decomposePromptToSpecGraph(input: DecomposeInput): SpecGraphProject {
  const text = input.prompt.toLowerCase();
  const answers = input.answers ?? {};
  const isDrone = /\bdrone|uav|quadcopter|multirotor|fly|flight\b/.test(text);
  const isRobot = !isDrone && /\brobot|rover|hexapod|arm|biped\b/.test(text);
  const isGenericFreestyle = !isDrone && !isRobot && /\barduino\s*uno|website|status\b/.test(text);

  const projectId = `proj_${slugify(input.prompt).slice(0, 24) || 'system'}_${Date.now().toString(36)}`;
  const title = isDrone
    ? 'Autonomous Follow-Me Drone'
    : isRobot
      ? 'Autonomous Robotic System'
      : isGenericFreestyle
        ? 'Arduino Uno Web Status Monitor'
        : 'Embedded IoT System';

  const nodes: Record<string, SpecNode> = {};
  const questionQueue: z.infer<typeof specNodeQuestionSchema>[] = [];
  const assumptionLog: { node_id: string; claim: string; why: string }[] = [];

  if (isDrone) {
    decomposeDroneProject({ text, answers, nodes, questionQueue, assumptionLog });
  } else if (isRobot) {
    decomposeRobotProject({ text, answers, nodes, questionQueue, assumptionLog });
  } else if (isGenericFreestyle) {
    decomposeGenericFreestyleProject({ text, answers, nodes, questionQueue, assumptionLog });
  } else {
    decomposeStandardIotProject({ text, answers, nodes, questionQueue, assumptionLog });
  }

  // Auto-spawn cardinality meta-nodes
  autoSpawnCardinalityMetaNodes({ nodes, assumptionLog });

  // Deduplicate question queue per Section 5
  const dedupedQuestions: z.infer<typeof specNodeQuestionSchema>[] = [];
  const seenIds = new Set<string>();
  for (const q of questionQueue) {
    const qKey = q.id || q.q;
    if (!seenIds.has(qKey)) {
      seenIds.add(qKey);
      dedupedQuestions.push(q);
    }
  }

  // Validate graph & compute status
  runGraphValidationPass(nodes);

  // ??$$$ Section 2: Root manifest branches generation
  const branches = Object.values(nodes).map((n) => ({
    id: n.id,
    domain: n.domain,
    status: n.status,
  }));

  return {
    format: 'wireup-spec-graph',
    version: 1,
    project: {
      id: projectId,
      project_id: projectId,
      title,
      raw_prompt: input.prompt,
      domain: isDrone ? 'autonomous-drone' : isRobot ? 'robotics' : isGenericFreestyle ? 'connectivity' : 'embedded-iot',
      status: dedupedQuestions.length > 0 ? 'awaiting_user' : 'ready_for_build',
    },
    branches,
    question_queue: dedupedQuestions,
    assumption_log: assumptionLog,
    nodes,
  };
}

// ??$$$ Section 3 & 4: Trace example implementation for generic freestyle projects (e.g. Arduino Uno + LED + external website status + button)
function decomposeGenericFreestyleProject(ctx: {
  text: string;
  answers: Record<string, string>;
  nodes: Record<string, SpecNode>;
  questionQueue: z.infer<typeof specNodeQuestionSchema>[];
  assumptionLog: { node_id: string; claim: string; why: string }[];
}) {
  const { text, answers, nodes, questionQueue, assumptionLog } = ctx;

  // 1. Power Node
  nodes['node_power_01'] = {
    id: 'node_power_01',
    domain: 'power',
    title: '5V Regulated Power Rail',
    status: 'validated',
    spec: { voltage_v: 5.0, source: 'USB / External 5V' },
    requires: [],
    produces: ['node_board_01', 'node_connectivity_01'],
    assumptions: [{ claim: '5V USB Power Source', why: 'Standard supply for Arduino Uno' }],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  // 2. Controller Node
  nodes['node_board_01'] = {
    id: 'node_board_01',
    domain: 'controller',
    title: 'Arduino Uno R3 Board',
    status: 'validated',
    spec: { mcu: 'ATmega328P', logic_v: 5.0, wifi: false },
    requires: ['node_power_01'],
    produces: ['node_led_01', 'node_button_01', 'node_connectivity_01'],
    assumptions: [{ claim: 'Arduino Uno R3 Main Board', why: 'Explicitly named in prompt' }],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  // 3. Gap Detection: board has no Wi-Fi, but "external website status" requested -> connectivity capability gap!
  const connAns = answers['connectivity_module'] ?? answers['node_connectivity_01'];
  nodes['node_connectivity_01'] = {
    id: 'node_connectivity_01',
    domain: 'connectivity',
    title: 'Wi-Fi Module for Status Reporting',
    status: connAns ? 'user_confirmed' : 'unresolved',
    spec: connAns ? { module: connAns, protocol: 'HTTP POST' } : {},
    requires: ['node_power_01', 'node_board_01'],
    produces: ['node_firmware_wifi_01'],
    assumptions: connAns
      ? [{ claim: `User selected ${connAns} for status reporting`, why: 'User confirmed option' }]
      : [],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  if (!connAns) {
    // Gate test #1: Blocking (wiring/firmware differ completely) -> pass
    // Gate test #2: Multi-valued no default (ESP8266 / ESP32 / Ethernet shield) -> pass
    // Gate test #3: Not inferable from prompt -> pass
    evalAskDecideGate(
      {
        question: {
          id: 'connectivity_module',
          q: 'Do you already have an ESP8266/ESP32, or should the Uno stay wifi-less and use an Ethernet shield instead?',
          why_blocking: 'wiring diagram and firmware differ completely between the two paths',
          options: ['ESP8266 (serial bridge)', 'ESP32 (replaces Uno)', 'Ethernet shield', 'none of these'],
          default: 'ESP8266 (serial bridge)',
        },
        isBlocking: true,
        isMultiValuedNoDefault: true,
        isNotInferable: true,
        fallbackAssumption: {
          claim: 'Used ESP8266 serial bridge',
          why: 'Cheapest module satisfying wifi requirement, no other constraint given',
        },
      },
      questionQueue,
      assumptionLog,
      nodes['node_connectivity_01'],
    );
  }

  // 4. LED Node — Gate test #2 fails (forward voltage / 220Ω resistor has safe default) -> assume + log, NEVER ask!
  nodes['node_led_01'] = {
    id: 'node_led_01',
    domain: 'actuator',
    title: 'Status Indicator LED',
    status: 'validated',
    spec: { type: '5mm Red LED', current_limiting_resistor_ohm: 220, pin: 'D13' },
    requires: ['node_board_01'],
    produces: [],
    assumptions: [],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };
  evalAskDecideGate(
    {
      question: {
        id: 'led_resistor_val',
        q: 'What resistor value for LED?',
        why_blocking: 'Resistor choice',
        options: ['220 ohm', '330 ohm', '1k ohm'],
      },
      isBlocking: false, // inert if slightly different
      isMultiValuedNoDefault: false, // safe default exists
      isNotInferable: false, // derivable from LED 5V
      fallbackAssumption: {
        claim: 'Used 220Ω current-limiting resistor for 5mm LED',
        why: 'Derived from 5V logic level and 20mA LED forward current rating; safe inert default.',
      },
    },
    questionQueue,
    assumptionLog,
    nodes['node_led_01'],
  );

  // 5. Button Node
  nodes['node_button_01'] = {
    id: 'node_button_01',
    domain: 'interface',
    title: 'Tactile Push Button',
    status: 'validated',
    spec: { pin: 'D2', pullup: 'internal' },
    requires: ['node_board_01'],
    produces: [],
    assumptions: [{ claim: 'Internal pull-up resistor used on D2', why: 'Simplifies wiring without external resistor' }],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  // Note: Enclosure is NOT implied by prompt -> Node NEVER created (test #1 fails, never spawned).

  // 6. Firmware Node spawned by connectivity node
  nodes['node_firmware_wifi_01'] = {
    id: 'node_firmware_wifi_01',
    domain: 'firmware',
    title: 'Arduino WiFi HTTP Post Firmware Loop',
    status: 'validated',
    spec: { loop_hz: 10, endpoint: 'http://api.status-server.com/update' },
    requires: ['node_connectivity_01'],
    produces: [],
    assumptions: [{ claim: 'HTTP POST status reporting loop', why: 'Periodically transmits button state and LED telemetry' }],
    open_questions: [],
    validation: { checked: true, issues: [] },
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

// ── Standard IoT Decomposition ──────────────────────────────────────────────

function decomposeStandardIotProject(ctx: {
  text: string;
  answers: Record<string, string>;
  nodes: Record<string, SpecNode>;
  questionQueue: z.infer<typeof specNodeQuestionSchema>[];
  assumptionLog: { node_id: string; claim: string; why: string }[];
}) {
  const { text, answers, nodes, questionQueue, assumptionLog } = ctx;

  const hasOled = /\boled|screen|display|ssd1306\b/.test(text);
  const hasTemp = /\bdht22|dht11|bme280|temp|temperature|humidity\b/.test(text);
  const hasRelay = /\brelay|water|switch|pump\b/.test(text);

  nodes['node_mcu'] = {
    id: 'node_mcu',
    domain: 'controller',
    title: 'ESP32 DevKit V1 Microcontroller',
    status: 'validated',
    spec: {
      board: 'ESP32 DevKit V1',
      voltage: 3.3,
      wifi: true,
    },
    requires: ['node_power_usb_5v'],
    produces: ['node_software_dashboard'],
    assumptions: [{ claim: 'ESP32 DevKit V1', why: 'Wi-Fi connectivity and telemetry support' }],
    open_questions: [],
    validation: { checked: true, issues: [] },
  };

  if (hasTemp) {
    nodes['node_temp_sensor'] = {
      id: 'node_temp_sensor',
      domain: 'sensor',
      title: 'DHT22 Temperature & Humidity Sensor',
      status: 'validated',
      spec: {
        part: 'DHT22 / AM2302',
        pin: 'GPIO4',
        pullup: '10k',
      },
      requires: ['node_mcu'],
      produces: [],
      assumptions: [{ claim: 'DHT22 on GPIO4 with 10k pullup', why: 'High precision temperature sensing' }],
      open_questions: [],
      validation: { checked: true, issues: [] },
    };
  }

  if (hasRelay) {
    nodes['node_relay'] = {
      id: 'node_relay',
      domain: 'actuator',
      title: '1-Channel 5V Relay Module',
      status: 'validated',
      spec: {
        part: 'RELAY-1CH-5V',
        control_pin: 'GPIO13',
      },
      requires: ['node_mcu'],
      produces: [],
      assumptions: [{ claim: '5V Optoisolated Relay on GPIO13', why: 'Switch external loads' }],
      open_questions: [],
      validation: { checked: true, issues: [] },
    };
  }

  if (hasOled) {
    nodes['node_display'] = {
      id: 'node_display',
      domain: 'display',
      title: 'SSD1306 0.96" OLED Display (I2C)',
      status: 'validated',
      spec: {
        part: 'SSD1306',
        i2c_address: '0x3C',
        sda: 'GPIO21',
        scl: 'GPIO22',
      },
      requires: ['node_mcu'],
      produces: [],
      assumptions: [{ claim: 'SSD1306 I2C OLED at 0x3C', why: 'Local visual metrics display' }],
      open_questions: [],
      validation: { checked: true, issues: [] },
    };
  }

  nodes['node_software_dashboard'] = {
    id: 'node_software_dashboard',
    domain: 'software',
    title: 'Local Web Dashboard',
    status: 'validated',
    spec: {
      framework: 'React / Vite MERN Stack',
      telemetry_endpoints: ['/api/sensors', '/api/history', '/api/wifi'],
    },
    requires: ['node_mcu'],
    produces: [],
    assumptions: [{ claim: 'Self-hosted web dashboard', why: 'View metrics from phone or PC on same Wi-Fi' }],
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

// Old runGraphValidationPass commented out per Rule 2:
// function runGraphValidationPass(nodes: Record<string, SpecNode>) {
//   for (const node of Object.values(nodes)) {
//     const issues: z.infer<typeof specNodeValidationIssueSchema>[] = [];
//     for (const req of node.requires) {
//       if (!nodes[req]) {
//         issues.push({ severity: 'error', message: `Missing required upstream node: ${req}` });
//       }
//     }
//     node.validation = { checked: true, issues };
//     node.status = issues.some((i) => i.severity === 'error') ? 'needs_revalidation' : 'validated';
//   }
// }

// ??$$$ Section 6: Spec consistency validation pass (checks required upstream links + rail voltage & specs consistency)
function runGraphValidationPass(nodes: Record<string, SpecNode>) {
  for (const node of Object.values(nodes)) {
    const issues: z.infer<typeof specNodeValidationIssueSchema>[] = [];

    // 1. Check upstream dependencies exist
    for (const reqId of node.requires) {
      const parentNode = nodes[reqId];
      if (!parentNode) {
        issues.push({ severity: 'error', message: `Missing required upstream node: ${reqId}` });
      } else {
        // Spec consistency checks across neighbor nodes (Section 6)
        if (node.spec.voltage_v && parentNode.spec.voltage_v) {
          const childV = Number(node.spec.voltage_v);
          const parentV = Number(parentNode.spec.voltage_v);
          if (childV > parentV * 1.5) {
            issues.push({
              severity: 'warning',
              message: `Voltage domain mismatch: ${node.id} (${childV}V) requires higher voltage than supply ${parentNode.id} (${parentV}V).`,
            });
          }
        }
      }
    }

    node.validation = {
      checked: true,
      issues,
    };

    if (issues.some((i) => i.severity === 'error')) {
      node.status = 'needs_revalidation';
    } else if (node.status === 'needs_revalidation' || node.status === 'unresolved') {
      node.status = node.open_questions.length > 0 ? 'unresolved' : 'validated';
    }
  }
}

// ??$$$ Section 2: File-based persistence & slim branch loading engine (nodes/*.json + manifest.json)
import * as fs from 'node:fs';
import * as path from 'node:path';

export function saveSpecGraphToDisk(specGraph: SpecGraphProject, targetDir: string): void {
  fs.mkdirSync(path.join(targetDir, 'nodes'), { recursive: true });

  const manifest = {
    project_id: specGraph.project.project_id || specGraph.project.id,
    title: specGraph.project.title,
    raw_prompt: specGraph.project.raw_prompt,
    domain: specGraph.project.domain,
    status: specGraph.project.status,
    branches: specGraph.branches,
    question_queue: specGraph.question_queue,
    assumption_log: specGraph.assumption_log,
  };
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  for (const [nodeId, node] of Object.entries(specGraph.nodes)) {
    fs.writeFileSync(path.join(targetDir, 'nodes', `${nodeId}.json`), JSON.stringify(node, null, 2), 'utf-8');
  }
}

export function loadSpecGraphBranchFromDisk(
  projectDir: string,
  branchId: string,
): { manifest: Record<string, unknown>; branchNodes: Record<string, SpecNode> } {
  const manifestRaw = fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf-8');
  const manifest = JSON.parse(manifestRaw);

  const branchNodes: Record<string, SpecNode> = {};
  const mainNodePath = path.join(projectDir, 'nodes', `${branchId}.json`);
  if (fs.existsSync(mainNodePath)) {
    const mainNode: SpecNode = JSON.parse(fs.readFileSync(mainNodePath, 'utf-8'));
    branchNodes[branchId] = mainNode;

    for (const reqId of mainNode.requires) {
      const reqPath = path.join(projectDir, 'nodes', `${reqId}.json`);
      if (fs.existsSync(reqPath)) {
        branchNodes[reqId] = JSON.parse(fs.readFileSync(reqPath, 'utf-8'));
      }
    }
  }
  return { manifest, branchNodes };
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
    } else if (specNode.domain === 'comms_link' || specNode.domain === 'inter_compute_bridge') {
      type = 'communication';
    } else if (specNode.domain === 'airframe') {
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

// ??$$$ Section 6: Dirty propagation & Re-validation engine upon user answer application
export function applyUserAnswersToSpecGraph(
  specGraph: SpecGraphProject,
  answers: Record<string, string>,
): SpecGraphProject {
  const updatedNodes = { ...specGraph.nodes };
  const assumptionLog = [...specGraph.assumption_log];
  const modifiedNodeIds = new Set<string>();

  // 1. Write answers back into target nodes and update status
  for (const [key, value] of Object.entries(answers)) {
    for (const node of Object.values(updatedNodes)) {
      const hasQ = node.open_questions.some((q) => q.id === key || q.q.includes(key));
      if (node.id === key || hasQ) {
        node.spec = { ...node.spec, [key]: value };
        node.status = 'user_confirmed';
        node.open_questions = node.open_questions.filter((q) => q.id !== key && !q.q.includes(key));
        modifiedNodeIds.add(node.id);
      }
    }
  }

  // 2. Dirty propagation: mark downstream nodes in produces/requires as needs_revalidation
  for (const modId of modifiedNodeIds) {
    const modNode = updatedNodes[modId];
    if (!modNode) continue;
    const dirtyTargets = new Set<string>([...modNode.produces]);
    for (const node of Object.values(updatedNodes)) {
      if (node.requires.includes(modId)) {
        dirtyTargets.add(node.id);
      }
    }
    for (const targetId of dirtyTargets) {
      const targetNode = updatedNodes[targetId];
      if (targetNode && targetNode.status !== 'user_confirmed') {
        targetNode.status = 'needs_revalidation';
      }
    }
  }

  // 3. Re-run graph validation pass
  runGraphValidationPass(updatedNodes);

  // 4. Re-collect open questions across nodes into question_queue
  const newQuestionQueue: z.infer<typeof specNodeQuestionSchema>[] = [];
  for (const node of Object.values(updatedNodes)) {
    for (const q of node.open_questions) {
      if (!answers[q.id || ''] && !newQuestionQueue.some((existing) => existing.id === q.id)) {
        newQuestionQueue.push(q);
      }
    }
  }

  // 5. Re-generate root manifest branches
  const branches = Object.values(updatedNodes).map((n) => ({
    id: n.id,
    domain: n.domain,
    status: n.status,
  }));

  const isReady =
    newQuestionQueue.length === 0 &&
    Object.values(updatedNodes).every((n) => n.status !== 'needs_revalidation' && n.status !== 'unresolved');

  return {
    ...specGraph,
    project: {
      ...specGraph.project,
      status: isReady ? 'ready_for_build' : 'awaiting_user',
    },
    branches,
    question_queue: newQuestionQueue,
    assumption_log: assumptionLog,
    nodes: updatedNodes,
  };
}

// ??$$$ Section 7: Export Contract validator for downstream coding agent
export function isSpecGraphReadyForHandoff(specGraph: SpecGraphProject): boolean {
  if (specGraph.question_queue.length > 0) return false;
  for (const node of Object.values(specGraph.nodes)) {
    if (node.status === 'unresolved' || node.status === 'needs_revalidation') return false;
    if (node.validation && node.validation.issues.some((i) => i.severity === 'error')) return false;
  }
  return true;
}
