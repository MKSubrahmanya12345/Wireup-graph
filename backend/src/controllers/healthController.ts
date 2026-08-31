import type { Request, Response } from 'express';
import { execFile } from 'node:child_process';

import { env } from '../config/env.js';
import { isPersistenceEnabled } from '../config/db.js';

/** GET /api/healthz */
export function healthCheck(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    service: 'wireup-backend',
    persistence: isPersistenceEnabled() ? 'mongodb' : 'disabled',
    model: env.GROQ_MODEL,
    groqConfigured: Boolean(env.GROQ_API_KEY),
  });
}

function versionOf(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(binary, ['--version'], { timeout: 5000 }, (error, stdout) => {
      if (error) return resolve(null);
      resolve(stdout.split('\n')[0]?.trim() ?? null);
    });
  });
}

/**
 * GET /api/healthz/toolchain — what the terminal validation gate can run.
 * The firmware stub-compile needs g++; npm/tsc/vite need node + npm; the REAL
 * embedded build needs PlatformIO (pio) or arduino-cli, and the Wokwi sim gate
 * needs wokwi-cli + a token. The UI shows this so a missing tool is visible
 * BEFORE a build, not as a "skipped" line afterwards.
 */
export async function toolchainCheck(_req: Request, res: Response): Promise<void> {
  const { detectToolchain } = await import('../agentic/toolchain.js');
  const [node, npm, toolchain] = await Promise.all([
    versionOf('node'),
    versionOf('npm'),
    detectToolchain(),
  ]);
  res.status(200).json({
    node,
    npm,
    gpp: toolchain.gpp.version,
    platformio: toolchain.platformio.version,
    arduinoCli: toolchain.arduinoCli.version,
    wokwiCli: toolchain.wokwiCli.version,
    wokwiToken: toolchain.wokwiToken,
  });
}