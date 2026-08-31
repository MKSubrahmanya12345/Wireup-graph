/**
 * The real firmware gauntlet — compile to an actual ESP32 binary and boot it
 * in the Wokwi simulator.
 *
 * Both gates are best-effort and auto-degrade: they run only when the tool is
 * installed and enabled, and a missing tool produces a skipped *check* (not an
 * error), mirroring the `GPP-MISSING` behaviour of the g++ syntax gate. When
 * the tool IS present, a failed compile/sim is a hard error with real
 * diagnostics — those are fed back into the repair loop by the validator.
 */

import path from 'node:path';

import { env } from '../config/env.js';
import { materialise, runCommand, type CommandResult } from './terminal.js';
import { detectToolchain, type ToolInfo } from './toolchain.js';
import { generateWokwiConfig } from './wokwiConfig.js';
import type { DeviceBuildPlan, ValidationFinding, ValidationReport } from './types.js';
import type { BuildFile } from '../schemas/build.js';

export interface EmbeddedGateResult {
  commands: CommandResult[];
  checks: { name: string; ok: boolean; detail: string }[];
  findings: ValidationFinding[];
}

/** Find which tool (pio/platformio) actually runs. */
function pioBinary(tool: ToolInfo): { binary: string; version: string } | null {
  return tool.available ? { binary: tool.binary, version: tool.version ?? '' } : null;
}

