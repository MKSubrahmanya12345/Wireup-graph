import express, { type Express } from 'express';
import cors from 'cors';

import routes from './routes/index.js';
import { terminalRouter } from './routes/terminal.js';
import { pushTerminalLine } from './services/terminalLog.js';
import { env } from './config/env.js';

const app: Express = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// The browser terminal (/terminal) sees what this API actually serves.
// Telemetry polling and the terminal's own stream are filtered out — they
// would drown everything else in seconds.
app.use((req, _res, next) => {
  const route = req.path;
  const noisy =
    route.startsWith('/api/telemetry/live') ||
    route.startsWith('/api/telemetry/history') ||
    route.startsWith('/api/terminal');
  if (!noisy) {
    if (route.startsWith('/api/control/')) {
      pushTerminalLine('control', req.method + ' ' + route + ' → device command');
    } else if (route.startsWith('/api/')) {
      pushTerminalLine('request', req.method + ' ' + route);
    }
  }
  next();
});

app.use('/api', routes);
app.use(terminalRouter());

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

export default app;
