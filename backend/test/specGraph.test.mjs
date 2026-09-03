import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const {
  specGraphProjectSchema,
  finalizeSpecGraph,
  applyUserAnswersToSpecGraph,
  isSpecGraphReadyForHandoff,
  specGraphToArchitectureGraph,
  buildRequiredByIndex,
  detectResourceContention,
} = await import('../src/agentic/specGraph.ts');

/** A hand-built Arduino Uno project: connectivity gap → an unresolved question. */
function arduinoFixture() {
  return {
    format: 'wireup-spec-graph',
    version: 1,
    project_id: 'proj_arduino',
    title: 'Arduino Uno Web Status Monitor',
    raw_prompt: 'arduino uno + led + external website status + button',
    domain: 'embedded-iot',
    status: 'draft',
    branches: [],
    question_queue: [],
    assumption_log: [],
    nodes: {
      node_power_01: {
        id: 'node_power_01',
        domain: 'power',
        title: '5V Regulated Power Rail',
        status: 'validated',
        spec: { voltage_v: 5, rail_budget_ma: 500, supply_rail: '5v' },
        requires: [],
        spawned: [],
        assumptions: [],
        open_questions: [],
        known_uncertainty: [],
        validation: { checked: false, issues: [] },
      },
      node_board_01: {
        id: 'node_board_01',
        domain: 'controller',
        title: 'Arduino Uno R3 Board',
        status: 'validated',
        spec: { mcu: 'ATmega328P', logic_v: 5, wifi: false, supply_rail: '5v', power_draw_ma: 100 },
        requires: ['node_power_01'],
        spawned: ['node_connectivity_01'],
        assumptions: [],
        open_questions: [],
        known_uncertainty: [],
        validation: { checked: false, issues: [] },
      },
      node_connectivity_01: {
        id: 'node_connectivity_01',
        domain: 'connectivity',
        title: 'Wi-Fi Module for Status Reporting',
        status: 'unresolved',
        spec: {},
        requires: ['node_power_01', 'node_board_01'],
        spawned: ['node_firmware_wifi_01'],
        assumptions: [],
        open_questions: [
          {
            id: 'connectivity_module',
            q: 'Do you already have an ESP8266/ESP32, or should the Uno stay wifi-less and use an Ethernet shield instead?',
            why_blocking: 'wiring diagram and firmware differ completely between the two paths',
            options: ['ESP8266 (serial bridge)', 'ESP32 (replaces Uno)', 'Ethernet shield', 'none of these'],
            default: 'ESP8266 (serial bridge)',
          },
        ],
        known_uncertainty: [],
        validation: { checked: false, issues: [] },
      },
      node_firmware_wifi_01: {
        id: 'node_firmware_wifi_01',
        domain: 'firmware',
        title: 'Arduino WiFi HTTP Post Firmware Loop',
        status: 'validated',
        spec: { loop_hz: 10 },
        requires: ['node_connectivity_01'],
        spawned: [],
        assumptions: [],
        open_questions: [],
        known_uncertainty: ['HTTP endpoint reachability depends on the user network'],
        validation: { checked: false, issues: [] },
      },
    },
  };
}

