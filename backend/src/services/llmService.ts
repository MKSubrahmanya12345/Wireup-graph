import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmProvider = 'bedrock';

export interface LlmCallOptions {
  provider?: LlmProvider;
  model?: string;
  maxTokens: number;
  jsonResponse?: boolean;
  /**
   * Wall-clock ceiling for this call. Defaults to `LLM_TIMEOUT_MS`.
   * Never remove: an unresolvable AWS credential chain hangs for minutes
   * otherwise, and the UI has nothing to show while it does.
   */
  timeoutMs?: number;
  /**
   * Called with the provider/model that actually ran.
   * The pipeline uses it to log "which provider actually ran per build".
   */
  onProviderResolved?: (provider: LlmProvider, model: string) => void;
}

/** Thrown for any provider-level failure; the controller turns this into a 502. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly provider?: LlmProvider,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Default models per provider */
const DEFAULT_MODELS: Record<LlmProvider, string> = {
  bedrock: env.BEDROCK_MODEL,
};

/**
 * Call an LLM via AWS Bedrock (the only supported provider).
 */
export async function callLlm(
  messages: ChatMessage[],
  options: LlmCallOptions,
): Promise<string> {
  const provider = options.provider ?? env.LLM_PROVIDER;
  const model = options.model ?? DEFAULT_MODELS[provider];

  options.onProviderResolved?.(provider, model);

  logger.debug({ provider, model, maxTokens: options.maxTokens }, 'LLM call');

  return callBedrock(messages, model, options);
}

/**
 * Reject if `promise` has not settled within `ms`.
 *
 * This is the difference between "the app is slow" and "the app is stuck".
 * Every provider call goes through it, so no LLM failure mode can hold a
 * request open indefinitely.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    const humanMs = ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s` : `${ms}ms`;
    timer = setTimeout(() => {
      reject(
        new LlmError(
          `${label} did not respond within ${humanMs} — check the AWS region, credentials and network path.`,
          504,
          'bedrock',
        ),
      );
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}


async function callBedrock(
  messages: ChatMessage[],
  model: string,
  options: LlmCallOptions,
): Promise<string> {
  // Import the AWS SDK dynamically so it is only loaded when Bedrock is used.
  let BedrockRuntimeClient: any;
  let ConverseCommand: any;
  try {
    const awsModule = await import('@aws-sdk/client-bedrock-runtime');
    BedrockRuntimeClient = awsModule.BedrockRuntimeClient;
    ConverseCommand = awsModule.ConverseCommand;
  } catch {
    throw new LlmError(
      'AWS Bedrock SDK not installed. Run: npm install @aws-sdk/client-bedrock-runtime',
      503,
      'bedrock',
    );
  }

  try {
    // Let the AWS SDK resolve credentials via its usual chain (env vars,
    // AWS_PROFILE, ~/.aws/credentials, IAM role, ECS/EC2 metadata, etc.).
    // Passing no credentials object also picks up AWS_SESSION_TOKEN.
    const clientConfig: Record<string, unknown> = {
      region: env.AWS_REGION,
      // The SDK's own retry/backoff multiplies a slow failure into a very long
      // one. Two attempts is plenty for a transient 5xx; anything more is
      // better spent falling back to the deterministic engine.
      maxAttempts: 2,
    };
    if (env.BEDROCK_ENDPOINT) clientConfig.endpoint = env.BEDROCK_ENDPOINT;
    const client = new BedrockRuntimeClient(clientConfig);

    // Converse is the model-neutral Bedrock API: it accepts the same
    // messages/system/inference shape for Claude, Nova, MiniMax, Kimi, etc.
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => ({ text: m.content }));
    const conversation = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [{ text: m.content }],
      }));

    const commandInput: Record<string, unknown> = {
      modelId: model,
      messages: conversation,
      inferenceConfig: {
        maxTokens: options.maxTokens,
        temperature: 0.1,
      },
    };

    if (system.length > 0) {
      commandInput.system = system;
    }

    const command = new ConverseCommand(commandInput);
    const response = (await withTimeout(
      client.send(command),
      options.timeoutMs ?? env.LLM_TIMEOUT_MS,
      'AWS Bedrock',
    )) as { output?: { message?: { content?: Array<{ text?: string }> } } };

    // Reasoning models return a reasoningContent block before the final text.
    const blocks = response?.output?.message?.content ?? [];
    const content = collectConverseText(blocks);
    if (!content) {
      throw new LlmError(
        `Bedrock response did not contain text content. Response: ${JSON.stringify(response).slice(0, 300)}`,
        undefined,
        'bedrock',
      );
    }

    logger.debug({ provider: 'bedrock', model, tokens: options.maxTokens }, 'LLM call completed');
    return content;
  } catch (error) {
    if (error instanceof LlmError) throw error;
    throw new LlmError(
      `Bedrock request failed: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      'bedrock',
    );
  }
}

/** Join every `text` block in a Converse response, skipping reasoning blocks. */
function collectConverseText(blocks: Array<{ text?: string }>): string | undefined {
  const parts: string[] = [];
  for (const block of blocks) {
    if (typeof block?.text === 'string' && block.text.length > 0) {
      parts.push(block.text);
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * Which provider will ACTUALLY run for a requested one.
 *
 * With Bedrock as the only provider there are no fallbacks left, but the
 * pipeline still calls this to log "provider X ran for this build" honestly.
 */
export function resolveEffectiveProvider(requested: LlmProvider): {
  provider: LlmProvider;
  fallbackFrom?: LlmProvider;
  reason?: string;
} {
  return { provider: requested };
}

/** Handles bare JSON, fenced JSON, and JSON wrapped in prose. */
export function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start === -1 || end <= start) throw new LlmError('LLM returned non-JSON output');
    return JSON.parse(withoutFence.slice(start, end + 1));
  }
}

