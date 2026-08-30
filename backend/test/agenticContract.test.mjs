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
const { DEVICE_KNOWLEDGE } = await import('../src/agentic/knowledge/devices.ts');
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

    // ── The device IS the website now ─────────────────────────────────────
    const ino = result.firmware.files.find((f) => f.path.endsWith('.ino'));
    const sketch = ino?.content ?? '';
    for (const required of [
      'DASHBOARD_HTML',            // full embedded dashboard at /
      '/api/history',              // on-device ring-buffered history
      '/api/wifi',                 // change Wi-Fi without re-flashing
      'bodyOrArg',                 // form + JSON command parsing
      'ArduinoOTA',                // OTA updates
      'ENABLE_EMBEDDED_DASHBOARD',
      'ENABLE_OTA',
    ]) {
      assert.ok(sketch.includes(required), `firmware must include ${required}`);
    }

    // ── Controls transport: the scaffold sends form-encoded commands ──────
    const deviceClient = result.software.files.find(
      (f) => f.path === 'backend/src/services/deviceClient.ts',
    );
    assert.ok(
      deviceClient?.content.includes('application/x-www-form-urlencoded'),
      'control commands must be form-encoded (ESP32 server.arg parses form, not JSON)',
    );

    // ── History extracts numbers at the telemetry layer; live stays nested ─
    const telemetry = result.software.files.find(
      (f) => f.path === 'backend/src/routes/telemetry.ts',
    );
    assert.ok(
      telemetry?.content.includes('endpoint?.field'),
      'history must extract the metric field (no [object Object])',
    );
    assert.ok(
      telemetry?.content.includes('getPath'),
      'telemetry must use the dotted-path reader for extraction',
    );
    assert.ok(
      deviceClient?.content.includes('FULL payload'),
      'live readings must keep the full nested payload (metric paths resolve through the endpoint id)',
    );

    // ── The generated app was actually BOOTED, not just compiled ──────────
    const smokeCheck = result.validation.software.checks.find(
      (check) => check.name === 'runtime smoke (boot + live)',
    );
    assert.ok(smokeCheck, 'software validation must include the runtime smoke gate');
    assert.ok(smokeCheck.ok, smokeCheck?.detail);

    // ── LAN access: CORS is open, mDNS host wired ─────────────────────────
    const envExample = result.software.files.find((f) => f.path === 'backend/.env.example');
    assert.ok(envExample?.content.includes('CORS_ORIGIN=*'), 'dashboard must be openable from any LAN device');
    assert.ok(envExample?.content.includes('DEVICE_HOST='), 'mDNS hostname must be configurable');

    // ── Read endpoints carry the field they read ──────────────────────────
    const endpoints = result.software.files.find(
      (f) => f.path === 'backend/src/config/deviceEndpoints.ts',
    );
    assert.ok(endpoints?.content.includes("field: 'temperature_c'"));
    assert.ok(endpoints?.content.includes('env.DEVICE_HOST'));
  });

  it('generates form-or-JSON control routes for actuator builds', () => {
    const { plan } = resolveBuildPlan(
      'a relay and a dht22 on an esp32 with a website',
      PROJECT,
      normaliseGraph({}).graph,
    );
    const firmware = synthesizeFirmware(plan);
    const sketch = firmware.files.map((f) => f.content).join('\n');
    assert.ok(sketch.includes('bodyOrArg("state")'), 'toggle routes must parse form or JSON bodies');
  });
});

