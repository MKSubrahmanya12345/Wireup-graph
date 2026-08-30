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

  // Guards the paid image generation endpoint.
  RENDER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  RENDER_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  MAX_REVISIONS: z.coerce.number().int().positive().default(25),

  // Image generation provider configuration.
  IMAGE_PROVIDER: z.enum(['cloudflare']).default('cloudflare'),
  CLOUDFLARE_ACCOUNT_ID: emptyToUndefined,
  CLOUDFLARE_API_TOKEN: emptyToUndefined,

  // ── Wireup Auth ──────────────────────────────────────────────────────────
  // Secret used to sign session tokens. The default exists so the app boots
  // out of the box in dev — override it anywhere that is not a laptop.
  JWT_SECRET: z.string().min(1).default('wireup-dev-secret-change-me'),
  // How long a signed session stays valid.
  AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),
  // File-backed user store (used when MONGO_URI is not set).
  AUTH_DB_PATH: z.string().min(1).default('.data/users.json'),

  // ── Agentic pipeline ─────────────────────────────────────────────────────
  // Max generate → validate → repair rounds per artifact.
  AGENTIC_MAX_REPAIR_LOOPS: z.coerce.number().int().min(1).max(6).default(3),
  // Timeout for a single terminal validation command (ms).
  AGENTIC_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(240_000),
  // Where validation sandboxes are materialised.
  AGENTIC_WORKDIR: z.string().min(1).default('/tmp/wireup-agentic'),
  // Set to '0' to skip terminal validation entirely (not recommended).
  AGENTIC_TERMINAL_VALIDATION: z.string().default('1'),
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