/**
 * Regression tests for the firmware ⇄ software JSON contract + the voltage
 * rail rules. These pin the two failure modes that burned users:
 *
 *   1. FIELD-NOT-PUBLISHED ×3 with a frozen repair loop — an LLM firmware
 *      draft published `temperature`/`humidity`/`valid`/`timestamp` while the
 *      dashboard contract reads `temperature_c`/`humidity_pct`; the repair
 *      loop regenerated identical wiring every time. The contract is now a
 *      shared module, enforced at the firmware gate, and repaired by field
 *      mapping or a deterministic firmware swap.
 *
 *   2. VOLTAGE_MISMATCH blocking page 02 — "3V3" was parsed as a 3 V rail,
 *      so a valid ESP32→DHT22 plan was told to add a regulator. Rail labels
 *      are now normalised and parsed as 3.3 V.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Force the deterministic path — no LLM keys may leak in from the host env.
process.env.GROQ_API_KEY = '';
process.env.AWS_ACCESS_KEY_ID = '';
process.env.AWS_SECRET_ACCESS_KEY = '';
process.env.AGENTIC_TERMINAL_VALIDATION = '1';

const { extractPublishedJsonFields, mapMetricFieldsToFirmware } = await import(
  '../src/agentic/jsonContract.ts'
);
const { synthesizeFirmware } = await import('../src/agentic/firmwareSynth.ts');
const { synthesizeSoftware } = await import('../src/agentic/softwareSynth.ts');
const { validateFirmware } = await import('../src/agentic/firmwareValidator.ts');
const { validateSoftware } = await import('../src/agentic/softwareValidator.ts');
const { runAgenticPipeline } = await import('../src/agentic/pipeline.ts');
const { resolveBuildPlan } = await import('../src/agentic/planResolver.ts');
const { normaliseGraph } = await import('../src/schemas/architecture.ts');
const { runEngineeringChecks, hasBlockingIssue } = await import('../src/data/engineeringRules.ts');
const { repairGraph } = await import('../src/data/repairGraph.ts');
const { runStructuralChecks } = await import('../src/data/architectureVerifier.ts');
const { officialComponentCatalog } = await import('../src/data/componentCatalog.ts');
const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const path = await import('node:path');

const BRIEF = 'a dht22 sensor i have and esp32, then i want codes and a website to access this on my local computer';
const PROJECT = 'ESP32-DHT22 Environmental Monitor';

function dhtPlan() {
  const { plan } = resolveBuildPlan(BRIEF, PROJECT, normaliseGraph({}).graph);
  return plan;
}

/** Firmware the way the buggy LLM draft looked: flat field names that differ from the KB. */
function llmStyleFirmware() {
  return [
    {
      path: 'firmware/main.ino',
      content: `#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
WebServer server(80);
float t = 21.4f, h = 55.2f;
void handleSensors() {
  String json = "{";
  json += "\\"temperature\\":" + String(t, 1);
  json += ",\\"humidity\\":" + String(h, 1);
  json += ",\\"valid\\":true";
  json += ",\\"timestamp\\":" + String(millis());
  json += "}";
  server.send(200, "application/json", json);
}
void setup() { server.on("/api/sensors", handleSensors); server.begin(); }
void loop() { server.handleClient(); }
`,
    },
  ];
}

