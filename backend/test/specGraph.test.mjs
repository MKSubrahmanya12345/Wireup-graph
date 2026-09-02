import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  decomposePromptToSpecGraph,
  specGraphToArchitectureGraph,
  specGraphProjectSchema,
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
});
