import express, { type Express } from 'express';
import cors from 'cors';

import routes from './routes/index.js';
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

app.use('/api', routes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

export default app;
