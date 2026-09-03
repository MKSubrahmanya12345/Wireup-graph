import { createServer, type AddressInfo } from 'node:net';
import mongoose from 'mongoose';

import app from './app.js';
import { deviceBaseUrl } from './config/deviceEndpoints.js';
import { env } from './config/env.js';
import { pushTerminalLine } from './services/terminalLog.js';

/** True when nothing is bound to `port` right now. */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '0.0.0.0');
  });
}

/**
 * The preferred port when it is free; otherwise one the kernel picks. The
 * port is where the server ENDS UP (printed at boot), never a hard-coded
 * constant — a stale process on the default port must not stop the dashboard.
 */
async function availablePort(preferred: number): Promise<number> {
  if (await portFree(preferred)) return preferred;
  console.warn(`[api] port ${preferred} is busy — picking a free port instead`);
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(preferred));
    server.listen(0, '0.0.0.0', () => {
      const address = server.address() as AddressInfo | null;
      const port = address?.port ?? preferred;
      server.close(() => resolve(port));
    });
  });
}

async function main(): Promise<void> {
  if (env.MONGO_URI) {
    try {
      await mongoose.connect(env.MONGO_URI);
      console.log('[history] MongoDB connected — readings will persist.');
      pushTerminalLine('info', 'MongoDB connected — readings will persist');
    } catch (error) {
      console.warn(
        '[history] MongoDB unavailable — running with in-memory history. Set MONGO_URI to persist.',
        error instanceof Error ? error.message : '',
      );
      pushTerminalLine('error', 'MongoDB unavailable — in-memory history only');
    }
  } else {
    console.log(
      '[history] No MONGO_URI set — running with in-memory history (resets on restart).',
    );
    pushTerminalLine('info', 'in-memory history (no MONGO_URI set)');
  }

  const port = await availablePort(env.PORT);
  app.listen(port, '0.0.0.0', () => {
    console.log(`[api] device dashboard listening on http://localhost:${port}`);
    console.log(`[terminal] open http://localhost:${port}/terminal — this dashboard's terminal, in the browser`);
    console.log(`[api] device target: ${deviceBaseUrl()}`);
    pushTerminalLine('boot', `dashboard listening on port ${port}`);
    pushTerminalLine('boot', `device target ${deviceBaseUrl()}`);
    pushTerminalLine('boot', 'browser terminal ready (you are looking at it)');
  });
}

void main();