describe('SpecGraph engine — deterministic validation, propagation and handoff', () => {
  it('finalizes a flattened manifest: branches, question queue, statuses', () => {
    const graph = finalizeSpecGraph(arduinoFixture());
    const parsed = specGraphProjectSchema.safeParse(graph);
    assert.equal(parsed.success, true);

    assert.equal(graph.status, 'awaiting_user');
    assert.equal(graph.question_queue.length, 1);
    assert.equal(graph.question_queue[0].id, 'connectivity_module');
    assert.ok(graph.branches.length >= 4);
    // The unresolved connectivity node keeps its question and stays unresolved.
    assert.equal(graph.nodes.node_connectivity_01.status, 'unresolved');
  });

  it('walks dirty propagation over `requires` only — `spawned` edges play no part', () => {
    const graph = finalizeSpecGraph(arduinoFixture());
    const updated = applyUserAnswersToSpecGraph(graph, {
      connectivity_module: 'ESP8266 (serial bridge)',
    });

    assert.equal(updated.nodes.node_connectivity_01.status, 'user_confirmed');
    assert.equal(updated.question_queue.length, 0);
    assert.equal(isSpecGraphReadyForHandoff(updated), true);
    // firmware required connectivity, so it re-validated cleanly.
    assert.equal(updated.nodes.node_firmware_wifi_01.status, 'validated');
  });

  it('builds the reverse `requires` index used for propagation', () => {
    const index = buildRequiredByIndex(arduinoFixture().nodes);
    assert.deepEqual(index.get('node_power_01').sort(), ['node_board_01', 'node_connectivity_01']);
    assert.deepEqual(index.get('node_connectivity_01'), ['node_firmware_wifi_01']);
  });

  it('spawns a resource_allocation node on a genuine I2C address collision', () => {
    const fixture = arduinoFixture();
    // Two nodes pinned to the same fixed I2C address → contention.
    fixture.nodes.node_sensor_a = {
      id: 'node_sensor_a', domain: 'sensor', title: 'Sensor A', status: 'validated',
      spec: { i2c_address: '0x29' }, requires: ['node_power_01'], spawned: [],
      assumptions: [], open_questions: [], known_uncertainty: [],
      validation: { checked: false, issues: [] },
    };
    fixture.nodes.node_sensor_b = {
      id: 'node_sensor_b', domain: 'sensor', title: 'Sensor B', status: 'validated',
      spec: { i2c_address: '0x29' }, requires: ['node_power_01'], spawned: [],
      assumptions: [], open_questions: [], known_uncertainty: [],
      validation: { checked: false, issues: [] },
    };

    const log = [];
    detectResourceContention(fixture.nodes, log);

    const allocNode = Object.values(fixture.nodes).find((n) => n.domain === 'resource_allocation');
    assert.ok(allocNode, 'expected a resource_allocation node');
    assert.ok(allocNode.requires.includes('node_sensor_a'));
    assert.ok(allocNode.requires.includes('node_sensor_b'));
    assert.equal(allocNode.status, 'assumed');
    assert.equal(log.length, 1);
  });

  it('does NOT spawn a resource_allocation node when two I2C devices do not collide', () => {
    const fixture = arduinoFixture();
    fixture.nodes.node_sensor_a = {
      id: 'node_sensor_a', domain: 'sensor', title: 'Sensor A', status: 'validated',
      spec: { i2c_address: '0x29' }, requires: [], spawned: [],
      assumptions: [], open_questions: [], known_uncertainty: [],
      validation: { checked: false, issues: [] },
    };
    fixture.nodes.node_sensor_b = {
      id: 'node_sensor_b', domain: 'sensor', title: 'Sensor B', status: 'validated',
      spec: { i2c_address: '0x76' }, requires: [], spawned: [],
      assumptions: [], open_questions: [], known_uncertainty: [],
      validation: { checked: false, issues: [] },
    };

    const log = [];
    detectResourceContention(fixture.nodes, log);
    assert.equal(
      Object.values(fixture.nodes).some((n) => n.domain === 'resource_allocation'),
      false,
    );
  });

  it('converts the spec graph into an architecture twin with requires + spawned edges', () => {
    const graph = finalizeSpecGraph(arduinoFixture());
    const arch = specGraphToArchitectureGraph(graph);

    assert.equal(arch.project, 'Arduino Uno Web Status Monitor');
    assert.ok(arch.nodes.length >= 4);

    const requires = arch.connections.filter((c) => c.label === 'requires' && c.kind === 'dependency');
    const spawned = arch.connections.filter((c) => c.label === 'spawned' && c.kind === 'other');
    assert.ok(requires.length >= 3);
    assert.ok(spawned.length >= 1);
  });
});
