import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { ImageGenerateRequest, ImageGenerateResponse, ImageProvider } from './types.js';

/**
 * Cloudflare Workers AI FLUX.1-schnell image generation provider.
 *
 * Uses native fetch; no Cloudflare SDK required.
 * Returns Base64-encoded image data as data: URL.
 */
export class CloudflareFluxProvider implements ImageProvider {
  readonly id = 'cloudflare-flux-1-schnell';

  async generate({ prompt, negativePrompt }: ImageGenerateRequest): Promise<ImageGenerateResponse> {
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
      throw new Error(
        'Cloudflare image generation is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.',
      );
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

    // Cloudflare FLUX endpoint only accepts 'prompt' field
    // Embed negative prompt in the main prompt to maintain quality control
    const fullPrompt = negativePrompt ? `${prompt}\n\nNegative: ${negativePrompt}` : prompt;

    try {
      logger.debug(
        { provider: this.id, promptLength: fullPrompt.length },
        'Cloudflare image generation starting',
      );

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: fullPrompt }),
      });

      logger.debug({ status: response.status, statusText: response.statusText }, 'Cloudflare response received');

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, error: errorText.slice(0, 500) },
          'Cloudflare API error',
        );
        throw new Error(`Cloudflare image generation failed (${response.status}): ${errorText.slice(0, 100)}`);
      }

      const payload = (await response.json()) as {
        result?: { image?: string };
        error?: string;
      };

      if (payload.error) {
        logger.error({ error: payload.error }, 'Cloudflare returned error in payload');
        throw new Error(`Cloudflare error: ${payload.error}`);
      }

      const image = payload.result?.image;
      if (!image) {
        logger.error({ payload }, 'Cloudflare returned no image data');
        throw new Error('Cloudflare returned no image');
      }

      logger.debug({ provider: this.id }, 'Cloudflare image generation completed');

      return {
        url: `data:image/jpeg;base64,${image}`,
      };
    } catch (error) {
      logger.error(
        { provider: this.id, error: error instanceof Error ? error.message : String(error) },
        'Cloudflare image generation failed',
      );
      throw error;
    }
  }
}
