import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { scaffoldRoot } from '../services/scaffoldService.js';
import { runCommand, type CommandResult } from './terminal.js';

/**
 * Warm dependency store for the generated website — the same idea the firmware
 * toolchain already uses ("5-7 minutes uncached, seconds cached"), applied to
 * the MERN scaffold.
 *
 * The scaffold's dependencies are fixed boilerplate: they do not change from
 * build to build, so paying a cold registry install on every validation
 * attempt is pure waste — and it was the dominant cost of the website stage.
 *
 * How it works:
 *
 *   • A warm tree is keyed by sha256(package.json). `ensureWarmTree` populates
 *     one for each scaffold package (backend, frontend) by running the package
 *     manager ONCE in a scratch copy — the Docker image does this at build
 *     time (`scripts/warmPkgCache.mjs`), so deployed images never install the
 *     boilerplate again.
 *
 *   • `hydrateModules` materialises a build's node_modules by COPYING the warm
 *     tree (pnpm's relative symlinks survive a structure-preserving copy, so
 *     the result is a fully working install — zero network). A real install
 *     only runs when the generated package.json actually deviates from the
 *     template, and that install's result is promoted back into the store, so
 *     even a cold first build pays the network at most once per manifest.
 *
 *   • `registryReachable` is memoised with a TTL: a three-attempt repair loop
 *     probes the registry at most once, and warm-hydrated builds never probe
 *     it at all.
 */

export type Pkg = 'backend' | 'frontend';

export const SCAFFOLD_PKGS: Pkg[] = ['backend', 'frontend'];

/** How long a successful registry probe is remembered (a build lasts minutes). */
const REGISTRY_OK_TTL_MS = 15 * 60_000;
/** A failed probe is remembered briefly, so a transient blip is retried soon. */
const REGISTRY_FAIL_TTL_MS = 45_000;

const log = (line: string): void => logger.info(line);

export function pkgCacheRoot(): string {
  return env.AGENTIC_PKG_CACHE || path.join(os.tmpdir(), 'wireup-pkg-cache');
}

function warmDirFor(key: string): string {
  return path.join(pkgCacheRoot(), 'warm', key);
}

function scaffoldPkgDir(pkg: Pkg): string {
  return path.join(scaffoldRoot(), pkg);
}

