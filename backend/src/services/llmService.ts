import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmProvider = 'groq' | 'bedrock' | 'gemini';

export interface LlmCallOptions {
  provider?: LlmProvider;
  model?: string;
  maxTokens: number;
  jsonResponse?: boolean;
  /**
   * Called with the provider/model that actually ran, after any fallback.
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
  groq: 'openai/gpt-oss-120b',
  bedrock: 'moonshotai.kimi-k2.5',
  gemini: 'gemini-2.0-flash',
};

/**
 * Call an LLM via the configured provider (Groq or Bedrock).
 * If no provider specified, uses the default from env.LLM_PROVIDER.
 */
export async function callLlm(
  messages: ChatMessage[],
  options: LlmCallOptions,
): Promise<string> {
  let provider = options.provider ?? env.LLM_PROVIDER;
  let model = options.model ?? DEFAULT_MODELS[provider];

  // Gemini without a key must never fail silently and must never crash the
  // build: log a loud warning and fall back to Groq. `onProviderResolved`
  // lets the caller (the pipeline) record which provider ACTUALLY ran.
  if (provider === 'gemini' && !env.GEMINI_API_KEY) {
    logger.warn(
      { requested: 'gemini', fallback: 'groq' },
      'GEMINI_API_KEY is not set — falling back to Groq for this call (Pro-tier quality is degraded until the key is configured).',
    );
    provider = 'groq';
    // Always use Groq's default model when falling back from Gemini —
    // the requested Gemini model (e.g., gemini-2.5-flash) doesn't exist on Groq.
    model = DEFAULT_MODELS.groq;
  }
  options.onProviderResolved?.(provider, model);

  logger.debug({ provider, model, maxTokens: options.maxTokens }, 'LLM call');

  switch (provider) {
    case 'groq':
      return callGroq(messages, model, options);
    case 'bedrock':
      return callBedrock(messages, model, options);
    case 'gemini':
      return callGemini(messages, model, options);
    default:
      throw new LlmError(`Unknown LLM provider: ${provider}`, 400, provider);
  }
}

async function callGroq(
  messages: ChatMessage[],
  model: string,
  options: LlmCallOptions,
): Promise<string> {
  if (!env.GROQ_API_KEY) {
    throw new LlmError('GROQ_API_KEY not configured', 503, 'groq');
  }

  const body: Record<string, unknown> = {
    model,
    temperature: 0.1,
    max_tokens: options.maxTokens,
    messages,
  };

  if (options.jsonResponse) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(`${env.GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const providerError = await response.text();
    throw new LlmError(
      `Groq request failed (${response.status}): ${providerError.slice(0, 300)}`,
      response.status,
      'groq',
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new LlmError('Groq response did not contain message content', undefined, 'groq');

  logger.debug({ provider: 'groq', model, tokens: options.maxTokens }, 'LLM call completed');
  return content;
}

async function callGemini(
  messages: ChatMessage[],
  model: string,
  options: LlmCallOptions,
): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    // Defensive: callLlm already redirects this case to Groq.
    throw new LlmError('GEMINI_API_KEY not configured', 503, 'gemini');
  }

  const systemText = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: options.maxTokens,
      ...(options.jsonResponse ? { responseMimeType: 'application/json' } : {}),
    },
    ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
  };

  const response = await fetch(
    `${env.GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const providerError = await response.text();
    throw new LlmError(
      `Gemini request failed (${response.status}): ${providerError.slice(0, 300)}`,
      response.status,
      'gemini',
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  if (!content) throw new LlmError('Gemini response did not contain text content', undefined, 'gemini');

  logger.debug({ provider: 'gemini', model }, 'LLM call completed');
  return content;
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
    const clientConfig: Record<string, unknown> = { region: env.AWS_REGION };
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
    const response = await client.send(command);

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
 * Which provider will ACTUALLY run for a requested one, after fallbacks.
 *
 * The pipeline calls this to log "provider X ran for this build" honestly —
 * asking for Gemini without a key silently becoming Groq is exactly the kind
 * of thing that must be visible in the build log.
 */
export function resolveEffectiveProvider(requested: LlmProvider): {
  provider: LlmProvider;
  fallbackFrom?: LlmProvider;
  reason?: string;
} {
  if (requested === 'gemini' && !env.GEMINI_API_KEY) {
    return {
      provider: 'groq',
      fallbackFrom: 'gemini',
      reason: 'GEMINI_API_KEY is not configured',
    };
  }
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

function isBedrockConfigured(): boolean {
  return Boolean(env.AWS_REGION) && hasBedrockCredentialSource();
}

/** Check if LLM is available (any provider configured). */
export function isLlmAvailable(provider?: LlmProvider): boolean {
  if (provider === 'groq') return Boolean(env.GROQ_API_KEY);
  if (provider === 'bedrock') return isBedrockConfigured();
  // Gemini is "available" whenever Gemini OR its Groq fallback is usable —
  // asking for Gemini without a key degrades, it never dead-ends.
  if (provider === 'gemini') return Boolean(env.GEMINI_API_KEY) || Boolean(env.GROQ_API_KEY);
  return Boolean(env.GROQ_API_KEY) || isBedrockConfigured() || Boolean(env.GEMINI_API_KEY);
}

/** Get available providers. */
export function getAvailableProviders(): LlmProvider[] {
  const providers: LlmProvider[] = [];
  if (env.GROQ_API_KEY) providers.push('groq');
  if (isBedrockConfigured()) providers.push('bedrock');
  if (env.GEMINI_API_KEY) providers.push('gemini');
  return providers;
}
