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

  // ── LLM Provider configuration ───────────────────────────────────────────
  LLM_PROVIDER: z.enum(['groq', 'bedrock', 'gemini']).default('groq'),

  // Google Gemini (the Pro-tier model). Without a key the selector logs a
  // warning and falls back to Groq — it never crashes the build.
  GEMINI_API_KEY: emptyToUndefined,
  GEMINI_MODEL: z.string().min(1).default('gemini-2.0-flash'),
  GEMINI_BASE_URL: z
    .string()
    .url()
    .default('https://generativelanguage.googleapis.com/v1beta'),
  
  // Groq settings
  GROQ_API_KEY: emptyToUndefined,
  GROQ_MODEL: z.string().min(1).default('openai/gpt-oss-120b'),
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  
  // AWS Bedrock settings. Leave the keys blank to use the normal AWS credential
  // chain (AWS_PROFILE, ~/.aws/credentials, IAM role, ECS/EC2 metadata, etc.).
  AWS_ACCESS_KEY_ID: emptyToUndefined,
  AWS_SECRET_ACCESS_KEY: emptyToUndefined,
  AWS_SESSION_TOKEN: emptyToUndefined,
  AWS_REGION: z.string().min(1).default('us-east-1'),
  // Optional override for development/proxies/VPC endpoints.
  BEDROCK_ENDPOINT: emptyToUndefined,
  BEDROCK_MODEL: z.string().min(1).default('moonshotai.kimi-k2.5'),

  // Comma separated allow-list. Never '*' in production.
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Directory holding the built frontend (vite `dist`). When set/available the
  // API serves the SPA same-origin, so one container serves the whole app.
  // Auto-detected (./public, then ../frontend/dist) when left unset.
  FRONTEND_DIST: emptyToUndefined,

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
  // Runtime smoke test: boots the generated backend against a stub device
  // after the build. Set to '0' to skip (builds get faster, less proven).
  AGENTIC_SMOKE_TEST: z.string().default('1'),
  // Real embedded compile: use PlatformIO (preferred) / arduino-cli to build
  // the firmware to an actual binary, instead of only g++ syntax-checked
  // stubs. Auto-detected: runs when the tool is installed, skips otherwise.
  // Set to '0' to never attempt the real toolchain.
  AGENTIC_EMBEDDED_COMPILE: z.string().default('1'),
  // Wokwi headless simulation: boot the compiled .bin in a virtual circuit
  // (generated wokwi.toml + diagram.json). Requires wokwi-cli AND
  // WOKWI_CLI_TOKEN (free at https://wokwi.com/dashboard/ci).
  AGENTIC_WOKWI: z.string().default('1'),
  // The Wokwi CI token (read from the environment, not the .env defaults).
  WOKWI_CLI_TOKEN: emptyToUndefined,

  // ── Payments ─────────────────────────────────────────────────────────────
  // 'auto' (default) resolves to razorpay when a key is present, mock when it
  // is not. Force either side with 'mock' / 'razorpay'.
  PAYMENT_MODE: z.enum(['auto', 'mock', 'razorpay']).default('auto'),
  RAZORPAY_KEY_ID: emptyToUndefined,
  RAZORPAY_KEY_SECRET: emptyToUndefined,
  RAZORPAY_WEBHOOK_SECRET: emptyToUndefined,
  // Where the mock checkout self-fires its webhook, and where real Razorpay
  // callbacks land. Defaults to the local API.
  APP_BASE_URL: z.string().min(1).default('http://localhost:5000'),
  // Mock checkout: how long the "hosted page" takes before the webhook fires.
  MOCK_PAYMENT_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(1_200),

  // ── Hardware simulation ──────────────────────────────────────────────────
  // 'auto' resolves to velxio when VELXIO_URL is set, mock otherwise.
  SIM_MODE: z.enum(['auto', 'mock', 'velxio']).default('auto'),
  VELXIO_URL: emptyToUndefined,
  VELXIO_API_KEY: emptyToUndefined,
  VELXIO_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  // ── Billing / admin persistence ──────────────────────────────────────────
  // File-backed billing store (used when MONGO_URI is not set).
  BILLING_DB_PATH: z.string().min(1).default('.data/billing.json'),
  // Seed admin account, created at boot when it does not exist.
  ADMIN_EMAIL: z.string().min(1).default('admin@wireup.local'),
  ADMIN_PASSWORD: z.string().min(8).default('wireup-admin-dev'),
  ADMIN_NAME: z.string().min(1).default('Wireup Admin'),
  // Set to '0' to skip admin seeding entirely.
  ADMIN_SEED: z.string().default('1'),
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