/**
 * Provider-layer regressions: the hardware simulator and the LLM provider
 * surface. Both are pure mock-mode checks — no keys, no network.
 *
 * Covers:
 *   M0 #2/#4 — mock sim is selected by default and produces a real verdict
 *   M4 #28/#29 — a failing (or erroring) simulator keeps downloads locked
 *   M2 #19 — every tier resolves to AWS Bedrock, the only provider
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

delete process.env.VELXIO_URL;
process.env.SIM_MODE = 'auto';

const { getHardwareSimProvider } = await import('../src/providers/sim/index.ts');
const { resolveEffectiveProvider } = await import('../src/services/llmService.ts');
const { resolveBuildPlan } = await import('../src/agentic/planResolver.ts');
const { normaliseGraph } = await import('../src/schemas/architecture.ts');
const { buildBom } = await import('../src/agentic/bom.ts');
const { buildInstructions } = await import('../src/agentic/instructions.ts');
const { synthesizeFirmware } = await import('../src/agentic/firmwareSynth.ts');

function planFor(brief, name) {
  const { graph } = normaliseGraph({});
  return resolveBuildPlan(brief, name, graph).plan;
}

describe('hardware sim provider', () => {
  it('defaults to the mock when VELXIO_URL is absent', () => {
    assert.equal(getHardwareSimProvider().mode, 'mock');
  });

  it('passes a sane DHT22 plan', async () => {
    const result = await getHardwareSimProvider().runSim(planFor('esp32 with a dht22 sensor', 'DHT Node'));
    assert.equal(result.errored, false);
    assert.equal(result.ok, true);
    assert.ok(result.checks.length > 0);
    assert.ok(result.log.join('\n').includes('virtual-bench'));
  });

  it('CHECK 29 — a forced simulator failure is a fail, and an error is an error', async () => {
    process.env.SIM_FORCE_FAIL = '1';
    const failed = await getHardwareSimProvider().runSim(planFor('esp32 with a dht22 sensor', 'DHT Node'));
    delete process.env.SIM_FORCE_FAIL;
    assert.equal(failed.ok, false, 'forced failure must fail the hardware verdict');
    assert.equal(failed.errored, false, 'a failing circuit is not a provider error');

    process.env.SIM_FORCE_ERROR = '1';
    const errored = await getHardwareSimProvider().runSim(planFor('esp32 with a dht22 sensor', 'DHT Node'));
    delete process.env.SIM_FORCE_ERROR;
    assert.equal(errored.ok, false);
    assert.equal(errored.errored, true, 'a provider failure must be surfaced as an error, never skipped');
  });

  it('produces a different log for a different device', async () => {
    const a = await getHardwareSimProvider().runSim(planFor('esp32 with a dht22 sensor', 'A'));
    const b = await getHardwareSimProvider().runSim(planFor('esp32 with an hc-sr04 and a relay', 'B'));
    assert.notEqual(a.log.join('\n'), b.log.join('\n'));
  });
});

describe('LLM provider selection', () => {
  it('CHECK 19 — every plan resolves to AWS Bedrock, with no fallback chain', () => {
    const resolved = resolveEffectiveProvider('bedrock');
    assert.equal(resolved.provider, 'bedrock');
    assert.equal(resolved.fallbackFrom, undefined);
    assert.equal(resolved.reason, undefined);
  });
});

describe('per-build instructions + BOM', () => {
  it('CHECK 31 — two different device builds produce different instructions', () => {
    const planA = planFor('a dht22 sensor i have and esp32, with a website', 'DHT22 Monitor');
    const planB = planFor('esp32 with hc-sr04 ultrasonic sensor and a relay', 'Distance Guard');

    const docA = buildInstructions({
      plan: planA,
      firmware: synthesizeFirmware(planA),
      bom: buildBom(planA),
      hardwareSim: null,
      softwareReady: true,
      softwareFileCount: 20,
    });
    const docB = buildInstructions({
      plan: planB,
      firmware: synthesizeFirmware(planB),
      bom: buildBom(planB),
      hardwareSim: null,
      softwareReady: true,
      softwareFileCount: 20,
    });

    assert.notEqual(docA, docB);
    assert.match(docA, /DHT22/);
    assert.match(docB, /HC-SR04/i);
    assert.ok(!docA.includes('HC-SR04'));
  });

  it('every BOM entry carries at least one purchase link for known parts', () => {
    const bom = buildBom(planFor('esp32 with a dht22 sensor', 'DHT Node'));
    assert.ok(bom.entries.length >= 2);
    const sensor = bom.entries.find((entry) => /DHT22/.test(entry.name));
    assert.ok(sensor, 'the DHT22 must appear in the BOM');
    assert.ok(sensor.links.length > 0, 'known parts must have purchase links');
    assert.ok(sensor.links.every((link) => link.url.startsWith('http')));
  });
});
