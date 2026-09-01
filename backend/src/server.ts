import app from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { logAdapterBanner } from './config/startupReport.js';
import { seedAdminUser } from './auth/seedAdmin.js';

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, origins: env.CORS_ORIGIN },
    'Wireup backend listening',
  );
  // Which adapter is live for every external dependency (mock vs real).
  logAdapterBanner();
});

// Connect after listening so a missing Mongo never blocks the API from serving.
void connectDatabase().then(() => seedAdminUser());

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  server.close();
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});