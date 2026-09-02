import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Old imports commented out per Rule 2:
// const {
//   decomposePromptToSpecGraph,
//   specGraphToArchitectureGraph,
//   specGraphProjectSchema,
// } = await import('../src/agentic/specGraph.ts');

// ??$$$ Updated imports including dirty propagation and handoff contract functions
const {
  decomposePromptToSpecGraph,
  specGraphToArchitectureGraph,
  specGraphProjectSchema,
  applyUserAnswersToSpecGraph,
  isSpecGraphReadyForHandoff,
} = await import('../src/agentic/specGraph.ts');

describe('SpecGraph Decomposition Engine', () => {
  it('decomposes the autonomous follow-me drone prompt into the complete dual-compute stack and meta-nodes', () => {
    const prompt =
      'I want to build a drone that can autonomously follow a person using a camera, avoid obstacles, and send live video + battery status to my phone app.';

    const specGraph = decomposePromptToSpecGraph({ prompt });

    // Validate against schema
    const parsed = specGraphProjectSchema.safeParse(specGraph);
    assert.equal(parsed.success, true);

    // Assert project metadata
    assert.equal(specGraph.project.title, 'Autonomous Follow-Me Drone');
    assert.equal(specGraph.project.domain, 'autonomous-drone');

    // Assert exact nodes created
    const nodeIds = Object.keys(specGraph.nodes);
    assert.ok(nodeIds.includes('node_airframe'));
    assert.ok(nodeIds.includes('node_flight_controller'));
    assert.ok(nodeIds.includes('node_companion_compute'));
    assert.ok(nodeIds.includes('node_perception'));
    assert.ok(nodeIds.includes('node_autonomy_software'));
    assert.ok(nodeIds.includes('node_comms_link'));
    assert.ok(nodeIds.includes('node_ground_station_app'));
    assert.ok(nodeIds.includes('node_power_battery'));
    assert.ok(nodeIds.includes('node_propulsion'));

    // Assert auto-spawned cardinality meta-nodes
    assert.ok(nodeIds.includes('node_bridge_fc_companion'));
    assert.ok(nodeIds.includes('node_power_buck_12v'));
    assert.ok(nodeIds.includes('node_power_bec_5v'));

    // Assert companion compute chosen as Jetson Orin Nano with rationale
    const companionNode = specGraph.nodes['node_companion_compute'];
    assert.equal(companionNode.spec.board, 'NVIDIA Jetson Orin Nano (8GB)');
    assert.ok(companionNode.assumptions.some((a) => a.claim.includes('Jetson Orin Nano')));

    // Assert inter-compute bridge has MAVLink 2.0
    const bridgeNode = specGraph.nodes['node_bridge_fc_companion'];
    assert.equal(bridgeNode.spec.protocol, 'MAVLink 2.0');

    // Assert questions generated follow the 4-part gate (mobility, perception, flight time)
    const questionIds = specGraph.question_queue.map((q) => q.id);
    assert.ok(questionIds.includes('mobility_type'));
    assert.ok(questionIds.includes('perception_type'));
    assert.ok(questionIds.includes('target_flight_time'));

    // Assert 2D/3D ArchitectureGraph twin conversion works cleanly
    const arch = specGraphToArchitectureGraph(specGraph);
    assert.ok(arch.nodes.length >= 10);
    assert.ok(arch.connections.length >= 5);
    assert.equal(arch.project, 'Autonomous Follow-Me Drone');
  });

  it('decomposes standard IoT sensing project into mcu, sensor, and dashboard nodes', () => {
    const prompt = 'esp32 with dht22 sensor and a 5v relay to control a fan, web dashboard on pc';

    const specGraph = decomposePromptToSpecGraph({ prompt });

    assert.equal(specGraph.project.domain, 'embedded-iot');
    const nodeIds = Object.keys(specGraph.nodes);
    assert.ok(nodeIds.includes('node_mcu'));
    assert.ok(nodeIds.includes('node_temp_sensor'));
    assert.ok(nodeIds.includes('node_relay'));
    assert.ok(nodeIds.includes('node_software_dashboard'));

    const arch = specGraphToArchitectureGraph(specGraph);
    assert.ok(arch.nodes.length >= 4);
  });

  // ??$$$ Test generic freestyle capability decomposition, Ask/Decide gate, dirty propagation & handoff contract
  it('decomposes Arduino Uno + LED + external website status + button with gap detection and Ask/Decide gate', () => {
    const prompt = 'arduino uno + led + external website status + button';
    const specGraph = decomposePromptToSpecGraph({ prompt });

    // Validate root manifest branches structure (Section 2)
    assert.ok(Array.isArray(specGraph.branches));
    assert.ok(specGraph.branches.length >= 4);

    // Verify nodes created
    const nodeIds = Object.keys(specGraph.nodes);
    assert.ok(nodeIds.includes('node_board_01'));
    assert.ok(nodeIds.includes('node_connectivity_01'));
    assert.ok(nodeIds.includes('node_led_01'));
    assert.ok(nodeIds.includes('node_button_01'));
    assert.ok(nodeIds.includes('node_firmware_wifi_01'));
    // Enclosure not implied -> never spawned
    assert.equal(nodeIds.includes('node_enclosure_01'), false);

    // Verify Ask/Decide gate: connectivity module question asked because it passes 3 rules
    const connNode = specGraph.nodes['node_connectivity_01'];
    assert.equal(connNode.open_questions.length, 1);
    assert.equal(connNode.open_questions[0].id, 'connectivity_module');

    // Verify Ask/Decide gate: LED resistor failed gate test #2 (safe default exists) -> assumption logged, never asked!
    const ledNode = specGraph.nodes['node_led_01'];
    assert.equal(ledNode.open_questions.length, 0);
    assert.ok(ledNode.assumptions.some((a) => a.claim.includes('220Ω')));

    // Test dirty propagation & answer resolution (Section 5 & 6)
    const updatedGraph = applyUserAnswersToSpecGraph(specGraph, {
      connectivity_module: 'ESP8266 (serial bridge)',
    });

    assert.equal(updatedGraph.question_queue.length, 0);
    assert.equal(updatedGraph.nodes['node_connectivity_01'].status, 'user_confirmed');
    assert.equal(isSpecGraphReadyForHandoff(updatedGraph), true);
  });
});