/** Parse the useful error lines out of a PlatformIO/arduino build log. */
function parseBuildErrors(output: string): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const seen = new Set<string>();
  for (const line of output.split('\n')) {
    // g++/xtensa-gcc style: path:line:col: error: ...
    const match = line.match(/([\w./-]+\.(?:cpp|ino|c|h|hpp)):(\d+)(?::\d+)?:\s*(?:fatal error|error):\s*(.+)$/);
    if (!match) continue;
    const [, file = '', lineNo = '0', message = ''] = match;
    const base = path.basename(file);
    const key = `${base}:${lineNo}:${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      severity: 'error',
      code: 'EMBED-COMPILE',
      message: `embedded toolchain: ${message.trim()}`,
      file: base,
      line: Number(lineNo),
    });
    if (findings.length >= 30) break;
  }
  if (findings.length === 0 && output.trim()) {
    findings.push({
      severity: 'error',
      code: 'EMBED-BUILD',
      message: `firmware did not build for the target: ${output.split('\n').filter(Boolean).slice(-4).join(' | ').slice(0, 400)}`,
    });
  }
  return findings;
}

/**
 * Real compile gate. Materialises the firmware project and builds it with
 * PlatformIO (preferred) or arduino-cli. Returns a skipped check when no real
 * toolchain is available.
 */
export async function compileFirmware(
  files: BuildFile[],
  options: { workDir: string; plan: DeviceBuildPlan },
): Promise<EmbeddedGateResult> {
  const commands: CommandResult[] = [];
  const checks: EmbeddedGateResult['checks'] = [];
  const findings: ValidationFinding[] = [];

  if (env.AGENTIC_EMBEDDED_COMPILE === '0') {
    checks.push({ name: 'embedded compile', ok: true, detail: 'Skipped: AGENTIC_EMBEDDED_COMPILE=0' });
    return { commands, checks, findings };
  }

  const toolchain = await detectToolchain();
  const pio = pioBinary(toolchain.platformio);

  if (!pio && !toolchain.arduinoCli.available) {
    checks.push({
      name: 'embedded compile',
      ok: true,
      detail:
        'Skipped: neither PlatformIO (pio) nor arduino-cli is installed. The g++ stub gate still ran; install PlatformIO for a real ESP32 binary (pio run).',
    });
    return { commands, checks, findings };
  }

  const projectDir = path.join(options.workDir, 'embedded-project');
  await materialise(projectDir, files);

  if (pio) {
    checks.push({
      name: 'platformio install (pio pkg install)',
      ok: true,
      detail: `PlatformIO ${pio.version} — resolving libraries + toolchain (may download the esp32 platform on first run)`,
    });
    const install = await runCommand([pio.binary, 'pkg', 'install'], {
      cwd: projectDir,
      timeoutMs: Math.max(env.AGENTIC_COMMAND_TIMEOUT_MS, 300_000),
    });
    commands.push(install);

    const build = await runCommand([pio.binary, 'run'], {
      cwd: projectDir,
      timeoutMs: Math.max(env.AGENTIC_COMMAND_TIMEOUT_MS, 600_000),
    });
    commands.push(build);

    if (build.exitCode === 0) {
      checks.push({
        name: 'pio run (real ESP32 binary)',
        ok: true,
        detail: `Compiled to firmware.elf/.bin for ${options.plan.board.name} (${Math.round(build.durationMs / 1000)} s)`,
      });
    } else {
      checks.push({ name: 'pio run (real ESP32 binary)', ok: false, detail: 'PlatformIO build failed — see diagnostics' });
      findings.push(...parseBuildErrors(`${install.output}\n${build.output}`));
    }
    return { commands, checks, findings };
  }

  // arduino-cli fallback: compile the .ino with the esp32 core index.
  const core = 'esp32:esp32';
  const update = await runCommand(['arduino-cli', 'core', 'update-index'], {
    cwd: projectDir,
    timeoutMs: 120_000,
  });
  commands.push(update);
  const installCore = await runCommand(['arduino-cli', 'core', 'install', core], {
    cwd: projectDir,
    timeoutMs: 600_000,
  });
  commands.push(installCore);

  const sketch = files.find((f) => /\.ino$/.test(f.path));
  const fqbn = options.plan.board.id === 'esp32-s3-devkit' ? 'esp32:esp32:esp32s3' : 'esp32:esp32:esp32';
  const compile = await runCommand(['arduino-cli', 'compile', '--fqbn', fqbn, sketch ? path.join(projectDir, sketch.path) : projectDir], {
    cwd: projectDir,
    timeoutMs: 600_000,
  });
  commands.push(compile);

  if (compile.exitCode === 0) {
    checks.push({ name: 'arduino-cli compile (real binary)', ok: true, detail: `Compiled for ${fqbn}` });
  } else {
    checks.push({ name: 'arduino-cli compile (real binary)', ok: false, detail: 'arduino-cli build failed — see diagnostics' });
    findings.push(...parseBuildErrors(compile.output));
  }
  return { commands, checks, findings };
}

/**
 * Wokwi simulation gate: write wokwi.toml + diagram.json into the compiled
 * PlatformIO project and boot the binary headlessly, asserting the firmware
 * reaches its "HTTP API listening" line. Skips when wokwi-cli/token are
 * absent or the real compile didn't produce a binary.
 */
export async function simulateFirmware(
  files: BuildFile[],
  options: { workDir: string; plan: DeviceBuildPlan; compiled: boolean },
): Promise<EmbeddedGateResult> {
  const commands: CommandResult[] = [];
  const checks: EmbeddedGateResult['checks'] = [];
  const findings: ValidationFinding[] = [];

  if (env.AGENTIC_WOKWI === '0') {
    checks.push({ name: 'wokwi simulation', ok: true, detail: 'Skipped: AGENTIC_WOKWI=0' });
    return { commands, checks, findings };
  }

  const toolchain = await detectToolchain();

  if (!options.compiled) {
    checks.push({
      name: 'wokwi simulation',
      ok: true,
      detail: 'Skipped: no compiled binary (PlatformIO/arduino-cli not run). Install PlatformIO to boot the firmware in Wokwi.',
    });
    return { commands, checks, findings };
  }
  if (!toolchain.wokwiCli.available) {
    checks.push({
      name: 'wokwi simulation',
      ok: true,
      detail: 'Skipped: wokwi-cli not installed (npm i -g wokwi-cli / see https://docs.wokwi.com/wokwi-cli).',
    });
    return { commands, checks, findings };
  }
  if (!toolchain.wokwiToken) {
    checks.push({
      name: 'wokwi simulation',
      ok: true,
      detail: 'Skipped: WOKWI_CLI_TOKEN not set (free token at https://wokwi.com/dashboard/ci).',
    });
    return { commands, checks, findings };
  }

  const projectDir = path.join(options.workDir, 'embedded-project');
  const config = generateWokwiConfig(options.plan);
  await materialise(projectDir, [
    { path: 'wokwi.toml', content: config.wokwiToml },
    { path: 'diagram.json', content: config.diagramJson },
  ]);
  if (config.unsupported.length > 0) {
    checks.push({
      name: 'wokwi diagram',
      ok: true,
      detail: `virtual circuit generated; no Wokwi model for: ${config.unsupported.join(', ')} (those parts are omitted from the sim)`,
    });
  }

  // The firmware prints this once Wi-Fi + the HTTP server are up.
  const expectText = 'listening on port';
  const sim = await runCommand(
    ['wokwi-cli', '.', '--timeout', '60000', '--expect-text', expectText, '--serial-log-file', 'wokwi-serial.log'],
    {
      cwd: projectDir,
      timeoutMs: 120_000,
      env: { WOKWI_CLI_TOKEN: process.env.WOKWI_CLI_TOKEN ?? '' },
    },
  );
  commands.push(sim);

  if (sim.exitCode === 0 && sim.output.includes(expectText)) {
    checks.push({
      name: 'wokwi simulation (firmware boots + serves)',
      ok: true,
      detail: `Booted the compiled ${options.plan.board.name} firmware in a virtual circuit; firmware reached "${expectText}"`,
    });
  } else if (sim.timedOut || /42\b|timeout/i.test(sim.output)) {
    checks.push({ name: 'wokwi simulation', ok: false, detail: 'Firmware booted but never reached the HTTP-server line' });
    findings.push({
      severity: 'error',
      code: 'WOKWI-TIMEOUT',
      message: `Firmware did not reach "${expectText}" within the sim window (check Wi-Fi init / server.begin()). Serial tail: ${sim.output.split('\n').slice(-6).join(' | ').slice(0, 300)}`,
    });
  } else {
    checks.push({ name: 'wokwi simulation', ok: false, detail: 'Wokwi simulation failed' });
    findings.push({
      severity: 'error',
      code: 'WOKWI-FAILED',
      message: `Wokwi run failed: ${sim.output.split('\n').filter(Boolean).slice(-6).join(' | ').slice(0, 400)}`,
    });
  }

  return { commands, checks, findings };
}

/** Merge an embedded-gate result into a ValidationReport shell. */
export function attachGate(
  report: ValidationReport,
  gate: EmbeddedGateResult,
): ValidationReport {
  return {
    ...report,
    commands: [...report.commands, ...gate.commands],
    checks: [...report.checks, ...gate.checks],
    findings: [...report.findings, ...gate.findings],
    ok: report.ok && !gate.findings.some((f) => f.severity === 'error'),
  };
}
