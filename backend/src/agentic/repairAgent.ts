/**
 * Diagnostics-fed firmware repair — the "act" half of the agentic loop.
 *
 * The validator returns structured findings (g++ diagnostics, JSON-contract
 * violations, placeholder scans). This module turns those findings into a
 * *patched* firmware tree in two layers:
 *
 *   1. `applyDeterministicFixes` — mechanical, safe fix-ups the engine can do
 *      with certainty (unknown include remap/removal, missing Arduino prelude,
 *      a well-known wrong DHT class name, a missing contract field the KB
 *      knows how to publish). No LLM, no risk of drift.
 *
 *   2. `repairFirmwareWithLlm` — when an LLM is configured, the failing
 *      sources AND the exact compiler output are handed to the model, which
 *      returns a set of small search/replace edits. Edits are applied
 *      deterministically: every search block must match exactly once, nothing
 *      is blindly overwritten, and an edit set that does not change the bytes
 *      (or fails to apply) is rejected so the loop cannot oscillate.
 *
 * Either layer can succeed on its own; the pipeline tries deterministic first,
 * then LLM, then (as a last resort) the knowledge-base resynthesis that is the
 * contract by construction.
 */

import { z } from 'zod';

import type { BuildFile, FirmwareResult } from '../schemas/build.js';
import { firmwareResultSchema } from '../schemas/build.js';
import { callLlm, LlmError, parseLlmJson, type LlmProvider } from '../services/llmService.js';
import type { DeviceBuildPlan } from './types.js';
import type { ValidationFinding } from './types.js';

// ── Targeted search/replace edits ───────────────────────────────────────────

export interface FileEdit {
  /** File path as it appears in the firmware result. */
  path: string;
  /**
   * Exact block present in the current file. Must match once, verbatim
   * (whitespace-trimmed per the rules in applyEdits). Empty string = insert
   * at `position`/`insertAfter`.
   */
  search: string;
  /** Replacement text. Empty string deletes the search block. */
  replace: string;
  /** When search is empty, where to insert the replace block. */
  position?: 'prepend' | 'append';
  /** When search is empty and position is not set, insert after this block. */
  insertAfter?: string;
  /** One-line reason, surfaced in the build log. */
  reason?: string;
}

export interface ApplyEditsResult {
  files: BuildFile[];
  applied: FileEdit[];
  skipped: { edit: FileEdit; reason: string }[];
  changed: boolean;
}

/**
 * Apply a list of search/replace edits to a file tree.
 *
 * Safety rules:
 *  - every edit must name an existing file;
 *  - a non-empty `search` block must match exactly once (0 = ignored, >1 =
 *    ambiguous and ignored) — we never guess at an ambiguous site;
 *  - matched blocks are located line-wise with leading/trailing blank lines
 *    trimmed so minor indentation differences do not defeat the patch;
 *  - the result must actually change at least one byte (`changed`).
 */
