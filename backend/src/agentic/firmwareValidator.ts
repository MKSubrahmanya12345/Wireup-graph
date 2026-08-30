import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from '../config/env.js';
import type { BuildFile } from '../schemas/build.js';
import { materialise, runCommand, type CommandResult } from './terminal.js';
import type { ValidationFinding, ValidationReport } from './types.js';

/**
 * Firmware validator — real compilation, not vibes.
 *
 * Stage 1 (always): structural engineering checks on the file tree.
 * Stage 2 (when AGENTIC_TERMINAL_VALIDATION=1): the sketch is compiled with
 * the system C++ compiler (`g++ -fsyntax-only`) against the bundled Arduino /
 * ESP32 core stubs. A sketch only ships if the compiler accepts it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const STUBS_DIR = path.resolve(here, '..', '..', 'agentic', 'arduino-stubs');

const PLACEHOLDER_PATTERN = /\bTODO\b|\bFIXME\b|your code here|implementation goes here|\bTBD\b/i;
/** Headers the harness can compile against (add stubs here as the KB grows). */
const STUB_HEADERS = new Set([
  'Arduino.h', 'Wire.h', 'WiFi.h', 'WebServer.h', 'ESPmDNS.h', 'DHT.h',
  'OneWire.h', 'DallasTemperature.h', 'ESP32Servo.h', 'Adafruit_BME280.h',
]);
/** Real system headers g++ resolves itself. */
const SYSTEM_HEADERS = new Set(['stdint.h', 'string.h', 'math.h', 'stdio.h', 'stdlib.h']);

