import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import routes from './routes/index.js';
import { allowedOrigins, env, isProduction } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app: Express = express();

// Behind a reverse proxy / platform router (Render/Fly/Nginx). Needed so
// express-rate-limit sees the real client IP and req.protocol is https.
app.set('trust proxy', 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split('?')[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// Explicit allow-list. In production the same-origin SPA needs no CORS at all;
// the allow-list only covers a separately-hosted frontend.
app.use(
  cors({
    origin: isProduction ? allowedOrigins : [...allowedOrigins, 'http://localhost:5173'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  }),
);

// `verify` stashes the exact bytes so webhook HMAC verification signs the
// same payload the provider signed (re-stringifying JSON breaks signatures).
app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── API ────────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ── Static frontend (same-origin production deploy) ────────────────────────
// Serve the built Vite app when it is present. Search order:
//   1. FRONTEND_DIST env var
//   2. backend/public           (where the Dockerfile copies the build)
//   3. ../frontend/dist         (local monorepo: build the frontend in place)
const here = path.dirname(fileURLToPath(import.meta.url));
const distCandidates = [
  env.FRONTEND_DIST,
  path.resolve(here, '..', 'public'),
  path.resolve(here, '..', '..', 'frontend', 'dist'),
].filter((p): p is string => Boolean(p));
const frontendDist = distCandidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')));

if (frontendDist) {
  logger.info({ dir: frontendDist }, 'Serving frontend statically (same-origin)');
  app.use(express.static(frontendDist, { index: false, fallthrough: true }));

  // SPA fallback: any non-API GET that didn't match a file → index.html
  // (client-side routing). API 404s and errors still go to their handlers.
  // (Express 5 / path-to-regexp 8 needs a middleware, not a bare '*' route.)
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    if (req.path.startsWith('/assets/')) return next(); // hashed asset miss → 404
    return res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  logger.warn(
    'No built frontend found (checked FRONTEND_DIST, ./public, ../frontend/dist). API-only mode — run the frontend separately or build it for a same-origin deploy.',
  );
}

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
