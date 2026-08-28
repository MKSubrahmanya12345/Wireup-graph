import pino from 'pino';
import { env } from './env.js';

/**
 * Plain pino — no transport.
 *
 * A `transport: { target: 'pino-pretty' }` spawns a worker thread that hangs
 * or swallows stdout on Windows, which makes the server look like it never
 * started. Logs go to stdout as JSON; pipe through pino-pretty if you want
 * colours (see the dev:pretty script).
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.apiKey',
    ],
    censor: '[redacted]',
  },
});