describe('json contract', () => {
  it('extracts the fields the deterministic DHT22 firmware actually publishes', () => {
    const firmware = synthesizeFirmware(dhtPlan());
    const fields = extractPublishedJsonFields(firmware.files.map((f) => f.content));
    for (const required of ['temperature_c', 'humidity_pct', 'state', 'uptime_s', 'sample_ts_ms']) {
      assert.ok(fields.includes(required), `expected "${required}" in ${JSON.stringify(fields)}`);
    }
  });

  it('extracts the fields of an LLM-style draft (escaped string form)', () => {
    const fields = extractPublishedJsonFields(llmStyleFirmware().map((f) => f.content));
    assert.ok(fields.includes('temperature'));
    assert.ok(fields.includes('humidity'));
    assert.ok(!fields.includes('temperature_c'), 'the LLM draft does NOT publish the contract field');
  });

  it('firmware gate rejects a draft that breaks the dashboard contract', async () => {
    const report = await validateFirmware(llmStyleFirmware(), {
      workDir: mkdtempSync(path.join(tmpdir(), 'wireup-contract-')),
      boardDefine: 'ESP32',
      expectedJsonFields: ['temperature_c', 'humidity_pct', 'state'],
    });
    assert.equal(report.ok, false, JSON.stringify(report.checks, null, 2));
    const missing = report.findings.filter((f) => f.code === 'FW-CONTRACT-FIELD').map((f) => f.message);
    assert.ok(missing.some((m) => m.includes('temperature_c')), `expected temperature_c missing: ${JSON.stringify(missing)}`);
    assert.ok(missing.some((m) => m.includes('humidity_pct')), `expected humidity_pct missing: ${JSON.stringify(missing)}`);
  });

  it('firmware gate passes the deterministic firmware', async () => {
    const firmware = synthesizeFirmware(dhtPlan());
    const report = await validateFirmware(firmware.files, {
      workDir: mkdtempSync(path.join(tmpdir(), 'wireup-contract-')),
      boardDefine: dhtPlan().board.archDefine,
      expectedJsonFields: ['temperature_c', 'humidity_pct', 'state'],
    });
    assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
  });

  it('maps KB metrics onto the fields an LLM draft publishes', () => {
    const plan = dhtPlan();
    const { overrides, unmapped } = mapMetricFieldsToFirmware(plan, ['temperature', 'humidity', 'valid', 'timestamp']);
    assert.equal(unmapped.length, 0);
    assert.equal(overrides['temperature'], 'temperature');
    assert.equal(overrides['humidity'], 'humidity');

    // A firmware publishing nothing useful cannot be mapped — swap it.
    const bad = mapMetricFieldsToFirmware(plan, ['foo', 'bar']);
    assert.ok(bad.unmapped.includes('temperature'));
  });

  it('software generated with field overrides passes the field-coverage check', async () => {
    const plan = dhtPlan();
    const firmware = synthesizeFirmware(plan);
    const fields = extractPublishedJsonFields(firmware.files.map((f) => f.content));

    // Simulate the LLM-draft world: firmware fields are flat names, spec is re-pointed.
    const llmFields = ['temperature', 'humidity', 'state', 'valid', 'timestamp'];
    const { overrides } = mapMetricFieldsToFirmware(plan, llmFields);
    const software = await synthesizeSoftware(plan, overrides);
    const spec = software.files.find((f) => f.path === 'frontend/src/lib/deviceSpec.ts');
    assert.ok(spec?.content.includes("path: 'temperature.temperature'"));
    assert.ok(spec?.content.includes("path: 'humidity.humidity'"));

    const report = await validateSoftware(software.files, {
      workDir: mkdtempSync(path.join(tmpdir(), 'wireup-contract-')),
      devicePort: 80,
      firmwareJsonFields: llmFields,
      terminal: false,
    });
    assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
    void fields;
  });
});

describe('voltage rails', () => {
  const dht22 = {
    id: 'dht22-sensor',
    type: 'sensor',
    name: 'DHT22/AM2302',
    partNumber: 'DHT22',
    x: 100,
    y: 100,
    ports: [{ id: 'dht22-vcc', label: 'VCC', direction: 'in', signal: 'power' }],
  };
  const mcu = {
    id: 'esp32-devkit',
    type: 'controller',
    name: 'ESP32-DevKitC',
    partNumber: 'ESP32-DEVKIT',
    x: 0,
    y: 0,
    ports: [{ id: 'mcu-3v3', label: '3V3', direction: 'out', signal: 'power' }],
  };

  it('does not flag 3V3 → DHT22 as a voltage mismatch', () => {
    const graph = normaliseGraph({
      project: 'x',
      nodes: [mcu, dht22],
      connections: [
        { id: 'c1', from: 'esp32-devkit', to: 'dht22-sensor', fromPort: 'mcu-3v3', toPort: 'dht22-vcc', label: '3V3', kind: 'power' },
      ],
    }).graph;
    const issues = runEngineeringChecks(graph, null);
    const voltageIssues = issues.filter((i) => i.code === 'VOLTAGE_MISMATCH');
    assert.equal(voltageIssues.length, 0, JSON.stringify(voltageIssues, null, 2));
    assert.equal(hasBlockingIssue(issues), false, JSON.stringify(issues, null, 2));
  });

  it('normalises 3V3 rail labels during graph repair', () => {
    const { graph, repairs } = repairGraph({ nodes: [mcu, dht22], connections: [] });
    const port = graph.nodes.find((n) => n.id === 'esp32-devkit')?.ports?.[0];
    assert.equal(port?.label, '3.3 V');
    assert.ok(repairs.some((r) => r.code === 'PORT_RAIL_NORMALISED'));
    const checks = runStructuralChecks(graph, officialComponentCatalog);
    assert.ok(checks.length > 0);
  });
});

describe('agentic pipeline end-to-end (the build the user runs)', () => {
  it('ships firmware + software zips that validate and agree', async () => {
    const events = [];
    let result = null;
    let failure = null;

    await runAgenticPipeline(
      {
        brief: BRIEF,
        projectName: PROJECT,
        graph: normaliseGraph({}).graph,
        provider: undefined,
      },
      (event) => {
        events.push(event);
        if (event.type === 'result') result = event.result;
        if (event.type === 'error') failure = event.message;
      },
    );

    assert.equal(failure, null, `pipeline errored: ${failure}\n${events.filter((e) => e.type === 'error' || e.tone === 'error').map((e) => JSON.stringify(e)).join('\n')}`);
    assert.ok(result, 'no result artifact');
    assert.equal(result.validation.firmware.ok, true, 'firmware must validate');
    assert.equal(result.validation.software.ok, true, 'software must validate');
    assert.equal(result.validation.consistency.ok, true, 'contract must agree');

    const spec = result.software.files.find((f) => f.path === 'frontend/src/lib/deviceSpec.ts');
    assert.ok(spec?.content.includes("path: 'temperature.temperature_c'"));
    assert.ok(spec?.content.includes("path: 'humidity.humidity_pct'"));
  });
});
