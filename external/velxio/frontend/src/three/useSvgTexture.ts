/**
 * useSvgTexture — loads an SVG asset into a THREE texture, shared across all
 * 3D cards via a module-level cache (the same SVG is reused by many parts).
 * Falls back to null while loading / on error so callers can render a plain
 * labeled slab instead of a broken texture.
 */
import { useEffect, useState } from 'react';
import { SRGBColorSpace, Texture, TextureLoader } from 'three';

const loader = new TextureLoader();
const cache = new Map<string, Texture>();

export function useSvgTexture(url: string | null | undefined): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(() =>
    url ? (cache.get(url) ?? null) : null,
  );

  useEffect(() => {
    if (!url) {
      setTexture(null);
      return;
    }
    const cached = cache.get(url);
    if (cached) {
      setTexture(cached);
      return;
    }
    let cancelled = false;
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = SRGBColorSpace;
        tex.anisotropy = 8;
        cache.set(url, tex);
        if (!cancelled) setTexture(tex);
      },
      undefined,
      () => {
        /* swallow load errors — the card falls back to a labeled slab */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  return texture;
}