describe('page-01 answers and page-02 pins reach the build', () => {
  it('honors the sample-interval answer over the KB default', () => {
    const { plan } = resolveBuildPlan(BRIEF, PROJECT, normaliseGraph({}).graph, 60_000);
    assert.equal(plan.sampleIntervalMs, 60_000);
    const config = synthesizeFirmware(plan).files.find((f) => f.path === 'firmware/config.h')?.content ?? '';
    assert.ok(config.includes('#define SAMPLE_INTERVAL_MS 60000'), config.slice(0, 400));
  });

  it('honors pins declared on the approved graph (port labels)', () => {
    const graph = normaliseGraph({
      project: PROJECT,
      nodes: [
        {
          id: 'mcu-main',
          type: 'controller',
          name: 'ESP32 DevKit',
          partNumber: 'ESP32-DEVKIT',
          ports: [{ id: 'mcu-gpio-data', label: 'GPIO (assigned)', direction: 'bidirectional', signal: 'digital' }],
        },
        {
          id: 'sensor-dht22',
          type: 'sensor',
          name: 'DHT22 (AM2302) Temperature & Humidity Sensor',
          partNumber: 'AM2302',
          ports: [
            { id: 'sensor-dht22-vcc', label: 'VCC', direction: 'in', signal: 'power' },
            { id: 'sensor-dht22-gnd', label: 'GND', direction: 'in', signal: 'ground' },
            { id: 'sensor-dht22-data', label: 'DATA → GPIO16', direction: 'bidirectional', signal: 'digital' },
          ],
        },
      ],
      connections: [
        { id: 'c1', from: 'mcu-main', to: 'sensor-dht22', fromPort: 'mcu-gpio-data', toPort: 'sensor-dht22-data', label: 'GPIO16', kind: 'data' },
      ],
    }).graph;

    const { plan } = resolveBuildPlan(BRIEF, PROJECT, graph);
    assert.equal(plan.modules[0]?.pins.data, 'GPIO16', JSON.stringify(plan.modules[0]?.pins));

    const config = synthesizeFirmware(plan).files.find((f) => f.path === 'firmware/config.h')?.content ?? '';
    assert.ok(config.includes('#define DHT22_PIN 16'), 'config.h must match the graph pin');
  });

  it('warns when the graph carries two of the same part, and stays silent for the normal brief+graph overlap', () => {
    const dht22Node = {
      id: 'sensor-dht22',
      type: 'sensor',
      name: 'DHT22 (AM2302) Temperature & Humidity Sensor',
      partNumber: 'AM2302',
      ports: [{ id: 'sensor-dht22-data', label: 'DATA', direction: 'bidirectional', signal: 'digital' }],
    };
    const twoNodeGraph = normaliseGraph({
      project: PROJECT,
      nodes: [dht22Node, { ...dht22Node, id: 'sensor-dht22-2' }],
      connections: [],
    }).graph;

    const { warnings } = resolveBuildPlan('a dht22 sensor on an esp32', PROJECT, twoNodeGraph);
    assert.ok(
      warnings.some((w) => /only one per build/i.test(w)),
      JSON.stringify(warnings),
    );

    // The normal flow: brief AND approved graph both name the DHT22 once.
    const singleNodeGraph = normaliseGraph({
      project: PROJECT,
      nodes: [dht22Node],
      connections: [],
    }).graph;
    const { warnings: normalWarnings, plan } = resolveBuildPlan(
      'a dht22 sensor i have and esp32',
      PROJECT,
      singleNodeGraph,
    );
    assert.ok(!normalWarnings.some((w) => /only one per build/i.test(w)), JSON.stringify(normalWarnings));
    assert.equal(plan.modules.length, 1);
  });

  it('does not pull a DHT22 into a DHT11 brief via generic aliases', () => {
    const { plan } = resolveBuildPlan(
      'a DHT11 Temperature & Humidity Sensor on an esp32 with a website',
      PROJECT,
      normaliseGraph({}).graph,
    );
    assert.deepEqual(
      plan.modules.map((m) => m.deviceId),
      ['dht11'],
    );
  });
});

describe('every knowledge-base part generates compiling firmware', () => {
  for (const device of DEVICE_KNOWLEDGE) {
    it(`${device.id} compiles and emits its contract fields`, async () => {
      // Displays are exercised below with a sensor alongside (they render
      // other modules' metrics); sensors/actuators stand alone.
      const brief =
        device.kind === 'display'
          ? `an oled display and a dht22 on an esp32 with a website`
          : `a ${device.name} on an esp32 with a website`;
      const { plan } = resolveBuildPlan(brief, 'Matrix', normaliseGraph({}).graph);
      assert.ok(plan.modules.length >= 1, `"${brief}" must match the knowledge base`);

      const firmware = synthesizeFirmware(plan);
      const sketch = firmware.files.map((f) => f.content).join('\n');
      const expectedFields = [...new Set(plan.modules.flatMap((m) => m.metrics.map((x) => x.jsonField))), 'state'];

      const report = await validateFirmware(firmware.files, {
        workDir: mkdtempSync(path.join(tmpdir(), 'wireup-matrix-')),
        boardDefine: plan.board.archDefine,
        expectedJsonFields: expectedFields,
      });
      assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));

      // Every metric must actually be emitted by the sketch.
      for (const module of plan.modules) {
        for (const metric of module.metrics) {
          assert.ok(
            sketch.includes(`"${metric.jsonField}"`) || sketch.includes(`\\"${metric.jsonField}\\"`),
            `${device.id}: sketch must emit metric field ${metric.jsonField}`,
          );
        }
      }
      if (device.id === 'ssd1306') {
        assert.ok(sketch.includes('wireupDisplay'), 'OLED codegen must exist (KB lists it as supported)');
        assert.ok(sketch.includes('Adafruit_SSD1306'));
      }
    });
  }
});
