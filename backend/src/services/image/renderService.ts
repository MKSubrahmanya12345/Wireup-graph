import { logger } from '../../config/logger.js';
import type { ArchitectureGraph } from '../../schemas/architecture.js';
import { buildImagePrompt, computeGraphHash } from './promptBuilder.js';
import { getRenderCache } from './renderCache.js';
import { createImageProvider } from './providerFactory.js';

/**
 * Image render service.
 * Orchestrates: cache lookup → prompt building → provider call → cache store.
 * Never blocks the planning loop; graceful failure returns { status: 'unavailable' }.
 */

export interface RenderRequest {
  graph: ArchitectureGraph;
  force?: boolean;
  provider?: string;
  angle?: string;
}

export interface RenderResponse {
  status: 'ready' | 'pending' | 'unavailable';
  url?: string;
  prompt?: string;
  negativePrompt?: string;
  cached?: boolean;
}

/**
 * Generate or retrieve a cached render for the given graph.
 * force=true bypasses the cache.
 * Returns { status, url, prompt, cached } or { status: 'unavailable' } on failure.
 */
export async function renderArchitecture(req: RenderRequest): Promise<RenderResponse> {
  try {
    const { graph, force = false } = req;

    if (!graph || graph.nodes.length === 0) {
      return { status: 'unavailable' };
    }

    // Compute cache key
    const graphHash = await computeGraphHash(graph);
    const cache = getRenderCache();

    // Check cache (unless force=true)
    if (!force) {
      const cached = await cache.get(graphHash);
      if (cached) {
        logger.debug({ graphHash }, 'Render cache hit, returning cached image');
        return {
          status: 'ready',
          url: cached.url,
          prompt: cached.prompt,
          negativePrompt: cached.negativePrompt,
          cached: true,
        };
      }
    }

    // Build prompt
    const { prompt, negativePrompt } = buildImagePrompt(graph);

    logger.debug({ graphHash, promptLength: prompt.length, componentCount: graph.nodes.length }, 'Generated image prompt');
    logger.info({ prompt: prompt.slice(0, 500) }, 'Image prompt (first 500 chars)');

    // Call provider
    let provider;
    try {
      provider = createImageProvider();
    } catch (error) {
      logger.error({ error }, 'Failed to initialize image provider');
      return { status: 'unavailable' };
    }

    let imageUrl;
    try {
      const result = await provider.generate({
        prompt,
        negativePrompt,
        aspectRatio: '3:2',
      });
      imageUrl = result.url;
    } catch (error) {
      logger.error({ error, provider: provider.id }, 'Image generation failed');
      return { status: 'unavailable' };
    }

    // Store in cache (best-effort)
    try {
      await cache.set({
        graphHash,
        url: imageUrl,
        prompt,
        negativePrompt,
        providerId: provider.id,
        createdAt: new Date(),
      });
    } catch (error) {
      logger.warn({ error }, 'Failed to cache render, but returning result');
    }

    logger.debug({ graphHash }, 'Image render complete');

    return {
      status: 'ready',
      url: imageUrl,
      prompt,
      negativePrompt,
      cached: false,
    };
  } catch (error) {
    logger.error({ error }, 'Unexpected error in renderArchitecture');
    return { status: 'unavailable' };
  }
}
