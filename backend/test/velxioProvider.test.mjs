/**
 * VelxioSimProvider against a stub Velxio server that speaks the REAL
 * protocol surface (the one external/velxio's FastAPI backend exposes):
 *
 *   POST /api/compile/start      → { job_id }
 *   GET  /api/compile/status/:id → { state, result: CompileResponse }
 *   WS   /api/simulation/ws/:id  → start_esp32 / serial_output / stop_esp32
 *
 * Three verdicts are asserted, because they are three DIFFERENT states:
 *   1. compile error   → ok:false, errored:false (a firmware verdict)
 *   2. clean boot      → ok:true  (serial reached "listening on port")
 *   3. dead server     → errored:true (a provider failure; downloads lock)
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

import { WebSocketServer } from 'ws';

process.env.SIM_MODE = 'velxio';
process.env.VELXIO_TIMEOUT_MS = '8000';
process.env.VELXIO_COMPILE_TIMEOUT_MS = '20000';

const { VelxioSimProvider } = await import('../src/providers/sim/velxioSimProvider.ts');
const { resolveBuildPlan } = await import('../src/agentic/planResolver.ts');
const { normaliseGraph } = await import('../src/schemas/architecture.ts');
const { synthesizeFirmware } = await import('../src/agentic/firmwareSynth.ts');

function planFor(brief, name) {
  const { graph } = normaliseGraph({});
  return resolveBuildPlan(brief, name, graph).plan;
}

/** One stub Velxio: behaviour switches on the sketch content it receives. */
function startStubVelxio() {
  const seen = { compileBodies: [], wsMessages: [] };
  let jobResult = null;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/api/compile/start') {
        const parsed = JSON.parse(body);
        seen.compileBodies.push(parsed);
        const sketch = parsed.files.map((f) => f.content).join('\n');
        if (sketch.includes('#error')) {
          jobResult = {
            success: false,
            stdout: '',
            stderr: "sketch.ino:3:2: error: #error forced failure\ncompilation terminated.",
            error: 'exit status 1',
          };
        } else {
          jobResult = {
            success: true,
            binary_content: Buffer.from('fake-esp32-image').toString('base64'),
            binary_type: 'bin',
            has_wifi: true,
            stdout: 'Sketch uses 812345 bytes',
            stderr: '',
            error: null,
          };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ job_id: 'job-1' }));
        return;
      }
      if (req.method === 'GET' && req.url === '/api/compile/status/job-1') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            state: 'done',
            started_at: Date.now() / 1000,
            finished_at: Date.now() / 1000,
            stdout: jobResult?.stdout ?? '',
            result: jobResult,
            error: null,
          }),
        );
        return;
      }
      res.writeHead(404).end('not found');
    });
  });

  // The real backend serves the sim WS at /api/simulation/ws/{client_id}.
  const wss = new WebSocketServer({ server, path: undefined });
  wss.on('connection', (socket, request) => {
    assert.match(request.url, /^\/api\/simulation\/ws\//, 'provider must use the real WS path');
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      seen.wsMessages.push(message.type);
      if (message.type === 'start_esp32') {
        assert.equal(message.data.board, 'esp32');
        assert.ok(message.data.firmware_b64, 'the compiled binary must be handed to the emulator');
        // Emulated boot: a couple of serial lines, then the HTTP-server line.
        socket.send(JSON.stringify({ type: 'system', data: { event: 'started' } }));
        socket.send(JSON.stringify({ type: 'serial_output', data: { uart: 0, data: 'Wireup boot...\n' } }));
        setTimeout(() => {
          socket.send(
            JSON.stringify({ type: 'serial_output', data: { uart: 0, data: 'HTTP API listening on port 80\n' } }),
          );
        }, 50);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        seen,
        close: () => new Promise((done) => { wss.close(); server.close(done); }),
      });
    });
  });
}

describe('velxio sim provider (real protocol)', () => {
  let stub;
  before(async () => {
    stub = await startStubVelxio();
  });
  after(async () => {
    await stub.close();
  });

  it('compiles the pipeline firmware and verifies the QEMU boot', async () => {
    const plan = planFor('esp32 with a dht22 sensor', 'DHT Node');
    const firmware = synthesizeFirmware(plan);
    const provider = new VelxioSimProvider(stub.url);

    const result = await provider.runSim(plan, { firmwareFiles: firmware.files });

    assert.equal(result.errored, false);
    assert.equal(result.ok, true, `expected a pass, log:\n${result.log.join('\n')}`);
    assert.equal(result.provider, 'velxio');
    // The compile request carried the REAL artifacts: sketch + config.h.
    const sent = stub.seen.compileBodies.at(-1);
    assert.equal(sent.board_fqbn, 'esp32:esp32:esp32');
    const names = sent.files.map((f) => f.name);
    assert.ok(names.some((n) => n.endsWith('.ino')), 'must send the sketch');
    assert.ok(names.includes('config.h'), 'must send config.h — the sketch #includes it');
    assert.ok(sent.libraries.includes('DHT sensor library'), 'must declare the plan libraries');
    // The emulator was started AND stopped over the real message protocol.
    // (stop_esp32 is fired just before the socket closes — give it a beat.)
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(stub.seen.wsMessages.includes('start_esp32'));
    assert.ok(stub.seen.wsMessages.includes('stop_esp32'));
    // Two independent checks, both green.
    assert.equal(result.checks.length, 2);
    assert.ok(result.checks.every((check) => check.ok));
  });

  it('reports a compile error as a firmware verdict, not a provider error', async () => {
    const plan = planFor('esp32 with a dht22 sensor', 'DHT Node');
    const firmware = synthesizeFirmware(plan);
    const broken = firmware.files.map((file) =>
      file.path.endsWith('.ino') ? { ...file, content: `#error forced failure\n${file.content}` } : file,
    );
    const provider = new VelxioSimProvider(stub.url);

    const result = await provider.runSim(plan, { firmwareFiles: broken });

    assert.equal(result.errored, false, 'a compile error is the firmware failing, not Velxio failing');
    assert.equal(result.ok, false);
    assert.match(result.checks[0].detail, /forced failure/);
  });

  it('reports an unreachable Velxio as errored (downloads must lock)', async () => {
    const plan = planFor('esp32 with a dht22 sensor', 'DHT Node');
    const firmware = synthesizeFirmware(plan);
    const provider = new VelxioSimProvider('http://127.0.0.1:9'); // nothing listens on the discard port

    const result = await provider.runSim(plan, { firmwareFiles: firmware.files });

    assert.equal(result.errored, true);
    assert.equal(result.ok, false);
  });

  it('refuses honestly when handed no firmware at all', async () => {
    const plan = planFor('esp32 with a dht22 sensor', 'DHT Node');
    const provider = new VelxioSimProvider(stub.url);
    const result = await provider.runSim(plan, {});
    assert.equal(result.errored, true);
    assert.match(result.log.join(' '), /no firmware sources/);
  });
});
