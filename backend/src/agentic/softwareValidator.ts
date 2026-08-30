import path from 'node:path';

import ts from 'typescript';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { BuildFile } from '../schemas/build.js';
import { materialise, runCommand, type CommandResult } from './terminal.js';
import type { ValidationFinding, ValidationReport } from './types.js';

/**
 * Software (MERN) validator — the generated project must build for real.
 *
 * Tier 1 (always): structural + cross-artifact consistency + TypeScript
 *   syntax for every .ts/.tsx (compiler API, no network needed).
 * Tier 2 (terminal enabled + network): materialise the tree, run
 *   `npm install`, then `tsc --noEmit` for the backend and `vite build`
 *   (which includes `tsc -b`) for the frontend. A software zip only ships
 *   when the project builds.
 */

const PLACEHOLDER_PATTERN = /\bTODO\b|\bFIXME\b|your code here|implementation goes here|\bTBD\b/i;

const REQUIRED_FILES = [
  'backend/src/config/deviceEndpoints.ts',
  'frontend/src/lib/deviceSpec.ts',
  'backend/package.json',
  'frontend/package.json',
];

interface ParsedSpec {
  metricIds: string[];
  metricPaths: string[];
  controlIds: string[];
  statusPath: string;
  refreshMs: number;
}

interface ParsedEndpoints {
  readIds: string[];
  readPaths: string[];
  controlIds: string[];
}

function parseDeviceSpec(source: string): ParsedSpec {
  const metricsBlock = source.match(/metrics:\s*\[([\s\S]*?)\]\s*,\s*controls:/)?.[1] ?? '';
  const controlsBlock = source.match(/controls:\s*\[([\s\S]*?)\]\s*,\s*refreshMs:/)?.[1] ?? '';
  const metricIds = [...metricsBlock.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1] ?? '');
  const metricPaths = [...metricsBlock.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1] ?? '');
  const controlIds = [...controlsBlock.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1] ?? '');
  return {
    metricIds,
    metricPaths,
    controlIds,
    statusPath: source.match(/statusPath:\s*'([^']+)'/)?.[1] ?? '',
    refreshMs: Number(source.match(/refreshMs:\s*(\d+)/)?.[1] ?? 0),
  };
}

function parseDeviceEndpoints(source: string): ParsedEndpoints {
  // Anchor on the const declaration — the `return defaultReadEndpoints;`
  // lines would otherwise swallow the file and capture the wrong block.
  const readsBlock = source.match(/const defaultReadEndpoints[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? '';
  const controlsBlock = source.match(/const defaultControlEndpoints[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? '';
  return {
    readIds: [...readsBlock.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1] ?? ''),
    readPaths: [...readsBlock.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1] ?? ''),
    controlIds: [...controlsBlock.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1] ?? ''),
  };
}

/** TypeScript syntax diagnostics per file, no type resolution required. */
function syntaxCheckAll(files: BuildFile[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const file of files) {
    if (!/\.(ts|tsx|mts)$/.test(file.path)) continue;
    const result = ts.transpileModule(file.content, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
      reportDiagnostics: true,
      fileName: path.basename(file.path),
    });
    for (const diag of result.diagnostics ?? []) {
      if (diag.category !== ts.DiagnosticCategory.Error) continue;
      const pos = diag.file ? diag.file.getLineAndCharacterOfPosition(diag.start ?? 0) : null;
      findings.push({
        severity: 'error',
        code: `TS${diag.code}`,
        message: ts.flattenDiagnosticMessageText(diag.messageText, ' '),
        file: file.path,
        line: pos ? pos.line + 1 : undefined,
      });
    }
  }
  return findings;
}

/** tsc/vite error lines → findings. */
export function parseTscOutput(output: string, treeRoot: string): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const line of output.split('\n')) {
    // "src/lib/deviceSpec.ts(21,3): error TS2322: ..." (tsc -p)
    let match = line.match(/^([\w./-]+\.tsx?)\((\d+),(\d+)\):\s*error\s*(TS\d+):\s*(.+)$/);
    if (!match) {
      // "src/...ts:21:3 - error TS2322: ..." (vite/esbuild style)
      match = line.match(/^([\w./-]+\.tsx?):(\d+):(\d+):\s*(?:-\s*)?error\s*(TS\d+)?:?\s*(.+)$/);
    }
    if (!match) continue;
    const [, file = '', lineNo = '0', , code = 'BUILD-ERROR', message = ''] = match;
    findings.push({
      severity: 'error',
      code: code || 'BUILD-ERROR',
      message,
      file: path.relative(treeRoot, file) || file,
      line: Number(lineNo),
    });
    if (findings.length >= 40) break;
  }
  return findings;
}