function structuralChecks(files: BuildFile[]): { checks: ValidationReport['checks']; findings: ValidationFinding[] } {
  const checks: ValidationReport['checks'] = [];
  const findings: ValidationFinding[] = [];
  const paths = files.map((f) => f.path);

  const entry = files.find(
    (f) => /(^|\/)src\/main\.cpp$/.test(f.path) || /\.ino$/.test(f.path),
  );
  checks.push({
    name: 'entrypoint',
    ok: Boolean(entry),
    detail: entry ? `Sketch entry point: ${entry.path}` : 'No .ino or src/main.cpp entry point found',
  });
  if (!entry) findings.push({ severity: 'error', code: 'NO-ENTRYPOINT', message: 'Firmware has no .ino / src/main.cpp entry point.' });

  if (entry) {
    const hasSetup = /\bvoid\s+setup\s*\(/.test(entry.content);
    const hasLoop = /\bvoid\s+loop\s*\(/.test(entry.content);
    checks.push({
      name: 'setup-loop',
      ok: hasSetup && hasLoop,
      detail: hasSetup && hasLoop ? 'setup() and loop() present' : 'setup() or loop() missing',
    });
    if (!hasSetup || !hasLoop) {
      findings.push({ severity: 'error', code: 'NO-SETUP-LOOP', message: 'Arduino setup()/loop() functions are missing.', file: entry.path });
    }
  }

  // Placeholder scan — generated code must be complete.
  const offenders = files.filter((f) => PLACEHOLDER_PATTERN.test(f.content));
  checks.push({
    name: 'no-placeholders',
    ok: offenders.length === 0,
    detail: offenders.length ? `${offenders.length} file(s) contain placeholder markers` : 'No placeholder code anywhere',
  });
  for (const f of offenders) {
    findings.push({ severity: 'error', code: 'PLACEHOLDER', message: 'File contains placeholder/incomplete code.', file: f.path, hint: 'Complete the body — stubs and TODOs are not shippable.' });
  }

  // Include audit against the validation harness.
  const unknown = new Set<string>();
  for (const f of files) {
    for (const match of f.content.matchAll(/#include\s*[<"]([^>"]+)[>"]/g)) {
      const header = match[1];
      if (!header) continue;
      const base = header.split('/').pop() ?? header;
      if (STUB_HEADERS.has(base) || SYSTEM_HEADERS.has(base)) continue;
      if (header === 'config.h' || paths.some((p) => p.endsWith(header))) continue;
      unknown.add(header);
    }
  }
  checks.push({
    name: 'include-audit',
    ok: unknown.size === 0,
    detail: unknown.size ? `Unresolvable includes: ${[...unknown].join(', ')}` : 'Every include resolves to the core, a stubbed library, or a project file',
  });
  for (const header of unknown) {
    findings.push({
      severity: 'error',
      code: 'UNKNOWN-INCLUDE',
      message: `#include <${header}> does not resolve to the Arduino core, a known library, or a project file.`,
      hint: 'Use libraries from the Wireup knowledge base only.',
    });
  }

  return { checks, findings };
}

/** Turn compiler stderr into structured findings. */
export function parseCompilerDiagnostics(output: string, knownFiles: string[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const seen = new Set<string>();
  for (const line of output.split('\n')) {
    const match = line.match(/^(.+?\.(?:cpp|ino|h|c|hpp)):(\d+)(?::\d+)?:\s*(fatal error|error|warning):\s*(.+)$/);
    if (!match) continue;
    const [, file = '', lineNo = '0', level = 'error', message = ''] = match;
    const rel = knownFiles.find((known) => file.endsWith(known) || file.endsWith(known.replaceAll('/', path.sep))) ?? path.basename(file);
    const key = `${rel}:${lineNo}:${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      severity: level === 'warning' ? 'warning' : 'error',
      code: level === 'warning' ? 'GPP-WARNING' : 'GPP-SYNTAX',
      message: `g++: ${message}`,
      file: rel,
      line: Number(lineNo),
    });
    if (findings.length >= 30) break; // first N errors are the actionable ones
  }
  if (findings.length === 0 && output.trim()) {
    findings.push({
      severity: 'error',
      code: 'GPP-OTHER',
      message: output.trim().split('\n').slice(-4).join(' | '),
    });
  }
  return findings;
}

export interface FirmwareValidationOptions {
  workDir: string;
  boardDefine?: string;
  commands?: CommandResult[];
  terminal?: boolean;
}

export async function validateFirmware(
  files: BuildFile[],
  options: FirmwareValidationOptions,
): Promise<ValidationReport> {
  const startedAt = Date.now();
  const commands: CommandResult[] = [];
  const { checks, findings } = structuralChecks(files);

  const terminalEnabled = options.terminal ?? env.AGENTIC_TERMINAL_VALIDATION !== '0';
  if (!terminalEnabled || findings.some((f) => f.severity === 'error')) {
    checks.push({
      name: 'g++ -fsyntax-only',
      ok: false,
      detail: terminalEnabled ? 'Skipped: structural errors must be fixed first' : 'Skipped: terminal validation disabled',
    });
    return finish('firmware', checks, findings, commands, startedAt);
  }

  // ── Stage 2: materialise + compile ────────────────────────────────────────
  const fwDir = path.join(options.workDir, 'firmware-tree');
  await mkdir(fwDir, { recursive: true });
  await materialise(fwDir, files);
  const stubsTarget = path.join(fwDir, '.wireup-stubs');
  await cp(STUBS_DIR, stubsTarget, { recursive: true });

  const syntaxUnits = files.filter((f) => /\.(ino|cpp)$/.test(f.path));
  const boardDefine = options.boardDefine ?? 'ESP32';

  for (const unit of syntaxUnits) {
    // .ino files are sketch units — wrap as C++ with the Arduino prelude.
    const sourcePath = path.join(fwDir, ...unit.path.split('/'));
    let compilePath = sourcePath;
    if (unit.path.endsWith('.ino')) {
      let content = await readFile(sourcePath, 'utf8');
      if (!/#include\s*[<"]Arduino\.h[>"]/.test(content)) content = `#include <Arduino.h>\n${content}`;
      compilePath = `${sourcePath}.cpp`;
      await writeFile(compilePath, content, 'utf8');
    }

    const result = await runCommand(
      [
        'g++', '-fsyntax-only', '-std=gnu++17', '-Wall',
        `-I${stubsTarget}`, `-I${path.dirname(sourcePath)}`, `-I${fwDir}`,
        '-DARDUINO=10812', `-D${boardDefine}`,
        compilePath,
      ],
      { cwd: fwDir, timeoutMs: 60_000 },
    );
    commands.push(result);

    const diagnostics = parseCompilerDiagnostics(result.output, files.map((f) => f.path));
    const errors = diagnostics.filter((d) => d.severity === 'error');
    findings.push(...diagnostics.filter((d) => !findings.some((f) => f.code === d.code && f.file === d.file && f.line === d.line)));
    checks.push({
      name: `g++ -fsyntax-only ${unit.path}`,
      ok: result.exitCode === 0 && errors.length === 0,
      detail:
        result.exitCode === 0 && errors.length === 0
          ? `Compiler accepted ${unit.path} (${result.durationMs} ms)`
          : result.timedOut
            ? 'Compiler timed out'
            : `${errors.length} compiler error(s) in ${unit.path}`,
    });
  }

  return finish('firmware', checks, findings, commands, startedAt);
}

function finish(
  target: ValidationReport['target'],
  checks: ValidationReport['checks'],
  findings: ValidationFinding[],
  commands: CommandResult[],
  startedAt: number,
): ValidationReport {
  return {
    target,
    ok: !findings.some((f) => f.severity === 'error'),
    checks,
    findings,
    commands: commands.map((c) => ({ cmd: c.cmd, exitCode: c.exitCode, output: c.output, durationMs: c.durationMs })),
    durationMs: Date.now() - startedAt,
  };
}