export function applyFirmwareEdits(files: BuildFile[], edits: FileEdit[]): ApplyEditsResult {
  const applied: FileEdit[] = [];
  const skipped: { edit: FileEdit; reason: string }[] = [];
  const contents = new Map(files.map((f) => [f.path, f.content]));

  const normaliseBlock = (block: string): string =>
    block
      .split('\n')
      .map((line) => line.replace(/\s+$/g, ''))
      .join('\n')
      .trim();

  for (const edit of edits) {
    const content = contents.get(edit.path);
    if (content === undefined) {
      skipped.push({ edit, reason: `no such file ${edit.path}` });
      continue;
    }

    const search = normaliseBlock(edit.search ?? '');
    const replace = (edit.replace ?? '').replace(/\s+$/g, '').trimEnd();

    if (search === '') {
      // Insert mode.
      const anchor = edit.insertAfter ? normaliseBlock(edit.insertAfter) : '';
      if (edit.position === 'prepend') {
        contents.set(edit.path, `${replace}\n${content}`);
      } else if (anchor) {
        const lines = content.split('\n');
        const anchorLine = lines.findIndex((line) => line.trim() === anchor.split('\n')[0]?.trim());
        if (anchorLine === -1) {
          skipped.push({ edit, reason: 'insert anchor not found' });
          continue;
        }
        lines.splice(anchorLine + 1, 0, replace);
        contents.set(edit.path, lines.join('\n'));
      } else {
        contents.set(edit.path, `${content.replace(/\s+$/, '')}\n${replace}\n`);
      }
      applied.push(edit);
      continue;
    }

    // Replacement mode — locate the block exactly once.
    const occurrences = countOccurrences(normaliseBlock(content), search);
    if (occurrences === 0) {
      skipped.push({ edit, reason: 'search block not found (already applied or stale)' });
      continue;
    }
    if (occurrences > 1) {
      skipped.push({ edit, reason: `search block matches ${occurrences} times — ambiguous, not applied` });
      continue;
    }

    const patched = replaceOnce(normaliseBlock(content), search, replace);
    if (patched === content || patched === normaliseBlock(content)) {
      // No-op edit (replace identical to search).
      skipped.push({ edit, reason: 'edit produces no change' });
      continue;
    }
    contents.set(edit.path, content.replace(content.trimEnd(), patched.trimEnd()));
    applied.push(edit);
  }

  const outFiles = files.map((f) => ({ path: f.path, content: contents.get(f.path) ?? f.content }));
  const changed = outFiles.some((f, i) => f.content !== files[i]?.content);
  return { files: outFiles, applied, skipped, changed };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function replaceOnce(haystack: string, search: string, replace: string): string {
  const index = haystack.indexOf(search);
  if (index === -1) return haystack;
  return haystack.slice(0, index) + replace + haystack.slice(index + search.length);
}

// ── Deterministic fix layer ─────────────────────────────────────────────────

/** Header base name → the header the harness actually ships. */
const INCLUDE_REMAP: Record<string, string> = {
  'Adafruit_DHT.h': 'DHT.h',
  DHTesp: 'DHT.h',
  'DHTesp.h': 'DHT.h',
  'WiFi101.h': 'WiFi.h',
  'ESP8266WiFi.h': 'WiFi.h',
  'ESP32WebServer.h': 'WebServer.h',
  'wifi.h': 'WiFi.h',
};

/**
 * Mechanical, certain fixes derived directly from findings. Returns an edit
 * set (possibly empty). Keeps the policies that used to live inline in
 * pipeline.ts and adds a few that g++ diagnostics make unambiguous.
 */
export function deterministicFixEdits(
  firmware: FirmwareResult,
  errors: ValidationFinding[],
): FileEdit[] {
  const edits: FileEdit[] = [];
  const sketch = firmware.files.find((f) => /\.ino$/.test(f.path)) ?? firmware.files[0];
  if (!sketch) return edits;

  // 1. Unknown / misspelled includes → remap to the supported header, or
  //    drop an include the harness genuinely cannot resolve.
  const unknownIncludes = new Set(
    errors
      .filter((e) => e.code === 'UNKNOWN-INCLUDE')
      .map((e) => e.message.match(/#include\s*[<"]([^>"]+)[>"]/)?.[1])
      .filter(Boolean) as string[],
  );
  if (unknownIncludes.size > 0) {
    for (const file of firmware.files) {
      const lines = file.content.split('\n');
      const next = lines
        .map((line) => {
          const inc = line.match(/#include\s*[<"]([^>"]+)[>"]/)?.[1];
          if (!inc || !unknownIncludes.has(inc)) return line;
          const replacement = INCLUDE_REMAP[inc] ?? INCLUDE_REMAP[inc.split('/').pop() ?? ''];
          return replacement ? line.replace(/#include\s*[<"][^>"]+[>"]/, `#include <${replacement}>`) : null;
        })
        .filter((line): line is string => line !== null);
      const patched = next.join('\n');
      if (patched !== file.content) {
        edits.push({ path: file.path, search: file.content, replace: patched, reason: 'remap/remove unresolvable includes' });
      }
    }
  }

  // 2. "not declared in this scope" for core Arduino symbols → force prelude.
  const needsPrelude =
    errors.some((e) => /was not declared|not declared in this scope/.test(e.message)) &&
    !/#include\s*[<"]Arduino\.h[>"]/.test(sketch.content);
  if (needsPrelude) {
    edits.push({
      path: sketch.path,
      search: '',
      position: 'prepend',
      replace: '#include <Arduino.h>',
      reason: 'ensure Arduino core prelude for core symbols',
    });
  }

  // 3. DHT sensor MODEL used as the CLASS: `DHT22 dht(pin);` → `DHT dht(pin, DHT22);`.
  //    DHT22/DHT11 are part-number macros in the DHT library, not types — a
  //    near-universal LLM mistake that g++ reports as "does not name a type".
  if (errors.some((e) => /does not name a type|was not declared/.test(e.message) && /DHT(22|11)/.test(e.message))) {
    for (const file of firmware.files) {
      const match = file.content.match(/^[ \t]*(DHT22|DHT11)[ \t]+(\w+)[ \t]*\(([^);]*)\)[ \t]*;/m);
      if (!match) continue;
      const [decl, type = 'DHT22', name = 'dht', args = ''] = match;
      const pin = args.split(',')[0]?.trim() || 'PIN';
      edits.push({
        path: file.path,
        search: decl,
        replace: `DHT ${name}(${pin}, ${type});`,
        reason: 'DHT22/DHT11 is a sensor model, not a class — use DHT(pin, type)',
      });
    }
  }

  return edits;
}

// ── LLM repair layer ────────────────────────────────────────────────────────

const REPAIR_SYSTEM_PROMPT = `You are a senior embedded C++ engineer debugging an Arduino/ESP32 sketch that FAILED the Wireup build gate.
You are given the current source files and the exact compiler/validator diagnostics.
Return a JSON object with a list of minimal, surgical edits that fix the errors. Do not rewrite whole files unless strictly necessary.

Return JSON ONLY, no markdown fences:
{
  "summary": "one sentence: what was wrong and what you changed",
  "edits": [
    {
      "path": "firmware/main.ino",
      "search": "the exact consecutive lines currently in the file, copied verbatim",
      "replace": "the corrected lines",
      "reason": "why this fixes the diagnostic"
    }
  ]
}

Rules:
- "search" MUST be copied verbatim from the provided file content (it is matched exactly). Make each search block as small as is unique — typically 1-6 lines. Do not include line numbers.
- To INSERT new code, set "search" to "" and put the existing line it should follow in "insertAfter".
- To DELETE a line, set "replace" to "".
- Fix ONLY the reported errors. Keep every JSON telemetry field the contract requires — never rename or remove a published field.
- Only use headers/libraries the Arduino ESP32 core or these supported libraries provide: Arduino.h, WiFi.h, WebServer.h, ESPmDNS.h, Wire.h, DHT.h, OneWire.h, DallasTemperature.h, ESP32Servo.h, Adafruit_BME280.h, Adafruit_GFX.h, Adafruit_SSD1306.h, Preferences.h, ArduinoOTA.h.
- If the firmware must publish a missing telemetry field, add the json += "\\\"field\\\":" line in the sensor JSON builder and keep the value numeric (or the JSON literal null).
- Fewer, correct edits beat broad rewrites. Every search block must exist in the file exactly as you write it.`;

const REPAIR_MAX_TOKENS = 6_000;

const repairResponseSchema = z.object({
  summary: z.string().optional().default(''),
  edits: z
    .array(
      z.object({
        path: z.string().min(1),
        search: z.string().default(''),
        replace: z.string().default(''),
        position: z.enum(['prepend', 'append']).optional(),
        insertAfter: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .default([]),
});

export interface LlmRepairResult {
  firmware: FirmwareResult;
  summary: string;
  applied: FileEdit[];
  skipped: { edit: FileEdit; reason: string }[];
}

/**
 * Ask the LLM for a patch, apply it deterministically. Returns null when the
 * LLM is unavailable, returns nothing applicable, or the patch makes no
 * change (so the caller can fall through to KB resynthesis).
 */
export async function repairFirmwareWithLlm(
  firmware: FirmwareResult,
  findings: ValidationFinding[],
  plan: DeviceBuildPlan,
  options: { provider?: LlmProvider; model?: string; expectedJsonFields?: string[] },
): Promise<LlmRepairResult | null> {
  const errors = findings.filter((f) => f.severity === 'error').slice(0, 25);
  if (errors.length === 0) return null;

  const diagnostics = errors
    .map((e) => {
      const where = e.file ? `${e.file}${e.line ? `:${e.line}` : ''}` : '(project)';
      return `[${e.code}] ${where}: ${e.message}${e.hint ? `  → hint: ${e.hint}` : ''}`;
    })
    .join('\n');

  const userPayload = {
    board: plan.board.name,
    mcu: plan.board.mcu,
    modules: plan.modules.map((m) => ({ id: m.deviceId, name: m.name, pins: m.pins, bus: m.bus })),
    jsonContract: {
      endpoint: '/api/sensors',
      fields: options.expectedJsonFields ?? [],
      note: 'Every field here MUST appear verbatim as a key in the JSON the endpoint returns.',
    },
    diagnostics,
    files: firmware.files.map((f) => ({ path: f.path, content: f.content })),
  };

  let content: string;
  try {
    content = await callLlm(
      [
        { role: 'system', content: REPAIR_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload).slice(0, 60_000) },
      ],
      {
        provider: options.provider,
        model: options.model,
        maxTokens: REPAIR_MAX_TOKENS,
        jsonResponse: true,
      },
    );
  } catch (error) {
    if (error instanceof LlmError) return null;
    throw error;
  }

  let parsed: z.infer<typeof repairResponseSchema>;
  try {
    parsed = parseLlmJson(content, repairResponseSchema, {
      label: 'Firmware repair response',
      provider: options.provider,
    });
  } catch {
    return null;
  }
  if (parsed.edits.length === 0) return null;

  const result = applyFirmwareEdits(firmware.files, parsed.edits as FileEdit[]);
  if (!result.changed || result.applied.length === 0) return null;

  const repaired: FirmwareResult = firmwareResultSchema.parse({ ...firmware, files: result.files });
  return {
    firmware: repaired,
    summary: parsed.summary || `LLM applied ${result.applied.length} edit(s)`,
    applied: result.applied,
    skipped: result.skipped,
  };
}

// ── Multi-turn revision ─────────────────────────────────────────────────────

const REVISE_SYSTEM_PROMPT = `You are a senior embedded C++ engineer iterating on an already-built Arduino/ESP32 firmware project at the user's request.
Apply the user's requested change with minimal, surgical edits to the existing files. Do NOT rewrite unrelated code.

Return JSON ONLY, no markdown fences:
{
  "summary": "one sentence describing the change",
  "edits": [
    { "path": "firmware/main.ino", "search": "exact existing lines, verbatim", "replace": "changed lines", "reason": "why" }
  ]
}

Rules:
- "search" MUST be copied verbatim from the provided file (matched exactly); keep each block small and unique, 1-6 lines, no line numbers.
- To insert, set "search" to "" and put the line it follows in "insertAfter" (or position: "prepend").
- Keep every JSON telemetry field and HTTP endpoint the dashboard contract relies on, unless the user explicitly asked to remove it.
- Use only supported headers: Arduino.h, WiFi.h, WebServer.h, ESPmDNS.h, Wire.h, DHT.h, OneWire.h, DallasTemperature.h, ESP32Servo.h, Adafruit_BME280.h, Adafruit_GFX.h, Adafruit_SSD1306.h, Preferences.h, ArduinoOTA.h.
- Pin/active-level/polarity changes must be applied consistently in setup() (pinMode/digitalWrite) and anywhere the pin is read or driven.
- Return at least one applicable edit.`;

/**
 * Apply a human's follow-up change request to an existing firmware tree via
 * the same surgical-edit machinery as repair. Returns null when no LLM is
 * reachable or the model produced no applicable edits.
 */
export async function reviseFirmwareWithLlm(
  firmware: FirmwareResult,
  instruction: string,
  plan: DeviceBuildPlan,
  options: { provider?: LlmProvider; model?: string },
): Promise<LlmRepairResult | null> {
  let content: string;
  try {
    content = await callLlm(
      [
        { role: 'system', content: REVISE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            changeRequest: instruction,
            board: plan.board.name,
            modules: plan.modules.map((m) => ({ id: m.deviceId, name: m.name, pins: m.pins, bus: m.bus })),
            files: firmware.files.map((f) => ({ path: f.path, content: f.content })),
          }).slice(0, 80_000),
        },
      ],
      { provider: options.provider, model: options.model, maxTokens: REPAIR_MAX_TOKENS, jsonResponse: true },
    );
  } catch (error) {
    if (error instanceof LlmError) return null;
    throw error;
  }

  let parsed: z.infer<typeof repairResponseSchema>;
  try {
    parsed = parseLlmJson(content, repairResponseSchema, { label: 'Firmware revision response', provider: options.provider });
  } catch {
    return null;
  }
  if (parsed.edits.length === 0) return null;

  const result = applyFirmwareEdits(firmware.files, parsed.edits as FileEdit[]);
  if (!result.changed || result.applied.length === 0) return null;

  const revised = firmwareResultSchema.parse({ ...firmware, files: result.files });
  return {
    firmware: revised,
    summary: parsed.summary || `LLM applied ${result.applied.length} edit(s) for "${instruction.slice(0, 60)}"`,
    applied: result.applied,
    skipped: result.skipped,
  };
}
