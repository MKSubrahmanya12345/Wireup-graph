import app from './app.js';
import { resolveAvailablePort } from './config/ports.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { logAdapterBanner } from './config/startupReport.js';
import { seedAdminUser } from './auth/seedAdmin.js';

async function main(): Promise<void> {
  // $PORT when the host injects it, otherwise the configured default — and if
  // THAT is taken, the next port the kernel hands us. Never a hard-coded
  // crash on EADDRINUSE; the boot log says where the API actually listens.
  const port = await resolveAvailablePort(env.PORT);
  const server = app.listen(port, '0.0.0.0', () => {
    logger.info(
      { port, preferred: env.PORT, env: env.NODE_ENV, origins: env.CORS_ORIGIN },
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
}

void main().catch((error: unknown) => {
  logger.error({ err: error }, 'Wireup backend failed to start');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
