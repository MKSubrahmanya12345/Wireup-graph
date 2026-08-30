import 'dotenv/config';

/**
 * Central, validated environment access for the generated device dashboard.
 * Fails fast at boot with a readable message rather than at first request.
 */

function blankToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

const optionalNumber = (value: string | undefined, fallback: number): number => {
  const trimmed = blankToUndefined(value);
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const corsOrigin = (value: string | undefined): string | string[] => {
  const raw = blankToUndefined(value);
  // The device dashboard is a LAN tool: phones/tablets/second PCs on the same
  // Wi-Fi must be able to open it. Default to wide-open origins; the API
  // holds no secrets and the device itself already sends permissive CORS.
  if (!raw || raw === '*') return '*';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

export const env = {
  NODE_ENV: blankToUndefined(process.env.NODE_ENV) ?? 'development',
  PORT: optionalNumber(process.env.PORT, 8080),
  CORS_ORIGIN: corsOrigin(process.env.CORS_ORIGIN),
  MONGO_URI: blankToUndefined(process.env.MONGO_URI),

  // Prefer the mDNS hostname (works on macOS/Linux out of the box); fall back
  // to the IP the firmware printed over Serial.
  DEVICE_IP: blankToUndefined(process.env.DEVICE_IP) ?? '',
  DEVICE_HOST: blankToUndefined(process.env.DEVICE_HOST) ?? '',
  DEVICE_PORT: optionalNumber(process.env.DEVICE_PORT, 8081),
  DEVICE_PROTOCOL: blankToUndefined(process.env.DEVICE_PROTOCOL) ?? 'http',
  DEVICE_ENDPOINTS_JSON: blankToUndefined(process.env.DEVICE_ENDPOINTS_JSON),
  DEVICE_TIMEOUT_MS: optionalNumber(process.env.DEVICE_TIMEOUT_MS, 4000),
};

export const isProduction = env.NODE_ENV === 'production';
