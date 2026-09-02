/**
 * Phase-2 embedded-gauntlet tests.
 *
 * The real PlatformIO/arduino-cli compile and Wokwi simulation can only RUN
 * where those tools (and a Wokwi token) exist; they auto-skip otherwise.
 * These tests pin the parts that must hold everywhere:
 *   1. toolchain detection reports missing tools without throwing, and the
 *      embedded gates return a *skipped* passing check (never a hard fail)
 *      when the toolchain is absent — the g++ stub gate remains authoritative;
 *   2. the generated Wokwi diagram wires every simulated part to the exact
 *      GPIO the plan assigned, with the right part models and power nets;
 *   3. parts Wokwi cannot model are reported, not faked.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { disableBedrockEnv } from './bedrockStub.mjs';

// Force the deterministic path — no LLM credentials may leak in from the host env.
disableBedrockEnv();
process.env.AGENTIC_TERMINAL_VALIDATION = '0';
process.env.AGENTIC_SMOKE_TEST = '0';
// Embedded gates are enabled by default but must skip (tools absent here).
process.env.AGENTIC_EMBEDDED_COMPILE = '1';
process.env.AGENTIC_WOKWI = '1';

const { resolveBuildPlan } = await import('../src/agentic/planResolver.ts');
const { normaliseGraph } = await import('../src/schemas/architecture.ts');
const { synthesizeFirmware } = await import('../src/agentic/firmwareSynth.ts');
const { generateWokwiConfig } = await import('../src/agentic/wokwiConfig.ts');
const { compileFirmware, simulateFirmware } = await import('../src/agentic/embeddedBuild.ts');
const { detectToolchain, resetToolchainCache } = await import('../src/agentic/toolchain.ts');
const { validateFirmware } = await import('../src/agentic/firmwareValidator.ts');

function planFor(brief, name) {
  return resolveBuildPlan(brief, name, normaliseGraph({}).graph).plan;
}

describe('toolchain detection', () => {
  it('reports tool availability truthfully and never throws', async () => {
    resetToolchainCache();
    const t = await detectToolchain();
    assert.equal(typeof t.gpp.available, 'boolean');
    assert.equal(typeof t.platformio.available, 'boolean');
    assert.equal(typeof t.arduinoCli.available, 'boolean');
    assert.equal(typeof t.wokwiCli.available, 'boolean');
    assert.equal(t.wokwiToken, false, 'no Wokwi token in the test env');
    // g++ is installed in the dev image; the embedded tools are not.
    assert.equal(t.gpp.available, true);
    assert.equal(t.platformio.available, false);
    assert.equal(t.arduinoCli.available, false);
  });
});

describe('embedded gates degrade, they do not fail, without tools', () => {
  it('compile gate returns a skipped passing check, no errors', async () => {
    resetToolchainCache();
    const plan = planFor('dht22 and esp32, website dashboard', 'DHT22');
    const fw = synthesizeFirmware(plan);
    const workDir = mkdtempSync(path.join(tmpdir(), 'wireup-embed-'));
    const gate = await compileFirmware(fw.files, { workDir, plan });
    const hasSkip = gate.checks.some((c) => /skipped/i.test(c.detail));
    assert.ok(hasSkip, `expected a skipped check, got: ${JSON.stringify(gate.checks)}`);
    assert.equal(gate.findings.some((f) => f.severity === 'error'), false);
  });

  it('wokwi gate skips when there is no compiled binary / token', async () => {
    resetToolchainCache();
    const plan = planFor('dht22 and esp32, website dashboard', 'DHT22');
    const fw = synthesizeFirmware(plan);
    const workDir = mkdtempSync(path.join(tmpdir(), 'wireup-wokwi-'));
    const gate = await simulateFirmware(fw.files, { workDir, plan, compiled: false });
    assert.ok(gate.checks.some((c) => /skipped/i.test(c.detail)));
    assert.equal(gate.findings.length, 0);
  });

  it('validateFirmware with a plan still reports ok when embedded tools are absent', async () => {
    resetToolchainCache();
    const plan = planFor('dht22 and esp32, website dashboard', 'DHT22');
    const fw = synthesizeFirmware(plan);
    const workDir = mkdtempSync(path.join(tmpdir(), 'wireup-val-'));
    const report = await validateFirmware(fw.files, {
      workDir,
      boardDefine: 'ESP32',
      expectedJsonFields: ['temperature_c', 'humidity_pct', 'state'],
      plan,
      terminal: true, // g++ stub gate runs (fast), then embedded gates skip (no pio/wokwi)
    });
    assert.equal(report.ok, true, report.findings.map((f) => f.message).join(' | '));
    assert.ok(report.checks.some((c) => /embedded compile/i.test(c.name) && /skipped/i.test(c.detail)));
  });
});

describe('wokwi diagram generation', () => {
  it('wires a DHT22 to its assigned GPIO with the correct part + power nets', () => {
    const plan = planFor('dht22 sensor and esp32', 'DHT22');
    const config = generateWokwiConfig(plan);
    const diagram = JSON.parse(config.diagramJson);

    // Board + one DHT part.
    assert.ok(diagram.parts.some((p) => p.type.startsWith('board-esp32')));
    assert.ok(diagram.parts.some((p) => p.type === 'wokwi-dht22'));

    // The DHT DATA net must equal the GPIO number the plan assigned.
    const dataGpio = plan.modules.find((m) => m.deviceId === 'dht22')?.pins.data?.replace(/\D/g, '');
    assert.ok(dataGpio, 'plan assigned a data pin');
    const dataConn = diagram.connections.find((c) => c[1] === 'SDA' || c[1] === 'DATA');
    assert.ok(dataConn, 'DHT data connection present');
    assert.equal(dataConn[3], dataGpio, `data net is GPIO${dataGpio}`);

    // Power nets present.
    const nets = diagram.connections.map((c) => c[3]);
    assert.ok(nets.includes('3V3'), '3V3 power net');
    assert.ok(nets.some((n) => /GND/.test(n)), 'GND net');

    // wokwi.toml points at the PlatformIO ELF.
    assert.match(config.wokwiToml, /firmware\.elf/);
  });

  it('builds a multi-part diagram (BME280 + servo) on distinct I2C/PWM pins', () => {
    const plan = planFor('bme280 sensor and an sg90 servo with esp32, dashboard', 'BME Servo');
    const config = generateWokwiConfig(plan);
    const diagram = JSON.parse(config.diagramJson);

    assert.ok(diagram.parts.some((p) => p.type === 'wokwi-bme280'));
    assert.ok(diagram.parts.some((p) => p.type === 'wokwi-servo'));

    const bme = plan.modules.find((m) => m.deviceId === 'bme280');
    const sdaNet = diagram.connections.find((c) => c[1] === 'SDA')?.[3];
    assert.equal(sdaNet, bme.pins.sda?.replace(/\D/g, ''), 'BME280 SDA on the assigned pin');
    const servo = plan.modules.find((m) => m.deviceId === 'servo-sg90' || m.deviceId === 'sg90');
    const pwmNet = diagram.connections.find((c) => c[1] === 'PWM')?.[3];
    assert.equal(pwmNet, servo.pins.sig?.replace(/\D/g, ''), 'servo PWM on the assigned pin');
    // No two signal nets collide on the same GPIO.
    const signalNets = diagram.connections.map((c) => c[3]).filter((n) => /^\d+$/.test(n));
    assert.equal(new Set(signalNets).size, signalNets.length, 'no duplicate GPIO nets');
  });

  it('reports parts Wokwi cannot model instead of faking them', () => {
    const plan = planFor('mq-2 gas sensor and soil moisture sensor with esp32', 'Gas Soil');
    const config = generateWokwiConfig(plan);
    assert.deepEqual(config.unsupported.sort(), ['mq2-gas', 'soil-moisture'].sort());
    // No simulated part emitted for those.
    const types = JSON.parse(config.diagramJson).parts.map((p) => p.type);
    assert.ok(!types.some((t) => /mq|soil|gas/i.test(t)));
  });

  it('uses the S3 board type for the S3 profile', () => {
    const plan = planFor('esp32-s3 with a dht22 sensor', 'S3');
    const boardType = JSON.parse(generateWokwiConfig(plan).diagramJson).parts[0].type;
    assert.match(boardType, /s3/);
  });
});
