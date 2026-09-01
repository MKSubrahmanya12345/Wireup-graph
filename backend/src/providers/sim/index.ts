import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { MockHardwareSimProvider } from './mockHardwareSimProvider.js';
import { VelxioSimProvider, velxioConfigured } from './velxioSimProvider.js';
import type { HardwareSimProvider } from './types.js';

/**
 *   SIM_MODE=mock    → always the deterministic virtual bench
 *   SIM_MODE=velxio  → real adapter; falls back to mock (loudly) without a URL
 *   SIM_MODE=auto    → velxio when VELXIO_URL is set, mock otherwise
 */
let cached: HardwareSimProvider | null = null;

export function getHardwareSimProvider(): HardwareSimProvider {
  if (cached) return cached;

  const wantsReal = env.SIM_MODE === 'velxio' || (env.SIM_MODE === 'auto' && velxioConfigured());

  if (wantsReal && velxioConfigured()) {
    cached = new VelxioSimProvider(env.VELXIO_URL!);
  } else {
    if (wantsReal) {
      logger.warn('SIM_MODE=velxio but VELXIO_URL is missing — falling back to MockHardwareSimProvider.');
    }
    cached = new MockHardwareSimProvider();
  }
  return cached;
}

export function resetHardwareSimProviderForTests(): void {
  cached = null;
}

export * from './types.js';
export { MockHardwareSimProvider } from './mockHardwareSimProvider.js';
export { VelxioSimProvider } from './velxioSimProvider.js';
