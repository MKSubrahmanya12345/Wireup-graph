import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { env } from '../config/env.js';
import type { BuildFile } from '../schemas/build.js';

/**
 * Safe-ish terminal execution for the agentic validator.
 *
 * Commands are spawned with `shell: false` (no injection through file
 * content), hard time-boxed, and their output is captured so the browser can
 * render a real build log. Only the pipeline itself picks the argv —
 * generated file CONTENT is never executed, only type-checked/compiled.
 */

export interface CommandResult {
  cmd: string;
  exitCode: number | null;
  output: string;
  durationMs: number;
  timedOut: boolean;
}

const MAX_OUTPUT_CHARS = 12_000;

const IS_WINDOWS = process.platform === 'win32';

/**
 * Windows-only cmd.exe metacharacters that force quoting when they appear in
 * an argument. Whitespace also forces quoting so multi-word args survive.
 */
const CMD_SPECIAL_CHARS = /[\s&|<>^()%!"]/;

/**
 * Quote a single argv entry for a `cmd.exe /c <line>` command line. Doubles
 * embedded double-quotes and wraps the whole argument in quotes whenever it
 * contains whitespace or a cmd.exe metacharacter. Arguments that need no
 * special handling are passed through untouched to keep logs readable.
 */
function quoteForCmd(arg: string): string {
  if (arg.length > 0 && !CMD_SPECIAL_CHARS.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

/** Build the full command line cmd.exe /c should run for a given argv. */
function buildCmdLine(argv: string[]): string {
  return argv.map(quoteForCmd).join(' ');
}

/** True for the two spawn failure modes CVE-2024-27980 hardening produces for .cmd shims. */
function isCmdShimSpawnError(code: unknown): boolean {
  return code === 'ENOENT' || code === 'EINVAL';
}

export async function runCommand(
  argv: string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? env.AGENTIC_COMMAND_TIMEOUT_MS;
  const cmd = argv.join(' ');

  const executable = argv[0];
  if (!executable) {
    return Promise.resolve({
      cmd: '(empty command)',
      exitCode: 1,
      output: 'no executable given',
      durationMs: 0,
      timedOut: false,
    });
  }

  /**
   * Run one spawn attempt. `viaShell` selects the Windows cmd.exe retry mode
   * (only ever used on win32, after a direct spawn hit ENOENT/EINVAL — see
   * the caller below). POSIX always takes the `viaShell: false` path, which
   * is byte-identical to the pre-existing behaviour.
   */
  const attempt = (viaShell: boolean): Promise<CommandResult | { retryable: true }> =>
    new Promise((resolve) => {
      let timedOut = false;
      let settled = false;
      let output = '';
      let child: ChildProcess;

      const spawnExecutable = viaShell ? (process.env.ComSpec ?? process.env.comspec ?? 'cmd.exe') : executable;
      const spawnArgs = viaShell ? ['/d', '/s', '/c', buildCmdLine(argv)] : argv.slice(1);

      try {
        child = spawn(spawnExecutable, spawnArgs, {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          ...(viaShell ? { windowsVerbatimArguments: true } : {}),
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (!viaShell && IS_WINDOWS && isCmdShimSpawnError(code)) {
          resolve({ retryable: true });
          return;
        }
        resolve({
          cmd,
          exitCode: null,
          output: `spawn failed: ${error instanceof Error ? error.message : String(error)}`,
          durationMs: Date.now() - startedAt,
          timedOut: false,
        });
        return;
      }

      const append = (chunk: Buffer) => {
        if (output.length < MAX_OUTPUT_CHARS) {
          output += chunk.toString('utf8');
          if (output.length > MAX_OUTPUT_CHARS) {
            output = `${output.slice(0, MAX_OUTPUT_CHARS)}\n…[output truncated]`;
          }
        }
      };
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      // Node fires `close` even after a spawn that never really started (the
      // ENOENT/EINVAL case). `settled` makes sure only the first of
      // error/close for THIS attempt can resolve — a late event from an
      // attempt we've already abandoned (attempt 1, after we decided to
      // retry) must never settle the promise or race attempt 2.
      child.on('error', (error: Error) => {
        if (settled) return;
        const code = (error as NodeJS.ErrnoException)?.code;
        if (!viaShell && IS_WINDOWS && isCmdShimSpawnError(code)) {
          settled = true;
          clearTimeout(timer);
          resolve({ retryable: true });
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          cmd,
          exitCode: null,
          output: `spawn error: ${error.message}`,
          durationMs: Date.now() - startedAt,
          timedOut: false,
        });
      });

      child.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          cmd,
          exitCode: code,
          output: output.trim(),
          durationMs: Date.now() - startedAt,
          timedOut,
        });
      });
    });

  const first = await attempt(false);
  if (!('retryable' in first)) return first;

  // Windows only: the direct spawn couldn't resolve a .cmd shim (pnpm, npm,
  // tsc, etc. all ship as .cmd on Windows). Retry once through cmd.exe so
  // PATHEXT resolution kicks in. POSIX never reaches here.
  const second = await attempt(true);
  if ('retryable' in second) {
    // Should not happen (cmd.exe itself missing) — surface a clean error.
    return {
      cmd,
      exitCode: null,
      output: 'spawn error: could not locate cmd.exe to resolve a .cmd shim on Windows',
      durationMs: Date.now() - startedAt,
      timedOut: false,
    };
  }
  return second;
}

