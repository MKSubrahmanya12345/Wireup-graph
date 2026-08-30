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

  return new Promise((resolve) => {
    let timedOut = false;
    let output = '';
    let child: ChildProcess;
    try {
      child = spawn(executable, argv.slice(1), {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (error) {
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

    child.on('error', (error: Error) => {
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
