/**
 * Phase-1 agentic-core tests.
 *
 * Covers the three changes that make the loop genuinely "agentic":
 *   1. Pin safety — the allocator never hands back strapping / input-only /
 *      flash GPIOs (GPIO12 high at boot bricks the ESP32), and graph-pinned
 *      unsafe pins are rejected with a warning.
 *   2. Diagnostics-fed repair — compiler/validator findings become real,
 *      surgical edits (deterministic layer + the search/replace applicator),
 *      and a broken sketch is repaired to a g++-clean compile.
 *   3. LLM repair + multi-turn revision — a stub Bedrock Converse server
 *      returns edits; the pipeline applies them deterministically and only
 *      ships firmware that passes the gate.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { applyBedrockStubEnv, startBedrockStub } from './bedrockStub.mjs';

// Deterministic tests never invoke the LLM (repair agent is only called when
// an LLM is available); the two LLM suites talk to a local stub server below.
// env.ts reads these at import time, so they must be set before the imports.
const repairStub = await startBedrockStub((_system, request) => stubReply(request));
applyBedrockStubEnv(repairStub.port);
process.env.AGENTIC_TERMINAL_VALIDATION = '1';
process.env.AGENTIC_SMOKE_TEST = '0';

const { resolveBuildPlan, isOutputSafe, pinConstraint } = await import('../src/agentic/planResolver.ts');
const { normaliseGraph } = await import('../src/schemas/architecture.ts');
const {
  applyFirmwareEdits,
  deterministicFixEdits,
  repairFirmwareWithLlm,
  reviseFirmwareWithLlm,
} = await import('../src/agentic/repairAgent.ts');
const { synthesizeFirmware } = await import('../src/agentic/firmwareSynth.ts');
const { validateFirmware } = await import('../src/agentic/firmwareValidator.ts');
const { runAgenticPipeline } = await import('../src/agentic/pipeline.ts');

const BRIEF = 'a dht22 sensor i have and esp32, then i want codes and a website to access this on my local computer';
const PROJECT = 'ESP32-DHT22 Monitor';

function plan() {
  return resolveBuildPlan(BRIEF, PROJECT, normaliseGraph({}).graph);
}

// ── 1. Pin safety ───────────────────────────────────────────────────────────

describe('pin safety', () => {
  it('never auto-allocates a strapping, input-only or flash GPIO', () => {
    const { plan: p, warnings } = resolveBuildPlan(
      'esp32 with an hc-sr04 ultrasonic, a pir motion sensor, a relay, a servo and a soil moisture sensor, website dashboard',
      'Busy Bench',
      normaliseGraph({}).graph,
    );
    const forbidden = ['GPIO0', 'GPIO2', 'GPIO5', 'GPIO12', 'GPIO15', 'GPIO6', 'GPIO7', 'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11'];
    for (const module of p.modules) {
      for (const pin of Object.values(module.pins)) {
        assert.ok(!forbidden.includes(pin), `${module.name} landed on forbidden ${pin}`);
        const out = isOutputSafe(p.board, pin);
        const constraint = pinConstraint(p.board, pin);
        // Analog (input) pins may be input-only; everything that drives must be output-safe.
        if (module.bus !== 'analog' && pin !== 'GPIO34' && pin !== 'GPIO35') {
          assert.ok(out, `${module.name} ${pin} must be output-safe (${JSON.stringify(constraint)})`);
        }
      }
    }
    // Allocation should not have exhausted into a board-constrained fallback.
    assert.ok(!warnings.some((w) => /no safe free GPIO|fell back/.test(w)), warnings.join(' | '));
  });

  it('flags GPIO12 as a strapping constraint on the classic ESP32', () => {
    const { plan: p } = plan();
    const c12 = pinConstraint(p.board, 'GPIO12');
    assert.equal(c12?.restriction, 'strapping');
    assert.equal(isOutputSafe(p.board, 'GPIO12'), false);
    assert.equal(isOutputSafe(p.board, 'GPIO34'), false, 'ADC pin is not output-safe');
    assert.equal(isOutputSafe(p.board, 'GPIO13'), true, 'GPIO13 is a free general pin');
  });

  it('rejects a graph pin assignment onto an input-only pin for an output device', () => {
    const graph = {
      nodes: [
        { id: 'mcu-main', type: 'controller', name: 'ESP32 DevKit', partNumber: 'ESP32-DEVKIT', x: 0, y: 0, ports: [] },
        {
          id: 'actuator-relay', type: 'actuator', name: 'Relay', partNumber: '1-ch relay', x: 0, y: 0,
          ports: [{ id: 'actuator-relay-sig', label: 'SIG → GPIO34', direction: 'in', signal: 'digital' }],
        },
      ],
      connections: [{ id: 'c1', from: 'mcu-main', to: 'actuator-relay', fromPort: 'mcu-gpio-data', toPort: 'actuator-relay-sig', label: 'GPIO34', kind: 'data' }],
    };
    const { plan: p, warnings } = resolveBuildPlan(
      'esp32 with a relay, dashboard',
      'Relay Test',
      normaliseGraph(graph).graph,
    );
    const relay = p.modules.find((m) => /relay/i.test(m.name));
    assert.ok(relay, 'relay module resolved');
    assert.notEqual(Object.values(relay.pins)[0], 'GPIO34', 'input-only pin not assigned to a relay output');
    assert.ok(warnings.some((w) => /input-only|strapping|restricted/i.test(w)), `expected a pin-safety warning, got: ${warnings.join(' | ')}`);
  });
});

// ── 2. Surgical edit applicator + deterministic fixes ───────────────────────

describe('applyFirmwareEdits', () => {
  const files = [{ path: 'firmware/main.ino', content: 'void setup() {\n  pinMode(2, OUTPUT);\n}\nvoid loop() {}\n' }];

  it('applies a unique search/replace', () => {
    const r = applyFirmwareEdits(files, [{ path: 'firmware/main.ino', search: 'pinMode(2, OUTPUT);', replace: 'pinMode(13, OUTPUT);', reason: 'move led' }]);
    assert.equal(r.changed, true);
    assert.equal(r.applied.length, 1);
    assert.match(r.files[0].content, /pinMode\(13, OUTPUT\);/);
  });

  it('rejects an ambiguous (multi-match) block', () => {
    const dup = [{ path: 'f.ino', content: 'int x = 1;\nint x = 1;\n' }];
    const r = applyFirmwareEdits(dup, [{ path: 'f.ino', search: 'int x = 1;', replace: 'int x = 2;' }]);
    assert.equal(r.applied.length, 0);
    assert.equal(r.changed, false);
    assert.match(r.skipped[0].reason, /ambiguous|matches 2/);
  });

  it('rejects a search block that no longer exists', () => {
    const r = applyFirmwareEdits(files, [{ path: 'firmware/main.ino', search: 'digitalWrite(99, HIGH);', replace: 'digitalWrite(99, LOW);' }]);
    assert.equal(r.applied.length, 0);
    assert.match(r.skipped[0].reason, /not found/);
  });

  it('prepends with position: prepend', () => {
    const r = applyFirmwareEdits(files, [{ path: 'firmware/main.ino', search: '', position: 'prepend', replace: '#include <Arduino.h>' }]);
    assert.ok(r.files[0].content.startsWith('#include <Arduino.h>'));
  });
});

describe('deterministicFixEdits', () => {
  it('remaps an unknown include to the supported header', () => {
    const fw = { files: [{ path: 'main.ino', content: '#include <Adafruit_DHT.h>\nvoid setup(){}\nvoid loop(){}' }], platform: 'arduino', board: 'x', language: 'C++', framework: 'Arduino', buildSteps: [], notes: [] };
    const edits = deterministicFixEdits(fw, [{ severity: 'error', code: 'UNKNOWN-INCLUDE', message: '#include <Adafruit_DHT.h> does not resolve' }]);
    const r = applyFirmwareEdits(fw.files, edits);
    assert.match(r.files[0].content, /#include <DHT\.h>/);
    assert.doesNotMatch(r.files[0].content, /Adafruit_DHT/);
  });

  it('forces the Arduino prelude on a "not declared" error', () => {
    const fw = { files: [{ path: 'main.ino', content: 'void setup(){ pinMode(2, OUTPUT); }\nvoid loop(){}' }], platform: 'arduino', board: 'x', language: 'C++', framework: 'Arduino', buildSteps: [], notes: [] };
    const edits = deterministicFixEdits(fw, [{ severity: 'error', code: 'GPP-SYNTAX', message: "pinMode was not declared in this scope" }]);
    const r = applyFirmwareEdits(fw.files, edits);
    assert.ok(r.files[0].content.trimStart().startsWith('#include <Arduino.h>'));
  });

  it('fixes DHT22 used as a class (DHT22 dht(pin); -> DHT dht(pin, DHT22);)', () => {
    const fw = { files: [{ path: 'main.ino', content: '#include <DHT.h>\nDHT22 dht(4);\nvoid setup(){}\nvoid loop(){}' }], platform: 'arduino', board: 'x', language: 'C++', framework: 'Arduino', buildSteps: [], notes: [] };
    const edits = deterministicFixEdits(fw, [{ severity: 'error', code: 'GPP-SYNTAX', message: "DHT22 does not name a type" }]);
    const r = applyFirmwareEdits(fw.files, edits);
    assert.match(r.files[0].content, /DHT dht\(4, DHT22\);/);
  });
});

// ── 3. Deterministic repair drives a broken sketch to compile ───────────────

describe('repair → compile gate', () => {
  it('repairs a sketch with a bad include + missing prelude to a g++-clean tree', async () => {
    const { plan: p } = plan();
    const fw = synthesizeFirmware(p);
    // Sabotage like a weak LLM draft: wrong header, no Arduino prelude.
    const broken = {
      ...fw,
      files: fw.files.map((f) =>
        /\.ino$/.test(f.path)
          ? { ...f, content: f.content.replace(/#include <Arduino\.h>\n/, '').replace(/#include <DHT\.h>/, '#include <Adafruit_DHT.h>') }
          : f,
      ),
    };

    const work = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await work.mkdtemp(path.join(os.tmpdir(), 'wireup-repair-'));
    try {
      const fields = ['temperature_c', 'humidity_pct', 'state'];
      let report = await validateFirmware(broken.files, { workDir: dir, expectedJsonFields: fields });
      assert.equal(report.ok, false, 'sabotaged firmware must fail first');

      const edits = deterministicFixEdits(broken, report.findings.filter((f) => f.severity === 'error'));
      assert.ok(edits.length > 0, 'produced fix edits');
      const patched = applyFirmwareEdits(broken.files, edits);
      assert.equal(patched.changed, true);

      report = await validateFirmware(patched.files, { workDir: dir, expectedJsonFields: fields });
      // g++ may be missing in some CI images; structural+contract must pass regardless.
      const gppMissing = report.findings.some((f) => f.code === 'GPP-MISSING');
      if (gppMissing) {
        assert.ok(!report.findings.some((f) => f.severity === 'error' && f.code !== 'GPP-MISSING'), 'structurally clean even without g++');
      } else {
        assert.equal(report.ok, true, `repaired firmware compiles: ${report.findings.map((f) => f.message).join(' | ')}`);
      }
    } finally {
      await work.rm(dir, { recursive: true, force: true });
    }
  });
});

// ── 4. LLM repair + revision via a stub model ───────────────────────────────

// Route on the system prompt: repair vs revise both return edits JSON.
function stubReply(request) {
  const repairEdits = {
    summary: 'declared the missing ledPin constant',
    edits: [
      { path: 'firmware/main.ino', search: '', position: 'prepend', replace: 'const int ledPin = 13;', reason: 'define undefined symbol' },
    ],
  };
  const reviseEdits = {
    summary: 'drive the relay active-low',
    edits: [
      { path: 'firmware/config.h', search: '#define SAMPLE_INTERVAL_MS 2000', replace: '#define SAMPLE_INTERVAL_MS 2000\n// active-low relay module', reason: 'note polarity' },
    ],
  };
  const sys = (request.system ?? []).map((entry) => entry.text ?? '').join('\n');
  const payload = sys.includes('iterating on an already-built') ? reviseEdits : repairEdits;
  return JSON.stringify(payload);
}

after(() => repairStub.close());

describe('LLM repair (stub model)', () => {
  it('applies model-returned edits to fix an undefined symbol', async () => {
    const { plan: p } = plan();
    const fw = {
      ...synthesizeFirmware(p),
      files: [{ path: 'firmware/main.ino', content: 'void setup(){\n  pinMode(ledPin, OUTPUT);\n}\nvoid loop(){}\n' }],
    };
    const findings = [{ severity: 'error', code: 'GPP-SYNTAX', file: 'firmware/main.ino', line: 2, message: "'ledPin' was not declared in this scope" }];
    const result = await repairFirmwareWithLlm(fw, findings, p, { provider: 'bedrock' });
    assert.ok(result, 'LLM repair returned a result');
    assert.match(result.firmware.files[0].content, /const int ledPin = 13;/);
    assert.ok(result.applied.length >= 1);
  });
});

describe('multi-turn revision (stub model)', () => {
  it('applies a follow-up change request through the full gated pipeline', async () => {
    const events = [];
    let result = null;
    await runAgenticPipeline(
      {
        brief: BRIEF,
        projectName: PROJECT,
        graph: normaliseGraph({}).graph,
        provider: 'bedrock',
        revisionInstruction: 'make the relay active-low',
      },
      (e) => {
        events.push(e);
        if (e.type === 'result') result = e.result;
      },
    );
    const revised = events.some((e) => e.type === 'stage' && e.stage === 'firmware-revise');
    assert.ok(revised, 'ran a revision stage');
    // Even when the model's edits are trivial, the pipeline must still gate
    // and ship (deterministic firmware is the safe base).
    assert.ok(result, 'pipeline produced a result after revision');
    assert.ok(result.firmware.files.length > 0);
  });
});
