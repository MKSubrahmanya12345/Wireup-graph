import type { Request, Response } from 'express';

import { env } from '../config/env.js';
import { isPersistenceEnabled } from '../config/db.js';

/** GET /api/healthz */
export function healthCheck(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    service: 'wireup-backend',
    persistence: isPersistenceEnabled() ? 'mongodb' : 'disabled',
    model: env.GROQ_MODEL,
    groqConfigured: Boolean(env.GROQ_API_KEY),
  });
}