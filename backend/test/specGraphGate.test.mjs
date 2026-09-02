/**
 * The ask/assume gate and the generic capability decomposition.
 *
 * These pin the behaviour that was broken before: every brief — not just the
 * drone/robot keywords — went through a canned list of three questions
 * (board / wifi / sample-interval) that had nothing to do with what was asked.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { disableBedrockEnv } from './bedrockStub.mjs';

// Force the deterministic path — no LLM credentials may leak in from the host env.
disableBedrockEnv();

const { decomposePromptToSpecGraph, specGraphProjectSchema } = await import(
  '../src/agentic/specGraph.ts'
);
const { evaluateAskGate } = await import('../src/agentic/capabilityEngine.ts');
const { interpretDeterministically } = await import('../src/agentic/architect.ts');

const ids = (graph) => graph.question_queue.map((q) => q.id);
const nodeIds = (graph) => Object.keys(graph.nodes);

describe('ask/assume gate', () => {
  it('asks only when blocking AND multi-valued AND not inferable', () => {
    assert.equal(evaluateAskGate({ blocking: true, multiValued: true, inferable: false }).ask, true);

    // Fail any single leg and it becomes an assumption.
    assert.equal(evaluateAskGate({ blocking: false, multiValued: true, inferable: false }).ask, false);
    assert.equal(evaluateAskGate({ blocking: true, multiValued: false, inferable: false }).ask, false);
    assert.equal(evaluateAskGate({ blocking: true, multiValued: true, inferable: true }).ask, false);
  });

  it('records which legs passed so the human can audit the decision', () => {
    const verdict = evaluateAskGate({ blocking: true, multiValued: true, inferable: false });
    assert.equal(verdict.verdict, 'ask');
    assert.equal(verdict.blocking, true);
    assert.equal(verdict.multi_valued_no_safe_default, true);
    assert.equal(verdict.not_inferable, true);
    assert.match(verdict.reason, /Asked:/);

    const assumed = evaluateAskGate({ blocking: false, multiValued: true, inferable: false });
    assert.equal(assumed.verdict, 'assume');
    assert.match(assumed.reason, /Assumed:/);
  });
});

describe('generic decomposition (no canned question list)', () => {
  it('never returns the old three canned questions for a complete brief', () => {
    // The ⭐ suggestion on page 01. The board is named, so "which board?" is
    // inferable; the sample interval is not blocking. Only the Wi-Fi
    // credential — something no engine can invent — survives the gate.
    const graph = decomposePromptToSpecGraph({
      prompt:
        'a dht22 sensor i have and esp32, then i want codes and a website to access this on my local computer',
    });

    assert.deepEqual(ids(graph), ['wifi_mode']);
    assert.ok(!ids(graph).includes('board'), 'board is named in the brief — never asked');
    assert.ok(
      !ids(graph).includes('sample-interval'),
      'sample interval has a safe default — never asked',
    );
  });

  it('asks for a board only when the brief names none', () => {
    const named = decomposePromptToSpecGraph({ prompt: 'esp32 with a dht22 sensor' });
    assert.ok(!ids(named).includes('board'), 'an esp32 is named');

    const unnamed = decomposePromptToSpecGraph({ prompt: 'read the temperature and show it' });
    assert.ok(ids(unnamed).includes('board'), 'no board named → blocking and not inferable');
  });

  it('spawns a connectivity gap question when the board has no radio — the spec-doc trace', () => {
    // The canonical example: an Uno cannot reach the website the brief asks
    // for, and there is no safe default between the three real resolutions.
    const graph = decomposePromptToSpecGraph({
      prompt: 'arduino uno + led + external website status + button',
    });

    assert.ok(nodeIds(graph).includes('node_mcu'));
    assert.equal(graph.nodes['node_mcu'].spec.board_id, 'arduino-uno');
    assert.equal(graph.nodes['node_mcu'].spec.wifi, false);

    assert.ok(
      ids(graph).includes('connectivity_bridge'),
      `expected a connectivity gap question, got ${JSON.stringify(ids(graph))}`,
    );

    const question = graph.question_queue.find((q) => q.id === 'connectivity_bridge');
    assert.ok(question.options.includes('Wired Ethernet shield'));
    assert.equal(question.gate.ask, true);
    assert.equal(question.gate.blocking, true);
    assert.equal(question.gate.multi_valued_no_safe_default, true);
    assert.equal(question.gate.not_inferable, true);
  });

  it('never asks about the LED — one correct answer exists, so it is assumed', () => {
    const graph = decomposePromptToSpecGraph({ prompt: 'arduino uno + led + button' });
    const led = graph.nodes['node_light'];
    assert.ok(led, 'an LED node exists');
    assert.equal(led.open_questions.length, 0);
    assert.ok(led.assumptions.length > 0, 'the resistor/pin decision is logged instead');
  });

  it('never spawns an enclosure node unless the brief mentions one', () => {
    const plain = decomposePromptToSpecGraph({ prompt: 'esp32 with a dht22 sensor' });
    assert.ok(!nodeIds(plain).includes('node_enclosure'));

    const asked = decomposePromptToSpecGraph({
      prompt: 'esp32 with a dht22 sensor in a 3d printed weatherproof enclosure',
    });
    assert.ok(nodeIds(asked).includes('node_enclosure'));
  });

  it('grounds sensor nodes in the knowledge base, with real pins', () => {
    const graph = decomposePromptToSpecGraph({
      prompt: 'esp32 with a dht22 sensor and a 5v relay to control a fan, web dashboard on pc',
    });

    assert.ok(nodeIds(graph).includes('node_temp_sensor'));
    assert.ok(nodeIds(graph).includes('node_relay'));
    assert.ok(nodeIds(graph).includes('node_software_dashboard'));

    const sensor = graph.nodes['node_temp_sensor'];
    assert.equal(sensor.spec.device_id, 'dht22');
    assert.equal(sensor.spec.pin, 'GPIO4');
    assert.deepEqual(sensor.spec.metrics, ['temperature_c', 'humidity_pct']);

    // A 5 V relay on a 3.3 V board must be called out, not silently wired.
    assert.match(graph.nodes['node_relay'].assumptions[0].claim, /level shifter/i);
  });

  it('propagates dirty state along produces edges', () => {
    const graph = decomposePromptToSpecGraph({
      prompt: 'esp32 with a dht22 sensor and a website to see the data',
    });

    // The connectivity node is unresolved (Wi-Fi credentials), and the
    // dashboard depends on it — so the dashboard cannot claim to be decided.
    assert.equal(graph.nodes['node_connectivity'].status, 'unresolved');
    assert.equal(graph.nodes['node_software_dashboard'].status, 'needs_revalidation');
  });

  it('titles the project from the brief, with acronyms intact', () => {
    const graph = decomposePromptToSpecGraph({
      prompt: 'esp32 with a dht22 sensor and a website to access this on my local computer',
    });
    assert.match(graph.project.title, /DHT22/);
    assert.doesNotMatch(graph.project.title, /Dht22/);
    assert.doesNotMatch(graph.project.title, /Esp32/);
  });

  it('still produces a schema-valid graph for the drone path', () => {
    const graph = decomposePromptToSpecGraph({
      prompt: 'a drone that follows me with a camera and avoids obstacles',
    });
    assert.equal(specGraphProjectSchema.safeParse(graph).success, true);
    assert.ok(nodeIds(graph).includes('node_flight_controller'));
    // Every drone question now carries a gate verdict, not `undefined`.
    for (const question of graph.question_queue) {
      assert.ok(question.gate, `question ${question.id} has no gate verdict`);
      assert.ok(typeof question.gate.reason === 'string' && question.gate.reason.length > 0);
    }
  });
});

describe('interpretDeterministically', () => {
  it('routes every brief through the spec graph, not just drones', () => {
    const result = interpretDeterministically({
      brief: 'esp32 with a soil moisture sensor and a relay to water my plant',
    });

    assert.ok(result.specGraph, 'the spec graph comes back with the interpretation');
    assert.ok(Object.keys(result.specGraph.nodes).length >= 3);
    assert.ok(result.assumptions.length > 0, 'assumptions are surfaced for audit');
  });

  it('exposes the gate reason as the question justification', () => {
    const result = interpretDeterministically({
      brief: 'read the temperature and humidity and show it on a website',
    });
    assert.ok(result.questions.length > 0);
    for (const question of result.questions) {
      assert.ok(question.why && question.why.length > 10, 'every question explains itself');
      assert.ok(question.default, 'every question has a default to accept in one click');
    }
  });

  it('stops asking once the question has been answered', () => {
    const brief = 'read the temperature and humidity and show it on a website';
    const first = interpretDeterministically({ brief });
    const answers = Object.fromEntries(first.questions.map((q) => [q.id, q.default]));
    const second = interpretDeterministically({ brief, answers });

    const stillAsked = second.questions.filter((q) => answers[q.id] !== undefined);
    assert.deepEqual(stillAsked, [], 'an answered question is never asked again');
  });
});
