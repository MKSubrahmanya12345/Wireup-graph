/**
 * Firmware ⇄ software JSON contract — one shared implementation.
 *
 * The generated firmware publishes a flat JSON object on /api/sensors and the
 * MERN dashboard reads it through dotted paths (`<endpointId>.<field>`, e.g.
 * `temperature.temperature_c`). Both sides must agree on the FIELD names or
 * the dashboard renders "undefined" forever — the exact failure mode the
 * repair loop exists to prevent.
 *
 * This module is the single source of truth for:
 *   1. extracting the JSON keys a firmware tree actually publishes, and
 *   2. mapping knowledge-base metric fields onto whatever the firmware emits.
 *
 * Both the firmware validator (gate: does the sketch publish the fields the
 * plan promises?) and the software validator (gate: does the dashboard read
 * fields the firmware publishes?) call into here, so they can never drift
 * apart again.
 */

import type { DeviceBuildPlan } from './types.js';

/**
 * JSON keys a firmware tree publishes, found by scanning the source for
 * string-literal keys. Handles both spellings real code uses:
 *
 *   json += "\"temperature_c\":" + ...          (escaped inside a C++ literal)
 *   json += "\"humidity_pct\":" + ...
 *   String(F("{\"error\":\"not found\"}"))       (escaped, filtered below)
 *   json["temperature_c"] = ...                  (rare, but valid)
 *
 * The raw `"key":` form is also scanned so LLM drafts that build JSON with
 * plain literals (or emit a Python/MicroPython variant) still count.
 */
export function extractPublishedJsonFields(sources: string[]): string[] {
  const fields = new Set<string>();

  for (const source of sources) {
    // Escaped key form: \"field\":
    for (const match of source.matchAll(/\\"([a-zA-Z_][a-zA-Z0-9_]*)\\"\s*:/g)) {
      fields.add(match[1] ?? '');
    }
    // Raw key form: "field":
    for (const match of source.matchAll(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g)) {
      fields.add(match[1] ?? '');
    }
    // Bracket form: json["field"] = ... (LLM drafts do this).
    for (const match of source.matchAll(/\[\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*\]/g)) {
      fields.add(match[1] ?? '');
    }
  }

  // These are error-payload keys, not telemetry fields.
  const noise = new Set(['error', 'not found', 'missing state', 'missing angle', 'status']);
  return [...fields].filter((field) => field && !noise.has(field)).sort();
}

/**
 * Which published firmware field should each knowledge-base metric read?
 *
 * Returns `overrides` (metric id → published field) plus `unmapped` (metric
 * ids with no plausible match). A metric whose kb field is already published
 * gets no override entry — the deterministic path stays untouched.
 */
export function mapMetricFieldsToFirmware(
  plan: DeviceBuildPlan,
  publishedFields: string[],
): { overrides: Record<string, string>; unmapped: string[] } {
  const overrides: Record<string, string> = {};
  const unmapped: string[] = [];

  for (const module of plan.modules) {
    for (const metric of module.metrics) {
      if (publishedFields.includes(metric.jsonField)) continue;

      const match =
        publishedFields.find((field) => field === metric.id) ??
        publishedFields.find((field) => field.replace(/[^a-z0-9]/gi, '') === metric.id.replace(/[^a-z0-9]/gi, '')) ??
        publishedFields.find((field) => field.includes(metric.id) && metric.id.length >= 3) ??
        publishedFields.find((field) => metric.id.includes(field) && field.length >= 3);

      if (match) overrides[metric.id] = match;
      else unmapped.push(metric.id);
    }
  }

  return { overrides, unmapped };
}
