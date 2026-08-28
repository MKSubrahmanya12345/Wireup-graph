import express, { type Express } from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';

import routes from './routes/index.js';
import { allowedOrigins, isProduction } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app: Express = express();

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

// Explicit allow-list. Never '*' — the plan endpoint spends money.
app.use(
  cors({
    origin: isProduction ? allowedOrigins : [...allowedOrigins, 'http://localhost:5173'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  }),
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;