/** Byte-level identity of a package.json — the warm-store key. */
export async function hashPackageJson(content: string): Promise<string> {
  return createHash('sha256').update(content.trim()).digest('hex').slice(0, 24);
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** A warm tree is usable when its node_modules is in place. */
async function isWarm(key: string): Promise<boolean> {
  return exists(path.join(warmDirFor(key), 'node_modules'));
}

// ── Package manager resolution ──────────────────────────────────────────────

let pkgBase: string[] | null = null;

/**
 * argv prefix that actually runs the configured package manager. Prefers a
 * real `pnpm` on PATH, falls back to corepack's shim (ships with Node ≥ 16).
 * Resolved once per process.
 */
export async function pkgManagerBase(): Promise<string[]> {
  if (pkgBase) return pkgBase;
  if (env.AGENTIC_PKG_MANAGER === 'npm') {
    pkgBase = ['npm'];
    return pkgBase;
  }
  for (const candidate of [['pnpm'], ['corepack', 'pnpm']]) {
    const probe = await runCommand([...candidate, '--version'], { timeoutMs: 20_000 });
    if (probe.exitCode === 0) {
      pkgBase = candidate;
      return pkgBase;
    }
  }
  pkgBase = ['pnpm']; // will surface a clean spawn error in the caller's check
  return pkgBase;
}

function installArgv(): Promise<string[]> {
  // append-only: stable, greppable log lines for the browser terminal.
  return pkgManagerBase().then((base) =>
    base[0] === 'npm'
      ? [...base, 'install', '--no-audit', '--no-fund', '--loglevel=error']
      : [...base, 'install', '--reporter=append-only'],
  );
}

// ── Warming (build-time path, and the one-time lazy path) ───────────────────

/** One warm-tree build per key, per process. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Populate the warm tree for a scaffold package if it is missing. Cheap and
 * idempotent: with the store already baked (Docker) this is a no-op, and on
 * any other deploy it turns the FIRST build's install into the only one.
 */
export async function ensureWarmTree(pkg: Pkg, logLine: (line: string) => void = log): Promise<void> {
  const manifest = await readFile(path.join(scaffoldPkgDir(pkg), 'package.json'), 'utf8');
  const key = await hashPackageJson(manifest);
  if (await isWarm(key)) return;

  const running = inFlight.get(key);
  if (running) return running;

  const job = (async (): Promise<void> => {
    await mkdir(pkgCacheRoot(), { recursive: true });
    const scratch = await mkdtemp(path.join(pkgCacheRoot(), 'tmp-warm-'));
    try {
      // Scaffold sources only — no node_modules/dist copies, ever.
      await cp(scaffoldPkgDir(pkg), scratch, {
        recursive: true,
        filter: (src) => !/(^|[\\/])node_modules$/.test(src) && !/(^|[\\/])dist$/.test(src),
      });
      const startedAt = Date.now();
      const result = await runCommand(await installArgv(), {
        cwd: scratch,
        timeoutMs: Math.max(env.AGENTIC_COMMAND_TIMEOUT_MS, 600_000),
      });
      if (result.exitCode !== 0) {
        throw new Error(`install failed for the ${pkg} scaffold: ${result.output.split('\n').slice(-3).join(' | ')}`);
      }

      const target = warmDirFor(key);
      if (!(await isWarm(key))) {
        // Another process may have won the race — rename replaces only when
        // the target is absent, so first writer wins and the rest discard.
        await mkdir(path.dirname(target), { recursive: true });
        await rename(path.join(scratch, 'node_modules'), path.join(target, 'node_modules')).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOTEMPTY' || error.code === 'EEXIST') return; // first writer wins
            throw error;
          },
        );
        await cp(path.join(scratch, 'pnpm-lock.yaml'), path.join(target, 'pnpm-lock.yaml')).catch(() => undefined);
        await cp(path.join(scratch, 'package.json'), path.join(target, 'package.json')).catch(() => undefined);
      }
      logLine(`pkg-cache: warm tree ready for ${pkg} (${key.slice(0, 10)}…) in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  })()
    .catch((error: unknown) => {
      logLine(`pkg-cache: could not warm ${pkg}: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, job);
  return job;
}

/** Warm every scaffold package (used by scripts/warmPkgCache.mjs at build time). */
export async function ensureScaffoldWarmTrees(logLine?: (line: string) => void): Promise<void> {
  await Promise.all(SCAFFOLD_PKGS.map((pkg) => ensureWarmTree(pkg, logLine)));
}

/**
 * Can this manifest be served warm? 'warmable' means the store does not have
 * it YET but the manifest is byte-identical to the scaffold template, so
 * warming the scaffold gives exactly this key — no network install needed.
 */
export async function warmStatus(pkg: Pkg, packageJson: string): Promise<'warm' | 'warmable' | 'network'> {
  if (env.AGENTIC_WARM_TREE === '0') return 'network';
  const key = await hashPackageJson(packageJson);
  if (await isWarm(key)) return 'warm';
  const scaffoldManifest = await readFile(path.join(scaffoldPkgDir(pkg), 'package.json'), 'utf8').catch(() => '');
  if (scaffoldManifest && (await hashPackageJson(scaffoldManifest)) === key) return 'warmable';
  return 'network';
}

// ── Hydration (per-build, per-attempt path) ─────────────────────────────────

export interface HydrationResult {
  ok: boolean;
  mode: 'warm' | 'install' | 'reused';
  command: CommandResult | null;
  durationMs: number;
  detail: string;
}

/** pkgDir → key already materialised there (repair attempts reuse the tree). */
const hydrated = new Map<string, string>();

async function copyWarmTree(key: string, pkgDir: string): Promise<number> {
  const startedAt = Date.now();
  const modulesDir = path.join(pkgDir, 'node_modules');
  await rm(modulesDir, { recursive: true, force: true }).catch(() => undefined);
  // verbatimSymlinks keeps pnpm's relative links exactly as stored — the copy
  // is a working install because the directory structure is identical.
  await cp(path.join(warmDirFor(key), 'node_modules'), modulesDir, {
    recursive: true,
    verbatimSymlinks: true,
  });
  return Date.now() - startedAt;
}

async function promoteToWarm(key: string, pkgDir: string): Promise<void> {
  if (await isWarm(key)) return;
  const target = warmDirFor(key);
  await mkdir(path.dirname(target), { recursive: true });
  // Stage into a temp dir and rename — an interrupted copy must never leave a
  // half-populated tree that a later build would trust.
  const staging = `${target}.tmp-${randomBytes(4).toString('hex')}`;
  try {
    await cp(path.join(pkgDir, 'node_modules'), path.join(staging, 'node_modules'), {
      recursive: true,
      verbatimSymlinks: true,
    });
    await cp(path.join(pkgDir, 'pnpm-lock.yaml'), path.join(staging, 'pnpm-lock.yaml')).catch(() => undefined);
    await cp(path.join(pkgDir, 'package.json'), path.join(staging, 'package.json')).catch(() => undefined);
    if (!(await isWarm(key))) {
      await rename(staging, target).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOTEMPTY' || error.code === 'EEXIST') return; // another process won
        throw error;
      });
    }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Materialise node_modules for one generated package.
 *
 * Common case: the generated package.json is the scaffold's boilerplate → the
 * warm tree is copied in place in a couple of seconds and NOTHING touches the
 * network. Fallback: a real install (pnpm), whose result is then promoted into
 * the warm store so the next build with the same manifest never installs again.
 */
export async function hydrateModules(options: {
  pkg: Pkg;
  pkgDir: string;
  packageJson: string;
  timeoutMs: number;
  logLine?: (line: string) => void;
}): Promise<HydrationResult> {
  const startedAt = Date.now();
  const { pkg, pkgDir, packageJson, timeoutMs } = options;
  const logLine = options.logLine ?? log;
  const key = await hashPackageJson(packageJson);
  const modulesDir = path.join(pkgDir, 'node_modules');

  // Same tree, same manifest — an earlier repair attempt already set it up.
  if (hydrated.get(pkgDir) === key && (await exists(modulesDir))) {
    return { ok: true, mode: 'reused', command: null, durationMs: Date.now() - startedAt, detail: 'node_modules already in place from an earlier attempt' };
  }

  let status = await warmStatus(pkg, packageJson);
  if (status === 'warmable') {
    // One-time per deploy: warm the scaffold tree, then re-check.
    await ensureWarmTree(pkg, logLine);
    status = await warmStatus(pkg, packageJson);
  }

  if (status === 'warm') {
    const copyMs = await copyWarmTree(key, pkgDir);
    hydrated.set(pkgDir, key);
    return {
      ok: true,
      mode: 'warm',
      command: null,
      durationMs: Date.now() - startedAt,
      detail: `warm node_modules copied from the build cache (${(copyMs / 1000).toFixed(1)} s) — no network install`,
    };
  }

  // Genuinely different dependencies → real install (the only network path).
  const command = await runCommand(await installArgv(), { cwd: pkgDir, timeoutMs });
  if (command.exitCode === 0) {
    hydrated.set(pkgDir, key);
    const seconds = (command.durationMs / 1000).toFixed(1);
    // Promote so every future build with this manifest is warm too. Best
    // effort: a failed promotion must never fail the build.
    await promoteToWarm(key, pkgDir).catch(() => undefined);
    return {
      ok: true,
      mode: 'install',
      command,
      durationMs: Date.now() - startedAt,
      detail: `dependencies installed (${seconds} s) — manifest deviates from the scaffold; result cached for next time`,
    };
  }
  return {
    ok: false,
    mode: 'install',
    command,
    durationMs: Date.now() - startedAt,
    detail: `install failed in ${pkg}: ${command.output.split('\n').slice(-3).join(' | ')}`,
  };
}

// ── Registry reachability (once per build, not once per attempt) ────────────

let registryProbe: { at: number; ok: boolean } | null = null;

/**
 * True when the registry answers. Successes are remembered for 15 minutes and
 * failures for 45 seconds, so a repair loop probes at most once — and callers
 * that never need the network should not call this at all.
 */
export async function registryReachable(timeoutMs = 8_000): Promise<boolean> {
  if (registryProbe) {
    const ttl = registryProbe.ok ? REGISTRY_OK_TTL_MS : REGISTRY_FAIL_TTL_MS;
    if (Date.now() - registryProbe.at < ttl) return registryProbe.ok;
  }
  const base = env.AGENTIC_REGISTRY_URL.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  let ok = false;
  try {
    // Any HTTP answer below 500 means DNS+TLS+the server are alive — a mirror
    // that 404s the ping path can still serve metadata.
    const response = await fetch(`${base}/-/ping`, { signal: controller.signal });
    ok = response.status < 500;
  } catch {
    ok = false;
  } finally {
    clearTimeout(timer);
  }
  registryProbe = { at: Date.now(), ok };
  return ok;
}

/** Test hook: forget memoised state (registry probe, per-tree hydration). */
export function resetPkgCacheForTests(): void {
  registryProbe = null;
  hydrated.clear();
  pkgBase = null;
}

/** Where a warm tree for a manifest would live (used by the warm script's log). */
export async function warmTreePathFor(pkg: Pkg): Promise<string> {
  const manifest = await readFile(path.join(scaffoldPkgDir(pkg), 'package.json'), 'utf8');
  return warmDirFor(await hashPackageJson(manifest));
}
