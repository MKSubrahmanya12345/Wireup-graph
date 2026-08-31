/**
 * External embedded toolchain detection.
 *
 * The real firmware gauntlet (compile to a .bin with PlatformIO/arduino-cli,
 * then boot it in the Wokwi simulator) is only run when the tool is actually
 * installed — exactly like the existing `GPP-MISSING` badge, a missing
 * toolchain degrades to the stub-compile + structural gate rather than
 * failing the build. This module is the single place that asks "what can this
 * machine run?".
 */

import { runCommand } from './terminal.js';

export interface ToolInfo {
  /** Binary name we would invoke. */
  binary: string;
  available: boolean;
  /** First line of `--version`, when the tool ran. */
  version: string | null;
  /** Why it is unavailable, when known (used in the build log / health badge). */
  reason: string | null;
}

const unavailable = (binary: string, reason: string): ToolInfo => ({
  binary,
  available: false,
  version: null,
  reason,
});

/** Probe a binary with a version flag. Missing binary => unavailable, not fatal. */
export async function detectTool(binary: string, versionArgs: string[] = ['--version']): Promise<ToolInfo> {
  const result = await runCommand([binary, ...versionArgs], { timeoutMs: 15_000 });
  if (result.exitCode === 0) {
    return { binary, available: true, version: result.output.split('\n')[0]?.trim() ?? null, reason: null };
  }
  const missing = /ENOENT|not found|not recognized|command not found|spawn error/i.test(result.output) || result.exitCode === null;
  return unavailable(binary, missing ? 'not installed / not on PATH' : result.output.split('\n').slice(-2).join(' ').slice(0, 200));
}

export interface Toolchain {
  gpp: ToolInfo;
  /** PlatformIO (`pio`) — preferred real compiler; reads the generated platformio.ini. */
  platformio: ToolInfo;
  /** arduino-cli — fallback real compiler. */
  arduinoCli: ToolInfo;
  /** wokwi-cli — headless firmware simulator. */
  wokwiCli: ToolInfo;
  /** A Wokwi CI token is present (the sim gate needs it). */
  wokwiToken: boolean;
}

let cached: Toolchain | null = null;

/** Detect every external tool once and cache for the process lifetime. */
export async function detectToolchain(): Promise<Toolchain> {
  if (cached) return cached;

  // PlatformIO installs as `pio`; some distros/pipx expose `platformio`.
  let platformio = await detectTool('pio');
  if (!platformio.available) {
    const alt = await detectTool('platformio');
    if (alt.available) platformio = { ...alt, binary: 'platformio' };
  }

  cached = {
    gpp: await detectTool('g++', ['--version']),
    platformio,
    arduinoCli: await detectTool('arduino-cli', ['version']),
    wokwiCli: await detectTool('wokwi-cli', ['--version']),
    wokwiToken: Boolean(process.env.WOKWI_CLI_TOKEN && process.env.WOKWI_CLI_TOKEN.trim()),
  };
  return cached;
}

/** Test-only: forget the cached detection. */
export function resetToolchainCache(): void {
  cached = null;
}