/**
 * Extract JSON from an LLM response and validate it against a Zod schema.
 *
 * Throws LlmError (→ 502 upstream) instead of letting a raw ZodError become an
 * unhandled 500: malformed model output is a provider failure, not a server
 * bug. The first few validation issues are included so the model (or the user
 * reading the error) can see exactly which field came back wrong.
 */
export function parseLlmJson<T>(
  content: string,
  // Accept any schema whose output is T regardless of its input type — these
  // schemas are built to accept null/omitted fields and normalise them.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  opts: { label?: string; provider?: LlmProvider } = {},
): T {
  const result = schema.safeParse(extractJson(content));
  if (result.success) return result.data;
  const problems = result.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || 'output'}: ${issue.message}`)
    .join('; ');
  throw new LlmError(
    `${opts.label ?? 'LLM response'} did not match the expected schema (${problems})`,
    502,
    opts.provider,
  );
}

/** True when explicit IAM keys, a profile, a role source, or local AWS files are configured. */
function hasBedrockCredentialSource(): boolean {
  const sharedCredentialsFile =
    process.env.AWS_SHARED_CREDENTIALS_FILE ?? path.join(homedir(), '.aws', 'credentials');
  const sharedConfigFile =
    process.env.AWS_CONFIG_FILE ?? path.join(homedir(), '.aws', 'config');

  const hasExplicitKeys = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
  const hasNonExplicitSource = Boolean(
    process.env.AWS_PROFILE ||
    process.env.AWS_DEFAULT_PROFILE ||
    process.env.AWS_WEB_IDENTITY_TOKEN_FILE ||
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
    process.env.AWS_ROLE_ARN ||
    existsSync(sharedCredentialsFile) ||
    existsSync(sharedConfigFile),
  );

  return hasExplicitKeys || hasNonExplicitSource;
}

function isBedrockConfiguredInternal(): boolean {
  return Boolean(env.AWS_REGION) && hasBedrockCredentialSource();
}

/** True when AWS Bedrock has a region and a usable credential source. */
export function isBedrockConfigured(): boolean {
  return isBedrockConfiguredInternal();
}

/** Check if the LLM (AWS Bedrock) is available. */
export function isLlmAvailable(_provider?: LlmProvider): boolean {
  return isBedrockConfiguredInternal();
}

/** Get available providers. */
export function getAvailableProviders(): LlmProvider[] {
  return isBedrockConfiguredInternal() ? ['bedrock'] : [];
}
