import rateLimit from 'express-rate-limit';

import { env } from '../config/env.js';

/**
 * Guards the paid LLM endpoint. Without this, /api/architecture/plan is an
 * open proxy to your LLM credits — anyone who finds the URL can burn them.
 */
export const planRateLimiter = rateLimit({
  windowMs: env.PLAN_RATE_LIMIT_WINDOW_MS,
  limit: env.PLAN_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many architecture requests. Wait a moment and try again.',
  },
});

/**
 * Guards the paid image generation endpoint. Image generation is expensive,
 * so this limit is independent of the planning limit.
 */
export const renderRateLimiter = rateLimit({
  windowMs: env.RENDER_RATE_LIMIT_WINDOW_MS,
  limit: env.RENDER_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many render requests. Wait a moment and try again.',
  },
});

/**
 * Guards the paid Agentic Build endpoints (firmware / website generation).
 * These are token-heavy, so they share the plan budget.
 */
export const buildRateLimiter = rateLimit({
  windowMs: env.PLAN_RATE_LIMIT_WINDOW_MS,
  limit: env.PLAN_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many agentic build requests. Wait a moment and try again.',
  },
});