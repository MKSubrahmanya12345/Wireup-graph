/**
 * Shared AWS Bedrock Converse stub for tests.
 *
 * Bedrock Runtime's JS client uses an HTTP/2 handler, so this stands up a
 * tiny h2c server that speaks the model-neutral Converse response shape.
 *
 * Usage (env must be set BEFORE the first dynamic import of env.ts):
 *
 *   const stub = await startBedrockStub((systemText, request) => JSON.stringify(fixture));
 *   applyBedrockStubEnv(stub.port);
 *   const { something } = await import('../src/... .ts');
 *   ...
 *   await stub.close();
 */
import http2 from 'node:http2';

/**
 * Start an h2c Converse stub.
 *
 * @param {(systemText: string, request: any) => string} reply — given the
 *   joined system-prompt text and the parsed Converse request body, return
 *   the assistant text the "model" should answer with.
 * @param {{ port?: number }} [options]
 */
export async function startBedrockStub(reply, options = {}) {
  const server = http2.createServer();

  server.on('stream', (stream) => {
    let body = '';
    stream.on('data', (chunk) => {
      body += chunk;
    });
    stream.on('end', () => {
      const request = JSON.parse(body || '{}');
      const systemText = (request.system ?? []).map((entry) => entry.text ?? '').join('\n');
      const text = reply(systemText, request);
      const payload = JSON.stringify({
        output: { message: { role: 'assistant', content: [{ text }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        metrics: { latencyMs: 1 },
      });
      stream.respond({
        ':status': 200,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      });
      stream.end(payload);
    });
  });

  await new Promise((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));

  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Point the backend at the stub. Must run before the first dynamic import of
 * any module that pulls in src/config/env.ts (it snapshots process.env).
 */
export function applyBedrockStubEnv(port) {
  process.env.LLM_PROVIDER = 'bedrock';
  process.env.AWS_ACCESS_KEY_ID = 'test';
  process.env.AWS_SECRET_ACCESS_KEY = 'test';
  process.env.AWS_SESSION_TOKEN = 'test';
  process.env.AWS_REGION = 'us-east-1';
  process.env.BEDROCK_ENDPOINT = `http://127.0.0.1:${port}`;
}

/**
 * Force the "no LLM configured" deterministic path: strip every credential
 * source the Bedrock availability check looks at, including any real
 * ~/.aws files on the host machine.
 */
export function disableBedrockEnv() {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
  delete process.env.AWS_PROFILE;
  delete process.env.AWS_DEFAULT_PROFILE;
  delete process.env.AWS_WEB_IDENTITY_TOKEN_FILE;
  delete process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  delete process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  delete process.env.AWS_ROLE_ARN;
  delete process.env.BEDROCK_ENDPOINT;
  process.env.AWS_SHARED_CREDENTIALS_FILE = '/nonexistent/credentials';
  process.env.AWS_CONFIG_FILE = '/nonexistent/config';
}