export interface SoftwareValidationOptions {
  workDir: string;
  /** Expected device web port from the firmware (WEB_SERVER_PORT). */
  devicePort: number;
  firmwareJsonFields: string[];
  terminal?: boolean;
}

export async function validateSoftware(
  files: BuildFile[],
  options: SoftwareValidationOptions,
): Promise<ValidationReport> {
  const startedAt = Date.now();
  const commands: CommandResult[] = [];
  const checks: ValidationReport['checks'] = [];
  const findings: ValidationFinding[] = [];
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  // ── Tier 1a: required files ───────────────────────────────────────────────
  const missing = REQUIRED_FILES.filter((p) => !byPath.has(p));
  checks.push({
    name: 'required-files',
    ok: missing.length === 0,
    detail: missing.length ? `Missing: ${missing.join(', ')}` : `${files.length} files, all required artifacts present`,
  });
  for (const p of missing) findings.push({ severity: 'error', code: 'MISSING-FILE', message: `Software tree is missing ${p}` });

  // ── Tier 1b: placeholders ─────────────────────────────────────────────────
  const offenders = files.filter((f) => PLACEHOLDER_PATTERN.test(f.content));
  checks.push({
    name: 'no-placeholders',
    ok: offenders.length === 0,
    detail: offenders.length ? `${offenders.length} file(s) contain placeholders` : 'No placeholder code',
  });
  for (const f of offenders) findings.push({ severity: 'error', code: 'PLACEHOLDER', message: 'File contains placeholder/incomplete code.', file: f.path });

  // ── Tier 1c: TypeScript syntax (compiler API) ─────────────────────────────
  const syntaxErrors = syntaxCheckAll(files);
  checks.push({
    name: 'ts-syntax',
    ok: syntaxErrors.length === 0,
    detail: syntaxErrors.length ? `${syntaxErrors.length} syntax error(s)` : 'Every .ts/.tsx parses cleanly',
  });
  findings.push(...syntaxErrors);

  // ── Tier 1d: spec ⇄ endpoints ⇄ firmware consistency ─────────────────────
  const specSource = byPath.get('frontend/src/lib/deviceSpec.ts');
  const endpointsSource = byPath.get('backend/src/config/deviceEndpoints.ts');
  if (specSource && endpointsSource) {
    const spec = parseDeviceSpec(specSource);
    const eps = parseDeviceEndpoints(endpointsSource);

    const metricNoEndpoint = spec.metricIds.filter((id) => !eps.readIds.includes(id));
    const controlNoEndpoint = spec.controlIds.filter((id) => !eps.controlIds.includes(id));
    const ok = metricNoEndpoint.length === 0 && controlNoEndpoint.length === 0;
    checks.push({
      name: 'spec-endpoint-consistency',
      ok,
      detail: ok
        ? `${spec.metricIds.length} metric(s) and ${spec.controlIds.length} control(s) all backed by endpoints`
        : `Unbacked metrics: ${metricNoEndpoint.join(', ') || 'none'} · controls: ${controlNoEndpoint.join(', ') || 'none'}`,
    });
    for (const id of metricNoEndpoint) findings.push({ severity: 'error', code: 'METRIC-NO-ENDPOINT', message: `Metric "${id}" has no backend read endpoint.` });
    for (const id of controlNoEndpoint) findings.push({ severity: 'error', code: 'CONTROL-NO-ENDPOINT', message: `Control "${id}" has no backend control endpoint.` });

    // Firmware field coverage: every metric path must read a field the firmware emits.
    const missingFields = options.firmwareJsonFields.length
      ? spec.metricPaths.filter((metricPath) => {
          const field = metricPath.split('.').pop()!;
          return !options.firmwareJsonFields.includes(field);
        })
      : [];
    checks.push({
      name: 'firmware-field-coverage',
      ok: missingFields.length === 0,
      detail: missingFields.length
        ? `Metrics reading firmware fields that do not exist: ${missingFields.join(', ')}`
        : 'Every metric path resolves to a field the firmware publishes',
    });
    for (const p of missingFields) findings.push({ severity: 'error', code: 'FIELD-NOT-PUBLISHED', message: `deviceSpec path "${p}" is not published by the firmware JSON.` });

    // Port agreement between .env and the firmware.
    const envExample = byPath.get('backend/.env.example') ?? '';
    const envPort = Number(envExample.match(/DEVICE_PORT=(\d+)/)?.[1] ?? NaN);
    checks.push({
      name: 'port-agreement',
      ok: envPort === options.devicePort,
      detail: envPort === options.devicePort
        ? `Backend targets device port ${envPort}, firmware serves ${options.devicePort}`
        : `backend .env says DEVICE_PORT=${envPort}, firmware serves port ${options.devicePort}`,
    });
    if (envPort !== options.devicePort) {
      findings.push({ severity: 'error', code: 'PORT-MISMATCH', message: `DEVICE_PORT (${envPort}) must match the firmware HTTP port (${options.devicePort}).` });
    }
  }

  const hardFail = () => findings.some((f) => f.severity === 'error');
  if (hardFail()) return finish(checks, findings, commands, startedAt);

  // ── Tier 2: real build ────────────────────────────────────────────────────
  const terminalEnabled = options.terminal ?? env.AGENTIC_TERMINAL_VALIDATION !== '0';
  if (!terminalEnabled) {
    checks.push({ name: 'full-build', ok: false, detail: 'Skipped: terminal validation disabled (AGENTIC_TERMINAL_VALIDATION=0)' });
    return finish(checks, findings, commands, startedAt);
  }

  const treeDir = path.join(options.workDir, 'software-tree');
  await materialise(treeDir, files);

  const network = await runCommand(['npm', 'ping', '--registry=https://registry.npmjs.org'], { timeoutMs: 25_000 });
  commands.push(network);
  if (network.exitCode !== 0) {
    checks.push({ name: 'full-build', ok: false, detail: 'Skipped: npm registry unreachable — Tier-1 checks are authoritative' });
    return finish(checks, findings, commands, startedAt);
  }

  for (const pkg of ['backend', 'frontend'] as const) {
    const install = await runCommand(['npm', 'install', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: path.join(treeDir, pkg),
      timeoutMs: Math.max(env.AGENTIC_COMMAND_TIMEOUT_MS, 300_000),
    });
    commands.push(install);
    checks.push({
      name: `npm install (${pkg})`,
      ok: install.exitCode === 0,
      detail: install.exitCode === 0 ? `Dependencies installed (${Math.round(install.durationMs / 1000)} s)` : `npm install failed in ${pkg}`,
    });
    if (install.exitCode !== 0) {
      findings.push({ severity: 'error', code: 'NPM-INSTALL', message: `npm install failed in ${pkg}: ${install.output.split('\n').slice(-3).join(' | ')}` });
      return finish(checks, findings, commands, startedAt);
    }
  }

  // Backend typecheck.
  const beTsc = await runCommand(['npx', 'tsc', '-p', 'tsconfig.json', '--noEmit'], {
    cwd: path.join(treeDir, 'backend'),
    timeoutMs: 180_000,
  });
  commands.push(beTsc);
  const beErrors = beTsc.exitCode === 0 ? [] : parseTscOutput(beTsc.output, treeDir);
  checks.push({
    name: 'tsc --noEmit (backend)',
    ok: beTsc.exitCode === 0,
    detail: beTsc.exitCode === 0 ? 'API type-checks clean' : `${beErrors.length} type error(s) in API`,
  });
  findings.push(...beErrors);
  if (beErrors.length === 0 && beTsc.exitCode !== 0) {
    findings.push({ severity: 'error', code: 'TSC-BACKEND', message: beTsc.output.split('\n').slice(-4).join(' | ') });
  }

  // Frontend production build (tsc -b + vite build).
  const feBuild = await runCommand(['npm', 'run', 'build'], {
    cwd: path.join(treeDir, 'frontend'),
    timeoutMs: 300_000,
  });
  commands.push(feBuild);
  const feErrors = feBuild.exitCode === 0 ? [] : parseTscOutput(feBuild.output, treeDir);
  checks.push({
    name: 'vite build (frontend)',
    ok: feBuild.exitCode === 0,
    detail: feBuild.exitCode === 0 ? `Dashboard built to frontend/dist (${Math.round(feBuild.durationMs / 1000)} s)` : `${feErrors.length || '?'} build error(s) in dashboard`,
  });
  findings.push(...feErrors);
  if (feErrors.length === 0 && feBuild.exitCode !== 0) {
    findings.push({ severity: 'error', code: 'VITE-BUILD', message: feBuild.output.split('\n').slice(-4).join(' | ') });
  }

  const report = finish(checks, findings, commands, startedAt);
  logger.info({ ok: report.ok, durationMs: report.durationMs }, 'software validation complete');
  return report;
}

function finish(
  checks: ValidationReport['checks'],
  findings: ValidationFinding[],
  commands: CommandResult[],
  startedAt: number,
): ValidationReport {
  return {
    target: 'software',
    ok: !findings.some((f) => f.severity === 'error'),
    checks,
    findings,
    commands: commands.map((c) => ({ cmd: c.cmd, exitCode: c.exitCode, output: c.output, durationMs: c.durationMs })),
    durationMs: Date.now() - startedAt,
  };
}
