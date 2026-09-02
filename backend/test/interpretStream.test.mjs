/**
 * The streaming interpret endpoint.
 *
 * Regression for the "Reading the brief…" dead end: pass 0 used to be one
 * atomic POST, so the UI had nothing to show until everything was finished —
 * and nothing at all when the call stalled. It now emits the spec graph node
 * by node as it is built, so there is always something real on screen.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { once } from 'node:events';

import { disableBedrockEnv } from './bedrockStub.mjs';

/** Read an NDJSON body into an array of parsed events. */
async function readNdjson(response) {
  const text = await response.text();
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('POST /api/architecture/interpret/stream', () => {
  // Force the deterministic path: no LLM credentials may leak in from the host.
  disableBedrockEnv();
  delete process.env.MONGO_URI;

  let server;
  let base;
  let token;

  after(async () => {
    if (!server) return;
    server.close();
    await once(server, 'close').catch(() => undefined);
  });

  async function boot() {
    if (server) return { base, token };
    const mod = await import('../src/app.ts');
    server = mod.default.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    base = `http://127.0.0.1:${port}`;
    const session = await fetch(`${base}/api/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).then((r) => r.json());
    token = session.token;
    return { base, token };
  }

  it('streams the spec graph node by node, then the gated questions', async () => {
    const { base: url, token: bearer } = await boot();

    const response = await fetch(`${url}/api/architecture/interpret/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({
        brief: 'esp32 with a dht22 sensor and a website to see the data on my laptop',
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /ndjson/);

    const events = await readNdjson(response);
    const types = events.map((e) => e.type);

    // Ordering is the contract: stages and nodes first, then the questions
    // that survived the gate, then a single done event.
    assert.equal(types[0], 'stage');
    assert.ok(types.includes('node'), 'nodes are streamed individually');
    assert.ok(types.lastIndexOf('node') < types.indexOf('done'), 'nodes precede done');
    assert.equal(types.filter((t) => t === 'done').length, 1, 'exactly one done event');

    const nodeEvents = events.filter((e) => e.type === 'node');
    // A node the engine re-emits (to back-fill `produces`) is not duplicated.
    const unique = new Set(nodeEvents.map((e) => e.node.id));
    assert.ok(nodeEvents.length > 0);
    assert.ok(unique.size >= 4, `expected several distinct nodes, got ${[...unique].join(', ')}`);

    const done = events.find((e) => e.type === 'done');
    assert.ok(done.requirements, 'the requirements contract is in done');
    assert.ok(done.specGraph, 'the validated spec graph is in done');
    assert.equal(typeof done.ready, 'boolean');

    // Streamed nodes carry the pre-validation status; `done` carries the
    // validated graph, where an unanswered node is honestly `unresolved`.
    const connectivity = done.specGraph.nodes['node_connectivity'];
    assert.ok(connectivity, 'connectivity node present');
    assert.equal(connectivity.status, 'unresolved');
    assert.equal(done.specGraph.nodes['node_software_dashboard'].status, 'needs_revalidation');
  });

  it('says the model is unavailable instead of pretending it was consulted', async () => {
    const { base: url, token: bearer } = await boot();

    const response = await fetch(`${url}/api/architecture/interpret/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ brief: 'read the temperature' }),
    });

    const events = await readNdjson(response);
    const llm = events.find((e) => e.type === 'stage' && e.stage === 'llm');
    assert.ok(llm, 'the model stage is reported either way');
    assert.match(llm.title, /No model configured/i);

    const done = events.find((e) => e.type === 'done');
    assert.ok(done, 'a result is still produced without a model');
  });

  it('rejects an empty brief with 400', async () => {
    const { base: url, token: bearer } = await boot();
    const response = await fetch(`${url}/api/architecture/interpret/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ brief: '   ' }),
    });
    assert.equal(response.status, 400);
  });
});
