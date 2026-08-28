import mongoose from 'mongoose';
import { logger } from './logger.js';
import { env } from './env.js';

let connected = false;

/**
 * Connects to MongoDB. Returns false (and keeps the process alive) when no
 * MONGO_URI is configured — the API degrades to stateless mode instead of
 * refusing to boot, which keeps local dev and previews frictionless.
 */
export async function connectDatabase(): Promise<boolean> {
  if (!env.MONGO_URI) {
    logger.warn('MONGO_URI is not set — running WITHOUT persistence (graphs are not saved)');
    return false;
  }

  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 8_000 });
    connected = true;
    logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
    return true;
  } catch (error) {
    connected = false;
    logger.error(
      { err: error instanceof Error ? error.message : error },
      'MongoDB connection failed — falling back to stateless mode',
    );
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
  logger.info('MongoDB disconnected');
}

/** Controllers check this before touching the database. */
export function isPersistenceEnabled(): boolean {
  return connected && mongoose.connection.readyState === 1;
}