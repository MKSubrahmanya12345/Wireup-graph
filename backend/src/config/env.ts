import 'dotenv/config';
import { z } from 'zod';

/** Blank env values are treated as "not set" rather than failing validation. */
const emptyToUndefined = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() ? value.trim() : undefined));

/**
 * Central, validated environment access.
 * Fails fast at boot with a readable message rather than at first request.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  // Persistence is optional: without MONGO_URI the API still runs, it just
  // does not save anything. Keeps local dev and review environments simple.
  // An empty value (e.g. a blank line copied from .env.example) counts as unset.
  MONGO_URI: emptyToUndefined,

  GROQ_API_KEY: emptyToUndefined,
  GROQ_MODEL: z.string().min(1).default('openai/gpt-oss-120b'),
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),

  // Comma separated allow-list. Never '*' in production.
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  LOG_LEVEL: z.string().default('info'),

  // Guards the paid LLM endpoint against casual abuse.
  PLAN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  PLAN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  MAX_REVISIONS: z.coerce.number().int().positive().default(25),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`\nInvalid backend environment:\n${details}\n`);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';

/** Origins allowed to call the API from a browser. */
export const allowedOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);