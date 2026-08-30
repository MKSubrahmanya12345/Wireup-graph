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

export default router;