// ── Work directories ────────────────────────────────────────────────────────

export interface WorkDir {
  root: string;
  cleanup: () => Promise<void>;
}

let sessionCounter = 0;

/** Materialise a build session directory: <workdir>/<slug>-<n>/. */
export async function createWorkDir(slug: string): Promise<WorkDir> {
  sessionCounter += 1;
  const base = env.AGENTIC_WORKDIR || path.join(os.tmpdir(), 'wireup-agentic');
  const root = await mkdtemp(path.join(base, `${slug}-`)).catch(async () => {
    // Base dir missing — create then retry once.
    await mkdir(base, { recursive: true });
    return mkdtemp(path.join(base, `${slug}-${sessionCounter}-`));
  });
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/** Write a set of files under a directory, creating parents as needed. */
export async function materialise(dir: string, files: BuildFile[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all(
    files.map(async (file) => {
      const target = path.join(dir, ...file.path.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, 'utf8');
    }),
  );
}

// ── Long-running processes (for the runtime smoke gate) ─────────────────────

export interface ServerProcess {
  /** Captured stdout+stderr so far. */
  output: string;
  /** Resolves true when the output matches, false on timeout/exit. */
  waitForStart: (pattern: RegExp, timeoutMs: number) => Promise<boolean>;
  stop: () => Promise<void>;
}

/**
 * Spawn a server that keeps running across validation steps (device stub,
 * generated backend boot). Nothing about the command comes from generated
 * file content — only fixed argv chosen by the validator.
 */
export function startServer(
  argv: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): ServerProcess {
  const executable = argv[0];
  const timeoutMs = options.timeoutMs ?? 60_000;
  let output = '';
  let buffer = '';
  let exited = false;
  const killTimer = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }, timeoutMs);

  const child = spawn(executable!, argv.slice(1), {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const append = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    output += text;
    buffer += text;
    if (buffer.length > 60_000) buffer = buffer.slice(-30_000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.on('exit', () => {
    exited = true;
    clearTimeout(killTimer);
  });

  return {
    get output() {
      return output;
    },
    waitForStart: (pattern: RegExp, waitMs: number) =>
      new Promise<boolean>((resolve) => {
        const deadline = Date.now() + waitMs;
        const poll = () => {
          if (pattern.test(buffer)) return resolve(true);
          if (exited || Date.now() > deadline) return resolve(false);
          setTimeout(poll, 100);
        };
        poll();
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        clearTimeout(killTimer);
        if (exited) return resolve();
        child.once('exit', () => resolve());
        try {
          child.kill('SIGTERM');
        } catch {
          resolve();
        }
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
          resolve();
        }, 3000).unref();
      }),
  };
}

/** Grab a free TCP port by binding 0 and closing. */
export async function freePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('no port')));
      }
    });
  });
}
