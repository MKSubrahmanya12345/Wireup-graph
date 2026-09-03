import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const {
  specGraphProjectSchema,
  finalizeSpecGraph,
  applyUserAnswersToSpecGraph,
  isSpecGraphReadyForHandoff,
  specGraphToArchitectureGraph,
  buildRequiredByIndex,
  detectResourceContention,
  runSpecValidationPass,
  saveSpecGraphToDisk,
  loadSpecGraphBranchFromDisk,
  I2C_MUX_ADDRESS,
} = await import('../src/agentic/specGraph.ts');

/** Node factory — every field the schema expects, none of the ceremony. */
function makeNode(id, domain, title, spec, extra = {}) {
  return {
    id,
    domain,
    title,
    status: 'validated',
    spec,
    requires: [],
    spawned: [],
    assumptions: [],
    open_questions: [],
    known_uncertainty: [],
    validation: { checked: false, issues: [] },
    ...extra,
  };
}

function project(nodes, extra = {}) {
  return {
    format: 'wireup-spec-graph',
    version: 1,
    project_id: 'proj_test',
    title: 'Test Project',
    raw_prompt: 'arduino uno + led + external website status + button',
    domain: 'embedded-iot',
    status: 'draft',
    branches: [],
    question_queue: [],
    assumption_log: [],
    nodes,
    ...extra,
  };
}

/** A hand-built Arduino Uno project: connectivity gap → an unresolved question. */
function arduinoProject() {
  return project({
    node_power_01: makeNode('node_power_01', 'power', '5V Regulated Power Rail', {
      voltage_v: 5,
      rail_budget_ma: 500,
      supply_rail: '5v',
    }),
    node_board_01: makeNode(
      'node_board_01',
      'controller',
      'Arduino Uno R3 Board',
      { mcu: 'ATmega328P', logic_v: 5, wifi: false, supply_rail: '5v', power_draw_ma: 100 },
      {
        requires: ['node_power_01'],
        spawned: ['node_connectivity_01'],
      },
    ),
    node_connectivity_01: makeNode(
      'node_connectivity_01',
      'connectivity',
      'Wi-Fi Module for Status Reporting',
      {},
      {
        status: 'unresolved',
        requires: ['node_power_01', 'node_board_01'],
        spawned: ['node_firmware_wifi_01'],
        open_questions: [
          {
            id: 'connectivity_module',
            q: 'Do you already have an ESP8266/ESP32, or should the Uno stay wifi-less and use an Ethernet shield instead?',
            why_blocking: 'wiring diagram and firmware differ completely between the two paths',
            options: ['ESP8266 (serial bridge)', 'ESP32 (replaces Uno)', 'Ethernet shield', 'none of these'],
            default: 'ESP8266 (serial bridge)',
          },
        ],
      },
    ),
    node_firmware_wifi_01: makeNode(
      'node_firmware_wifi_01',
      'firmware',
      'Arduino WiFi HTTP Post Firmware Loop',
      { loop_hz: 10 },
      {
        requires: ['node_connectivity_01'],
        known_uncertainty: ['HTTP endpoint reachability depends on the user network'],
      },
    ),
  });
}

const allocators = (nodes) => Object.values(nodes).filter((n) => n.domain === 'resource_allocation');

