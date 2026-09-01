import { Router } from 'express';

import { env } from '../config/env.js';
import { getAvailableProviders } from '../services/llmService.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

/** GET /api/config/llm — available LLM providers and models */
router.get(
  '/config/llm',
  asyncHandler(async (_req, res) => {
    const providers = getAvailableProviders();
    
    res.status(200).json({
      defaultProvider: env.LLM_PROVIDER,
      providers: {
        groq: {
          available: providers.includes('groq'),
          defaultModel: env.GROQ_MODEL,
          baseUrl: env.GROQ_BASE_URL,
          models: [
            'openai/gpt-oss-120b',
            'llama-3.3-70b-versatile',
            'mixtral-8x7b-32768',
          ],
        },
        bedrock: {
          available: providers.includes('bedrock'),
          defaultModel: env.BEDROCK_MODEL,
          region: env.AWS_REGION,
          models: [
            'moonshotai.kimi-k2.5',
            'minimax.minimax-m2.5',
            'amazon.nova-pro-v1:0',
            'anthropic.claude-3-sonnet-20240229-v1:0',
            'anthropic.claude-3-haiku-20240307-v1:0',
          ],
        },
      },
    });
  }),
);

/**
 * GET /api/config/sim — what page 04 should run.
 *
 * `velxio.embedUrl` is set only when this deployment points at a Velxio
 * instance (self-hosted from the external/velxio submodule, or velxio.dev).
 * Without it the page runs Wireup's own in-browser bench, which needs no
 * external service at all.
 */
router.get('/config/sim', (_req, res) => {
  const embedUrl = env.VELXIO_EMBED_URL ?? env.VELXIO_URL;
  res.status(200).json({
    simMode: env.SIM_MODE,
    velxio: {
      configured: Boolean(embedUrl),
      embedUrl: embedUrl ?? null,
      source: 'https://github.com/davidmonterocrespo24/velxio',
      licence: 'AGPL-3.0',
    },
    native: {
      engine: 'avr8js + @wokwi/elements',
      note: 'Runs entirely in the browser. The ESP32 firmware itself is compiled and simulated server-side.',
    },
  });
});

export default router;
