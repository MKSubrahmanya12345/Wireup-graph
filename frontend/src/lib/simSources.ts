/**
 * What page 04 has to work with, derived from the last build.
 *
 * Every one of these can legitimately be missing (no build yet, an older
 * persisted result, a dashboard that produced no dist). The page renders the
 * reason instead of an empty box, so this module returns explicit nulls rather
 * than guessing.
 */

import type { AgenticBuildResult } from '../types/build';

export interface VelxioArtifact {
  /** Path inside the firmware zip, e.g. "simulation/weather.vlx". */
  path: string;
  /** The .vlx JSON. */
  content: string;
  /** Suggested download name. */
  filename: string;
  /** Parts placed in the Velxio project (0 when the JSON is unreadable). */
  parts: number;
  wires: number;
  boardKind: string | null;
}

/** Find the Velxio project the backend shipped with this build. */
export function velxioArtifact(result: AgenticBuildResult | null): VelxioArtifact | null {
  const file = result?.firmware.files.find((entry) => entry.path.endsWith('.vlx'));
  if (!file) return null;
  const filename = file.path.split('/').pop() ?? `${result?.slug ?? 'project'}.vlx`;
  try {
    const parsed = JSON.parse(file.content) as {
      format?: string;
      components?: unknown[];
      wires?: unknown[];
      boards?: { boardKind?: string }[];
    };
    if (parsed.format !== 'velxio-project') return null;
    return {
      path: file.path,
      content: file.content,
      filename,
      parts: Array.isArray(parsed.components) ? parsed.components.length : 0,
      wires: Array.isArray(parsed.wires) ? parsed.wires.length : 0,
      boardKind: parsed.boards?.[0]?.boardKind ?? null,
    };
  } catch {
    return null;
  }
}

export interface PreviewTarget {
  url: string;
  note: string;
  publishedAt: string;
}

/** The live dashboard preview, if this build published one. */
export function previewTarget(result: AgenticBuildResult | null): PreviewTarget | null {
  const preview = result?.preview;
  if (!preview?.url) return null;
  return { url: preview.url, note: preview.note, publishedAt: preview.publishedAt };
}

/** Why there is nothing to show on the Website half — in the user's terms. */
export function previewBlockedReason(result: AgenticBuildResult | null): string {
  if (!result) return 'No build in this browser yet. Run the agentic build on page 03 first.';
  if (!result.preview) {
    return 'This build result predates live previews (or its dashboard build produced no dist/). Re-run the build on page 03 to publish one.';
  }
  return 'The preview expired — previews are kept for the last few builds only. Re-run the build on page 03.';
}

export type SimEngine = 'native' | 'velxio';

/** Which engine the simulation half should run, given the server config. */
export function chooseEngine(
  config: { velxio: { configured: boolean; embedUrl: string | null } } | null,
  requested: SimEngine | null,
): SimEngine {
  const velxioAvailable = Boolean(config?.velxio.configured && config.velxio.embedUrl);
  if (requested === 'velxio') return velxioAvailable ? 'velxio' : 'native';
  if (requested === 'native') return 'native';
  return velxioAvailable ? 'velxio' : 'native';
}