describe('SpecGraph engine — deterministic validation, propagation and handoff', () => {
  it('finalizes a pointer-based manifest: branches, question queue, statuses (§2)', () => {
    const graph = finalizeSpecGraph(arduinoProject());
    const parsed = specGraphProjectSchema.safeParse(graph);
    assert.equal(parsed.success, true);

    assert.equal(graph.status, 'awaiting_user');
    // §2: the queue holds POINTERS into node.open_questions, never copies.
    assert.deepEqual(graph.question_queue, [
      { node_id: 'node_connectivity_01', question_id: 'connectivity_module' },
    ]);
    assert.ok(graph.branches.length >= 4);
    // The unresolved connectivity node keeps its question and stays unresolved.
    assert.equal(graph.nodes.node_connectivity_01.status, 'unresolved');
    assert.equal(isSpecGraphReadyForHandoff(graph), false);
  });

  it('gives every question a globally-unique id — no silent queue dedupe (§5)', () => {
    const graph = finalizeSpecGraph(
      project({
        node_x_01: makeNode('node_x_01', 'connectivity', 'X', {}, {
          status: 'unresolved',
          open_questions: [{ q: 'which module?', why_blocking: 'wiring differs', options: ['a', 'b'] }],
        }),
        node_y_01: makeNode('node_y_01', 'power', 'Y', {}, {
          status: 'unresolved',
          open_questions: [{ q: 'which battery?', why_blocking: 'mass differs', options: ['a', 'b'] }],
        }),
      }),
    );
    // Missing ids were per-node namespaced, so two id-less questions survive.
    assert.equal(graph.question_queue.length, 2);
    const ids = graph.question_queue.map((p) => p.question_id);
    assert.equal(new Set(ids).size, 2);
    assert.deepEqual([...ids].sort(), ['node_x_01-q1', 'node_y_01-q1']);
  });

  it('rewrites duplicate LLM question ids instead of collapsing real questions', () => {
    const graph = finalizeSpecGraph(
      project({
        node_x_01: makeNode('node_x_01', 'connectivity', 'X', {}, {
          status: 'unresolved',
          open_questions: [{ id: 'module', q: 'which wifi module?', why_blocking: 'x', options: ['a'] }],
        }),
        node_y_01: makeNode('node_y_01', 'power', 'Y', {}, {
          status: 'unresolved',
          open_questions: [{ id: 'module', q: 'which battery?', why_blocking: 'x', options: ['a'] }],
        }),
      }),
    );
    assert.equal(graph.question_queue.length, 2);
    assert.ok(graph.question_queue.some((p) => p.question_id === 'module'));
    assert.ok(graph.question_queue.some((p) => p.question_id === 'node_y_01-module'));
  });

  it('applies answers by EXACT id or exact text — never substring — and logs the decision (§5)', () => {
    const graph = finalizeSpecGraph(arduinoProject());

    // Substring of the question text must NOT route (regression: includes-matching).
    const untouched = applyUserAnswersToSpecGraph(graph, { ESP8266: 'ESP32 (replaces Uno)' });
    assert.equal(untouched.nodes.node_connectivity_01.status, 'unresolved');
    assert.equal(untouched.nodes.node_connectivity_01.open_questions.length, 1);
    assert.equal(untouched.assumption_log.length, 0);

    // Unknown key is a no-op, not a crash.
    const noOp = applyUserAnswersToSpecGraph(graph, { 'totally-unknown-key': 'x' });
    assert.equal(noOp.assumption_log.length, 0);

    // Exact id routes; the decision is preserved as an assumption ON the node
    // and the pointer log picks it up like every other silent decision.
    const updated = applyUserAnswersToSpecGraph(graph, {
      connectivity_module: 'ESP8266 (serial bridge)',
    });
    assert.equal(updated.nodes.node_connectivity_01.status, 'user_confirmed');
    assert.equal(updated.nodes.node_connectivity_01.open_questions.length, 0);
    assert.equal(updated.nodes.node_connectivity_01.assumptions.length, 1);
    assert.equal(updated.assumption_log.length, 1);
    assert.deepEqual(updated.assumption_log[0], { node_id: 'node_connectivity_01', index: 0 });

    // Exact verbatim question text also routes.
    const byText = applyUserAnswersToSpecGraph(graph, {
      'Do you already have an ESP8266/ESP32, or should the Uno stay wifi-less and use an Ethernet shield instead?':
        'Ethernet shield',
    });
    assert.equal(byText.nodes.node_connectivity_01.status, 'user_confirmed');
  });

  it('walks dirty propagation over `requires` only — `spawned` edges play no part', () => {
    const graph = finalizeSpecGraph(arduinoProject());
    const updated = applyUserAnswersToSpecGraph(graph, {
      connectivity_module: 'ESP8266 (serial bridge)',
    });

    assert.equal(updated.question_queue.length, 0);
    assert.equal(updated.status, 'ready_for_build');
    assert.equal(isSpecGraphReadyForHandoff(updated), true);
    // firmware required connectivity, so it re-validated cleanly — even though
    // it carries a known_uncertainty, which never blocks validation (§6).
    assert.equal(updated.nodes.node_firmware_wifi_01.status, 'validated');
    assert.equal(updated.nodes.node_firmware_wifi_01.known_uncertainty.length, 1);
  });

  it('builds the reverse `requires` index used for propagation', () => {
    const index = buildRequiredByIndex(arduinoProject().nodes);
    assert.deepEqual(index.get('node_power_01').sort(), ['node_board_01', 'node_connectivity_01']);
    assert.deepEqual(index.get('node_connectivity_01'), ['node_firmware_wifi_01']);
  });

  it('spawns a resource_allocation node on a genuine I2C address collision — and resolves it with a multiplexer (§6a)', () => {
    const fixture = arduinoProject();
    fixture.nodes.node_sensor_a = makeNode('node_sensor_a', 'sensor', 'Sensor A', {
      i2c_address: '0x29',
    });
    fixture.nodes.node_sensor_b = makeNode('node_sensor_b', 'sensor', 'Sensor B', {
      i2c_address: '0x29',
    });

    const graph = finalizeSpecGraph(fixture);
    const allocator = allocators(graph.nodes)[0];
    assert.ok(allocator, 'expected a resource_allocation node');
    assert.equal(allocator.requires.includes('node_sensor_a'), true);
    assert.equal(allocator.requires.includes('node_sensor_b'), true);
    assert.equal(allocator.status, 'assumed');
    assert.equal(allocator.spec.resolution_status, 'resolved');
    assert.deepEqual(allocator.spec.mux, { part_class: 'TCA9548A', i2c_address: I2C_MUX_ADDRESS });
    assert.equal(allocator.assumptions.length, 1);
    // Lineage: the validation pass, not any single device node.
    assert.equal(allocator.spec.spawned_by, 'cross-node-validation');

    // Idempotent: re-running detection (what answer-apply does) neither
    // re-spawns, overwrites, nor duplicates the logged assumption.
    detectResourceContention(graph.nodes);
    detectResourceContention(graph.nodes);
    assert.equal(allocators(graph.nodes).length, 1);
    assert.equal(allocators(graph.nodes)[0].assumptions.length, 1);
  });

  it('re-maps an address-configurable contender to an address it actually supports', () => {
    const fixture = arduinoProject();
    fixture.nodes.node_sensor_a = makeNode('node_sensor_a', 'sensor', 'Sensor A', {
      i2c_address: '0x29',
    });
    fixture.nodes.node_sensor_b = makeNode('node_sensor_b', 'sensor', 'Sensor B', {
      i2c_address: '0x29',
      i2c_address_alt: ['0x2b', '0x2c'],
    });

    const graph = finalizeSpecGraph(fixture);
    const allocator = allocators(graph.nodes)[0];
    assert.ok(allocator);
    // Moved onto a DECLARED alternative — never an invented address.
    assert.equal(graph.nodes.node_sensor_b.spec.i2c_address, '0x2b');
    assert.equal(graph.nodes.node_sensor_b.spec.i2c_address_previous, '0x29');
    assert.equal(allocator.spec.mux, undefined); // re-map beats the multiplexer
    assert.deepEqual(allocator.spec.moves, [
      { node_id: 'node_sensor_b', field: 'i2c_address', from: '0x29', to: '0x2b' },
    ]);
    // The moved node was marked for re-validation and re-validated clean.
    assert.equal(graph.nodes.node_sensor_b.status, 'validated');
  });

  it('does NOT spawn a resource_allocation node when two I2C devices do not collide', () => {
    const fixture = arduinoProject();
    fixture.nodes.node_sensor_a = makeNode('node_sensor_a', 'sensor', 'Sensor A', {
      i2c_address: '0x29',
    });
    fixture.nodes.node_sensor_b = makeNode('node_sensor_b', 'sensor', 'Sensor B', {
      i2c_address: '0x76',
    });

    const graph = finalizeSpecGraph(fixture);
    assert.equal(allocators(graph.nodes).length, 0);
  });

  it('re-assigns collided gpio pins to the first free pin in the same family', () => {
    const fixture = arduinoProject();
    fixture.nodes.node_input_a = makeNode('node_input_a', 'interface', 'Button A', {
      gpio_pins: ['D2'],
    });
    fixture.nodes.node_input_b = makeNode('node_input_b', 'interface', 'Button B', {
      gpio_pins: ['D2', 'D3'],
    });

    const graph = finalizeSpecGraph(fixture);
    const allocator = allocators(graph.nodes)[0];
    assert.ok(allocator);
    assert.equal(allocator.spec.resolution_status, 'resolved');
    const moved = graph.nodes.node_input_b;
    // D2 stayed with the keeper (input_a); the whole array was re-homed, not
    // just the collided entry destroyed.
    assert.equal(moved.spec.gpio_pins.includes('D2'), false);
    assert.equal(moved.spec.gpio_pins.includes('D3'), true);
    assert.equal(moved.spec.gpio_pins.length, 2);
    assert.equal(allocator.spec.moves.length, 1);
    assert.equal(allocator.spec.moves[0].field, 'gpio_pins');
  });

  it('re-balances an overloaded power rail onto rails with declared headroom (§6)', () => {
    const graph = finalizeSpecGraph(
      project({
        node_power_5v: makeNode('node_power_5v', 'power', '5V Rail', {
          supply_rail: '5v',
          rail_budget_ma: 120,
        }),
        node_power_3v3: makeNode('node_power_3v3', 'power', '3V3 Rail', {
          supply_rail: '3v3',
          rail_budget_ma: 500,
        }),
        node_board: makeNode('node_board', 'controller', 'Board', {
          supply_rail: '5v',
          power_draw_ma: 100,
          voltage_v: 5,
        }),
        node_sensor: makeNode('node_sensor', 'sensor', 'Sensor', {
          supply_rail: '5v',
          power_draw_ma: 50,
          voltage_v: 3.3,
        }),
      }),
    );

    const allocator = allocators(graph.nodes)[0];
    assert.ok(allocator, 'rail overload must spawn an allocator');
    assert.equal(allocator.spec.resolution_status, 'resolved');
    // The smallest load moved to the voltage-compatible rail with headroom.
    assert.equal(graph.nodes.node_sensor.spec.supply_rail, '3v3');
    assert.deepEqual(allocator.spec.moves, [
      { node_id: 'node_sensor', field: 'supply_rail', from: '5v', to: '3v3' },
    ]);
    // Post-rebalance, the rail check clears and the graph is handoff-ready.
    assert.equal(graph.status, 'ready_for_build');
    assert.equal(isSpecGraphReadyForHandoff(graph), true);
  });

  it('blocks handoff when a rail overload has no resolution — instead of shipping it silently', () => {
    const graph = finalizeSpecGraph(
      project({
        node_power_5v: makeNode('node_power_5v', 'power', '5V Rail', {
          supply_rail: '5v',
          rail_budget_ma: 80,
        }),
        node_board: makeNode('node_board', 'controller', 'Board', {
          supply_rail: '5v',
          power_draw_ma: 100,
          voltage_v: 5,
        }),
      }),
    );

    const allocator = allocators(graph.nodes)[0];
    assert.ok(allocator);
    assert.equal(allocator.spec.resolution_status, 'unresolvable');
    assert.equal(allocator.status, 'needs_revalidation'); // error issue attached by validation
    // The supplier carries the §6 power-budget error.
    assert.ok(
      graph.nodes.node_power_5v.validation.issues.some(
        (issue) => issue.severity === 'error' && /Power budget overrun/.test(issue.message),
      ),
    );
    assert.equal(graph.status, 'blocked'); // no questions left, still not buildable
    assert.equal(isSpecGraphReadyForHandoff(graph), false);
  });

  it('surfaces bus-bandwidth contention as a blocking cross-node decision (§6a limb 3)', () => {
    const graph = finalizeSpecGraph(
      project({
        node_sensor_a: makeNode('node_sensor_a', 'sensor', 'Sensor A', {
          bus_id: 'i2c1',
          bus_bandwidth_pct: 60,
        }),
        node_sensor_b: makeNode('node_sensor_b', 'sensor', 'Sensor B', {
          bus_id: 'i2c1',
          bus_bandwidth_pct: 60,
        }),
      }),
    );
    const allocator = allocators(graph.nodes)[0];
    assert.ok(allocator);
    assert.equal(allocator.spec.resolution_status, 'unresolvable');
    assert.ok(/no individual node can decide/.test(allocator.spec.resolution_blocker));
    assert.equal(isSpecGraphReadyForHandoff(graph), false);
  });

  it('flags requires cycles as errors — ordering and propagation are undefined on them (§6)', () => {
    const graph = finalizeSpecGraph(
      project({
        node_a: makeNode('node_a', 'power', 'A', {}, { requires: ['node_b'] }),
        node_b: makeNode('node_b', 'power', 'B', {}, { requires: ['node_a'] }),
        node_c: makeNode('node_c', 'power', 'C', {}, { requires: ['node_a'] }),
      }),
    );
    assert.ok(
      graph.nodes.node_a.validation.issues.some((issue) => issue.severity === 'error' && /cycle/.test(issue.message)),
    );
    assert.equal(graph.nodes.node_a.status, 'needs_revalidation');
    assert.equal(graph.nodes.node_b.status, 'needs_revalidation');
    // node_c merely depends on the cycle — its own checks pass, so it stays
    // validated; blocking the graph is the cycle members' job.
    assert.equal(graph.nodes.node_c.status, 'validated');
    assert.equal(isSpecGraphReadyForHandoff(graph), false);
  });

  it('flags self-requires and dangling lineage edges', () => {
    const nodes = {
      node_a: makeNode('node_a', 'power', 'A', {}, { requires: ['node_a'], spawned: ['node_ghost'] }),
    };
    runSpecValidationPass(nodes);
    assert.ok(nodes.node_a.validation.issues.some((i) => i.severity === 'error' && /itself/.test(i.message)));
    assert.ok(nodes.node_a.validation.issues.some((i) => i.severity === 'warning' && /node_ghost/.test(i.message)));
  });

  it('converts the spec graph into an architecture twin with requires + spawned edges and resolved notes', () => {
    const graph = finalizeSpecGraph(arduinoProject());
    const updated = applyUserAnswersToSpecGraph(graph, {
      connectivity_module: 'ESP8266 (serial bridge)',
    });
    const arch = specGraphToArchitectureGraph(updated);

    assert.equal(arch.project, 'Test Project');
    assert.ok(arch.nodes.length >= 4);

    const requires = arch.connections.filter((c) => c.label === 'requires' && c.kind === 'dependency');
    const spawned = arch.connections.filter((c) => c.label === 'spawned' && c.kind === 'other');
    assert.ok(requires.length >= 3);
    assert.ok(spawned.length >= 1);
    // Notes dereference the pointer-based assumption log (§2) — no stale copies.
    assert.ok(arch.notes.length >= 1);
    assert.ok(arch.notes.some((note) => note.startsWith('[node_connectivity_01]')));
  });

  it('persists the §2 layout: manifest without node content, one file per node, branch-local loads', () => {
    const graph = applyUserAnswersToSpecGraph(finalizeSpecGraph(arduinoProject()), {
      connectivity_module: 'ESP8266 (serial bridge)',
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wireup-specgraph-'));

    saveSpecGraphToDisk(graph, dir);

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
    // Root manifest never holds full node content — pointers only (§2).
    assert.equal('nodes' in manifest, false);
    assert.equal(manifest.format, 'wireup-spec-graph');
    assert.equal(manifest.question_queue.length, 0);
    assert.equal(manifest.assumption_log.length, 1);
    const nodeFiles = fs.readdirSync(path.join(dir, 'nodes'));
    assert.equal(nodeFiles.length, Object.keys(graph.nodes).length);
    assert.ok(nodeFiles.includes('node_connectivity_01.json'));

    // §2's tractability rule: a branch load brings the branch + its DIRECT
    // requires neighbours only — never the whole graph.
    const { branchNodes } = loadSpecGraphBranchFromDisk(dir, 'node_firmware_wifi_01');
    assert.ok(branchNodes.node_firmware_wifi_01);
    assert.ok(branchNodes.node_connectivity_01); // direct requires neighbour
    assert.equal('node_power_01' in branchNodes, false); // not a direct neighbour
    assert.equal('node_board_01' in branchNodes, false);
  });
});
