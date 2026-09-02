/**
 * Regression test for the exact failure in the support log:
 *
 *   bedrock available → LLM firmware draft publishes temperature/humidity/
 *   valid/timestamp → FIELD-NOT-PUBLISHED ×3 → identical repair loops →
 *   build failed.
 *
 * With the contract fix, the LLM draft is rejected at the FIRMWARE gate
 * (FW-CONTRACT-FIELD — the dashboard contract requires temperature_c /
 * humidity_pct / state), the pipeline swaps in the knowledge-base firmware,
 * and the build ships with firmware + software that agree.
 *
 * A stub Bedrock Converse server plays the LLM. Run with: npm test
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { applyBedrockStubEnv, startBedrockStub } from './bedrockStub.mjs';

/** The draft that burned the user: flat field names the dashboard never reads. */
const BAD_DRAFT = {
  platform: 'esp32-arduino',
  board: 'ESP32 Dev Module',
  language: 'C++',
  framework: 'Arduino',
  files: [
    {
      path: 'firmware/main.ino',
      content: `#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
WebServer server(80);
float temperature = 21.4f, humidity = 55.2f;
void handleSensors() {
  String json = "{";
  json += "\\"temperature\\":" + String(temperature, 1);
  json += ",\\"humidity\\":" + String(humidity, 1);
  json += ",\\"valid\\":true";
  json += ",\\"timestamp\\":" + String(millis());
  json += "}";
  server.send(200, "application/json", json);
}
void setup() { Serial.begin(115200); server.on("/api/sensors", handleSensors); server.begin(); }
void loop() { server.handleClient(); }
`,
    },
  ],
  buildSteps: ['flash it'],
  notes: [],
};

// Must be set BEFORE the dynamic imports below — env.ts reads them at import.
// Anything the pipeline asks the LLM: hand back the bad firmware draft.
const stub = await startBedrockStub(() => JSON.stringify(BAD_DRAFT));
applyBedrockStubEnv(stub.port);
process.env.AGENTIC_TERMINAL_VALIDATION = '1';

const { runAgenticPipeline } = await import('../src/agentic/pipeline.ts');
const { normaliseGraph } = await import('../src/schemas/architecture.ts');

after(async () => {
  await stub.close();
});

describe('LLM draft breaks the JSON contract (the support-log scenario)', () => {
  it('rejects the draft at the firmware gate, swaps to KB firmware, and ships', async () => {
    const events = [];
    let result = null;
    let failure = null;

    await runAgenticPipeline(
      {
        brief: 'a dht22 sensor i have and esp32, then i want codes and a website to access this on my local computer',
        projectName: 'ESP32-DHT22 Environmental Monitor',
        graph: normaliseGraph({}).graph,
        provider: 'bedrock',
      },
      (event) => {
        events.push(event);
        if (event.type === 'result') result = event.result;
        if (event.type === 'error') failure = event.message;
      },
    );

    const allLines = events
      .map((e) => e.line ?? e.message ?? '')
      .join('\n');
    assert.equal(failure, null, `pipeline errored: ${failure}`);
    assert.ok(result, 'no result artifact — the build must not fail');
    assert.ok(allLines.includes('FW-CONTRACT-FIELD'), 'the gate must name the missing contract fields');
    assert.ok(
      allLines.includes('replacing') || allLines.includes('knowledge-base'),
      'the repair loop must swap the bad draft for the KB firmware',
    );
    assert.equal(result.engine, 'deterministic', 'shipped firmware is the KB synthesis, not the bad draft');
    assert.ok(result.iterations.firmware >= 2, `firmware loop should take 2 attempts, took ${result.iterations.firmware}`);
    assert.equal(result.validation.firmware.ok, true);
    assert.equal(result.validation.software.ok, true);
    assert.equal(result.validation.consistency.ok, true);

    const spec = result.software.files.find((f) => f.path === 'frontend/src/lib/deviceSpec.ts');
    assert.ok(spec?.content.includes("path: 'temperature.temperature_c'"));
    assert.ok(spec?.content.includes("path: 'humidity.humidity_pct'"));
  });
});
