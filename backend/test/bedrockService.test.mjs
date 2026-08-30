/**
 * Regression test for the AWS Bedrock provider.
 *
 * Bedrock Runtime's JS client uses an HTTP/2 handler, so this stands up a tiny
 * h2c server instead of mocking the network stack. The test verifies that
 * callLlm sends a model-neutral Converse request and correctly extracts text
 * when the model returns a reasoningContent block before the final text.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import http2 from 'node:http2';

describe('callLlm with AWS Bedrock', () => {
  let server;
  let port;
  let receivedPath;
  let receivedBody;

  before(async () => {
    server = http2.createServer();

    server.on('stream', (stream, headers) => {
      let body = '';
      receivedPath = headers[':path'];
      stream.on('data', (chunk) => {
        body += chunk;
      });
      stream.on('end', () => {
        receivedBody = JSON.parse(body);
        const payload = JSON.stringify({
          output: {
            message: {
              role: 'assistant',
              content: [
                { reasoningContent: { reasoningText: 'thinking first' } },
                { text: JSON.stringify({ ok: true, value: 42 }) },
              ],
            },
          },
          stopReason: 'end_turn',
          usage: { inputTokens: 12, outputTokens: 40, totalTokens: 52 },
        });
        stream.respond({
          ':status': 200,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        });
        stream.end(payload);
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;

    // These must be set before the first dynamic import of llmService so env
    // validation captures them.
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    process.env.AWS_SESSION_TOKEN = 'test';
    process.env.AWS_REGION = 'us-east-1';
    process.env.BEDROCK_ENDPOINT = `http://127.0.0.1:${port}`;
    process.env.LOG_LEVEL = 'silent';
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('sends a Converse request and returns the final text block', async () => {
    const { callLlm } = await import('../src/services/llmService.ts');
    const result = await callLlm(
      [
        { role: 'system', content: 'Return JSON only.' },
        { role: 'user', content: 'What is 40+2?' },
      ],
      {
        provider: 'bedrock',
        model: 'moonshotai.kimi-k2.5',
        maxTokens: 200,
        jsonResponse: true,
      },
    );

    assert.equal(result, JSON.stringify({ ok: true, value: 42 }));
    assert.match(receivedPath, /converse$/);

    // The request must be model-neutral Converse shape (not InvokeModel).
    assert.deepEqual(receivedBody.messages, [
      { role: 'user', content: [{ text: 'What is 40+2?' }] },
    ]);
    assert.deepEqual(receivedBody.system, [{ text: 'Return JSON only.' }]);
    assert.deepEqual(receivedBody.inferenceConfig, {
      maxTokens: 200,
      temperature: 0.1,
    });
  });
});
