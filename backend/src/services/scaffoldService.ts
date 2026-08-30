import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BuildFile } from '../schemas/build.js';
import { logger } from '../config/logger.js';

/**
 * Loads the hardcoded MERN website scaffold from
 * `backend/scaffolds/website/`. This is the part the AI never has to write —
 * hosting plumbing (Express app, Vite config, vercel.json, env handling) is
 * committed as real files and read verbatim here.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
/** backend/ (both under src/ in dev and dist/ in production). */
const SCAFFOLD_ROOT = path.resolve(here, '..', '..', 'scaffolds', 'website');

const IGNORED = new Set(['node_modules', 'dist', '.git', '.vercel', 'dist']);

export function scaffoldRoot(): string {
  return SCAFFOLD_ROOT;
}

async function walk(dir: string, base: string, out: BuildFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.env') continue; // never ship secrets
    if (IGNORED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    const info = await stat(full);
    if (info.isDirectory()) {
      await walk(full, rel, out);
    } else {
      const content = await readFile(full, 'utf8');
      out.push({ path: rel.replaceAll(path.sep, '/'), content });
    }
  }
}

/** Enumerate the full scaffold tree as { path, content } entries. */
export async function loadScaffold(): Promise<BuildFile[]> {
  const files: BuildFile[] = [];
  try {
    await walk(SCAFFOLD_ROOT, '', files);
  } catch (error) {
    logger.error({ err: error, scaffoldRoot: SCAFFOLD_ROOT }, 'Failed to load website scaffold');
    throw new Error(
      `Website scaffold not found at ${SCAFFOLD_ROOT}. Expected to run from the backend/ directory.`,
    );
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** True if a scaffold file exists (used by tests / build verification). */
export async function scaffoldFileExists(relPath: string): Promise<boolean> {
  try {
    const info = await stat(path.join(SCAFFOLD_ROOT, relPath));
    return info.isFile();
  } catch {
    return false;
  }
}
