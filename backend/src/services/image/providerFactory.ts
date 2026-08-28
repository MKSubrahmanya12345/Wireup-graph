import { env } from '../../config/env.js';
import { CloudflareFluxProvider } from './cloudflareFluxProvider.js';
import type { ImageProvider } from './types.js';

/**
 * Factory to instantiate the configured image generation provider.
 * Currently supports: cloudflare (FLUX.1-schnell)
 */
export function createImageProvider(): ImageProvider {
  switch (env.IMAGE_PROVIDER) {
    case 'cloudflare':
      return new CloudflareFluxProvider();
    default:
      throw new Error(`Unknown image provider: ${env.IMAGE_PROVIDER}`);
  }
}
