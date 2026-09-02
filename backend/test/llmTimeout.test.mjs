/**
 * No LLM call is allowed to run unbounded.
 *
 * Regression for a hard hang: with an AWS credential source present but
 * unusable (a ~/.aws file with no Bedrock access, an unreachable region, a
 * laptop off the corporate VPN) the SDK would work through its chain and
 * retries for minutes while the UI showed nothing but a disabled button.
 *
 * This file runs in its own process on purpose: src/config/env.ts snapshots
 * process.env at first import, so the stub endpoint has to be applied before
 * anything else loads it.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import http2 from 'node:http2';

import { applyBedrockStubEnv } from './bedrockStub.mjs';

describe('LLM calls are bounded', () => {
  /** A Converse stub that never answers — the "hung request" scenario. */
  let server;
  const openStreams = new Set();

  after(async () => {
    // A stream that is never answered keeps the h2 server (and therefore the
    // node process) alive. Destroy them explicitly or the suite never exits.
    for (const stream of openStreams) stream.destroy();
    openStreams.clear();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('rejects with a readable 504 when the model does not answer in time', async () => {
    server = http2.createServer();
    server.on('stream', (stream) => {
      openStreams.add(stream);
      stream.on('close', () => openStreams.delete(stream));
      // deliberately never respond
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    applyBedrockStubEnv(port);
    const { callLlm, LlmError } = await import('../src/services/llmService.ts');

    // Keep the ceiling small so the test stays fast; the code path is
    // identical at the 45 s default.
    const startedAt = Date.now();
    const error = await callLlm([{ role: 'user', content: 'hello' }], {
      maxTokens: 32,
      timeoutMs: 250,
    }).then(
      () => null,
      (e) => e,
    );
    const elapsed = Date.now() - startedAt;

    assert.ok(error, 'a hung model must fail loudly, not resolve');
    assert.ok(error instanceof LlmError);
    assert.equal(error.name, 'LlmError');
    assert.equal(error.status, 504, 'a timeout is a gateway timeout, not an opaque failure');
    assert.match(error.message, /did not respond within/i);
    assert.match(error.message, /region, credentials and network/);
    // The property that matters: it comes back quickly instead of hanging.
    assert.ok(elapsed < 5_000, `expected a fast failure, took ${elapsed}ms`);
  });

  it('applies a default ceiling from the environment', async () => {
    const { env } = await import('../src/config/env.ts');
    assert.ok(env.LLM_TIMEOUT_MS > 0, 'LLM_TIMEOUT_MS has a sane default');
    assert.ok(env.LLM_TIMEOUT_MS <= 120_000, 'the default ceiling is not effectively unbounded');
  });
});
