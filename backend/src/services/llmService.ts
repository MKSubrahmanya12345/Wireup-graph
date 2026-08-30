import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export type ChatMessage = { role: 'system' | 'user'; content: string };

export type LlmProvider = 'groq' | 'bedrock';

export interface LlmCallOptions {
  provider?: LlmProvider;
  model?: string;
  maxTokens: number;
  jsonResponse?: boolean;
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
};

/**
 * Call an LLM via the configured provider (Groq or Bedrock).
 * If no provider specified, uses the default from env.LLM_PROVIDER.
 */
export async function callLlm(
  messages: ChatMessage[],
  options: LlmCallOptions,
): Promise<string> {
  const provider = options.provider ?? env.LLM_PROVIDER;
  const model = options.model ?? DEFAULT_MODELS[provider];
  
  console.log('[llmService] callLlm called');
  console.log('[llmService] Provider:', provider);
  console.log('[llmService] Model:', model);
  console.log('[llmService] Max tokens:', options.maxTokens);

  switch (provider) {
    case 'groq':
      return callGroq(messages, model, options);
    case 'bedrock':
      return callBedrock(messages, model, options);
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

async function callBedrock(
  messages: ChatMessage[],
  model: string,
  options: LlmCallOptions,
): Promise<string> {
  console.log('[callBedrock] Called with model:', model);
  
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_REGION) {
    console.log('[callBedrock] Missing AWS credentials');
    throw new LlmError('AWS credentials not configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION)', 503, 'bedrock');
  }
  
  console.log('[callBedrock] AWS Region:', env.AWS_REGION);

  // Import AWS SDK dynamically to avoid requiring it when not using Bedrock
  let BedrockRuntimeClient: any;
  let InvokeModelCommand: any;
  try {
    const awsModule = await import('@aws-sdk/client-bedrock-runtime');
    BedrockRuntimeClient = awsModule.BedrockRuntimeClient;
    InvokeModelCommand = awsModule.InvokeModelCommand;
  } catch {
    throw new LlmError(
      'AWS Bedrock SDK not installed. Run: npm install @aws-sdk/client-bedrock-runtime',
      503,
      'bedrock',
    );
  }

  try {
      console.log('[callBedrock] Creating Bedrock client...');
      const client = new BedrockRuntimeClient({
        region: env.AWS_REGION,
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
      });
      console.log('[callBedrock] Bedrock client created');

      // Format messages for Bedrock
      const systemMessage = messages.find(m => m.role === 'system')?.content ?? '';
      const userMessages = messages.filter(m => m.role === 'user');
      console.log('[callBedrock] System message length:', systemMessage.length);
      console.log('[callBedrock] User messages count:', userMessages.length);

      // Bedrock format - minimax uses a specific format
      const bodyPayload = {
        messages: userMessages.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        })),
        system: systemMessage,
        max_tokens: options.maxTokens,
        temperature: 0.1,
      };
      console.log('[callBedrock] Request body:', JSON.stringify(bodyPayload).slice(0, 200));
      const body = JSON.stringify(bodyPayload);

    const command = new InvokeModelCommand({
      modelId: model,
      body,
      contentType: 'application/json',
      accept: 'application/json',
    });
        console.log('[callBedrock] Sending command to Bedrock...');

        const response = await client.send(command);
        console.log('[callBedrock] Response received');
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        console.log('[callBedrock] Response body parsed:', JSON.stringify(responseBody).slice(0, 200));

    // Extract content based on model response structure
    const content = responseBody.content?.[0]?.text ??
      responseBody.output?.message?.content?.[0]?.text ??
      responseBody.completion ??
      responseBody.choices?.[0]?.message?.content;

    if (!content) {
      throw new LlmError(`Bedrock response did not contain expected content structure. Response: ${JSON.stringify(responseBody).slice(0, 200)}`, undefined, 'bedrock');
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

/** Check if LLM is available (any provider configured). */
export function isLlmAvailable(provider?: LlmProvider): boolean {
  if (provider === 'groq') return Boolean(env.GROQ_API_KEY);
  if (provider === 'bedrock') return Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_REGION);
  return Boolean(env.GROQ_API_KEY) || Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_REGION);
}

/** Get available providers. */
export function getAvailableProviders(): LlmProvider[] {
  const providers: LlmProvider[] = [];
  if (env.GROQ_API_KEY) providers.push('groq');
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_REGION) providers.push('bedrock');
  return providers;
}
