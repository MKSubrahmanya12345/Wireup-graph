import { createServer, type AddressInfo } from 'node:net';

/**
 * Port resolution that never hard-fails on a busy port.
 *
 * Hosts inject $PORT; when they don't (or when the preferred port is already
 * taken by a stale process), the app binds the next port the kernel hands out
 * instead of crashing on EADDRINUSE. The port is where the server ENDS UP —
 * printed at boot — never a hard-coded constant.
 */

/** True when nothing is bound to `port` right now. */
export function isPortFree(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

/**
 * `preferred` when it is free; otherwise a free port picked by the kernel.
 * (Probe-then-bind has a tiny TOCTOU window; acceptable — the alternative is
 * refusing to boot because some other process got there first.)
 */
export async function resolveAvailablePort(preferred: number, host = '0.0.0.0'): Promise<number> {
  if (await isPortFree(preferred, host)) return preferred;
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(preferred));
    server.listen(0, host, () => {
      const address = server.address() as AddressInfo | null;
      const port = address?.port ?? preferred;
      server.close(() => resolve(port));
    });
  });
}
