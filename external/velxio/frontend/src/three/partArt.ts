/**
 * partArt — resolves a 2D canvas part (board or component) to its real SVG art
 * plus natural pixel size, reusing the exact /component-svgs assets the
 * examples gallery (`CircuitPreview`) already uses.
 *
 * This keeps the 3D view purely data-driven: no DOM rasterisation, no
 * duplicate Web Components, no changes to the simulation core. The 3D cards
 * are textured with the same art the user sees in 2D, lifted onto the bench.
 */
import { ComponentRegistry } from '../services/ComponentRegistry';
import { getCompDef, BOARD_DEFS } from '../components/examples/CircuitPreview';
import type { CompDef } from '../components/examples/CircuitPreview';

export interface ResolvedArt {
  /** Asset URL under /component-svgs, or null when the part is inline-only. */
  url: string | null;
  /** Natural width in canvas-space pixels. */
  w: number;
  /** Natural height in canvas-space pixels. */
  h: number;
  /** Human label used for the no-art fallback card. */
  label: string;
}

const BOARD_FALLBACK: CompDef = { svg: '', w: 200, h: 140 };

/** Resolve a board's art from its BoardKind. */
export function resolveBoardArt(boardKind: string): ResolvedArt {
  const def: CompDef = BOARD_DEFS[boardKind] ?? BOARD_FALLBACK;
  return {
    url: def.svg ? `/component-svgs/${def.svg}` : null,
    w: def.w,
    h: def.h,
    label: boardKind,
  };
}

/**
 * Resolve a component's art from its metadataId + property values (LED color,
 * etc.). Returns null when the metadata isn't loaded yet.
 */
export function resolveComponentArt(
  metadataId: string,
  properties: Record<string, unknown> | undefined,
): ResolvedArt | null {
  const meta = ComponentRegistry.getInstance().getById(metadataId);
  if (!meta) return null;
  const def = getCompDef(meta.tagName, (properties ?? {}) as Record<string, unknown>);
  return {
    url: def.svg ? `/component-svgs/${def.svg}` : null,
    w: def.w,
    h: def.h,
    label: meta.name,
  };
}
