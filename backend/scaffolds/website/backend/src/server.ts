import mongoose from 'mongoose';

import app from './app.js';
import { env } from './config/env.js';

async function main(): Promise<void> {
  if (env.MONGO_URI) {
    try {
      await mongoose.connect(env.MONGO_URI);
      console.log('[history] MongoDB connected — readings will persist.');
    } catch (error) {
      console.warn(
        '[history] MongoDB unavailable — running with in-memory history. Set MONGO_URI to persist.',
        error instanceof Error ? error.message : '',
      );
    }
  } else {
    console.log(
      '[history] No MONGO_URI set — running with in-memory history (resets on restart).',
    );
  }

  app.listen(env.PORT, () => {
    console.log(`[api] device dashboard listening on http://localhost:${env.PORT}`);
    console.log(`[api] device target: ${env.DEVICE_PROTOCOL}://${env.DEVICE_IP}:${env.DEVICE_PORT}`);
  });
}

void main();
