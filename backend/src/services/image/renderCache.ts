import { isPersistenceEnabled } from '../../config/db.js';
import { logger } from '../../config/logger.js';
import type { ArchitectureGraph } from '../../schemas/architecture.js';

/**
 * Render cache entry: keyed by graph hash, stores the generated image data,
 * the prompt used, and creation timestamp.
 */
export interface RenderCacheEntry {
  graphHash: string;
  url: string;
  prompt: string;
  negativePrompt: string;
  providerId: string;
  createdAt: Date;
}

/**
 * Abstract cache interface — Mongo or in-memory.
 */
export interface IRenderCache {
  get(graphHash: string): Promise<RenderCacheEntry | null>;
  set(entry: RenderCacheEntry): Promise<void>;
  clear(): Promise<void>;
}

/**
 * In-memory cache with LRU eviction (size capped at 100 entries).
 * Used when Mongo is not available.
 */
class InMemoryRenderCache implements IRenderCache {
  private cache = new Map<string, RenderCacheEntry>();
  private readonly maxSize = 100;

  async get(graphHash: string): Promise<RenderCacheEntry | null> {
    const entry = this.cache.get(graphHash);
    if (entry) {
      logger.debug({ graphHash, source: 'in-memory' }, 'Cache hit');
    }
    return entry ?? null;
  }

  async set(entry: RenderCacheEntry): Promise<void> {
    // Simple LRU: if we're at capacity, delete the oldest entry
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
        logger.debug({ evicted: firstKey }, 'In-memory cache evicted oldest entry');
      }
    }
    this.cache.set(entry.graphHash, entry);
    logger.debug({ graphHash: entry.graphHash, size: this.cache.size }, 'In-memory cache stored');
  }

  async clear(): Promise<void> {
    this.cache.clear();
    logger.info('In-memory render cache cleared');
  }
}

/**
 * Mongo-backed cache. Stores RenderCache documents in a collection.
 */
class MongoRenderCache implements IRenderCache {
  private cachedCollection: any = null;

  private async getCollection() {
    if (this.cachedCollection) return this.cachedCollection;

    const mongoose = await import('mongoose');
    const cacheSchema = new mongoose.Schema(
      {
        graphHash: { type: String, unique: true, required: true },
        url: { type: String, required: true },
        prompt: { type: String, required: true },
        negativePrompt: { type: String, default: '' },
        providerId: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now, expires: 2592000 }, // 30 days TTL
      },
      { timestamps: false },
    );

    const db = mongoose.connection;
    this.cachedCollection = db.model('RenderCache', cacheSchema);
    return this.cachedCollection;
  }

  async get(graphHash: string): Promise<RenderCacheEntry | null> {
    try {
      const collection = await this.getCollection();
      const doc = await collection.findOne({ graphHash });
      if (doc) {
        logger.debug({ graphHash, source: 'mongo' }, 'Cache hit');
        return {
          graphHash: doc.graphHash,
          url: doc.url,
          prompt: doc.prompt,
          negativePrompt: doc.negativePrompt || '',
          providerId: doc.providerId || '',
          createdAt: doc.createdAt,
        };
      }
      return null;
    } catch (error) {
      logger.warn({ error, graphHash }, 'Mongo cache get failed, returning null');
      return null;
    }
  }

  async set(entry: RenderCacheEntry): Promise<void> {
    try {
      const collection = await this.getCollection();
      await collection.updateOne(
        { graphHash: entry.graphHash },
        { $set: entry },
        { upsert: true },
      );
      logger.debug({ graphHash: entry.graphHash }, 'Mongo cache stored');
    } catch (error) {
      logger.warn({ error, graphHash: entry.graphHash }, 'Mongo cache set failed');
    }
  }

  async clear(): Promise<void> {
    try {
      const collection = await this.getCollection();
      await collection.deleteMany({});
      logger.info('Mongo render cache cleared');
    } catch (error) {
      logger.warn({ error }, 'Mongo cache clear failed');
    }
  }
}

let cacheInstance: IRenderCache | null = null;

/**
 * Get or initialize the render cache.
 * Returns Mongo cache if persistence is enabled, otherwise in-memory.
 */
export function getRenderCache(): IRenderCache {
  if (!cacheInstance) {
    if (isPersistenceEnabled()) {
      cacheInstance = new MongoRenderCache();
      logger.debug('Initialized Mongo render cache');
    } else {
      cacheInstance = new InMemoryRenderCache();
      logger.debug('Initialized in-memory render cache (size capped at 100)');
    }
  }
  return cacheInstance;
}
