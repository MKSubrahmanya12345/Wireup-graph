import path from 'node:path';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { normaliseGraph } from '../schemas/architecture.js';
import type { BuildFile, FirmwareResult } from '../schemas/build.js';
import { generateFirmware as generateFirmwareLlm } from '../services/firmwareGenerator.js';
import { firmwareResultSchema } from '../schemas/build.js';
import { resolveBuildPlan, slugify } from './planResolver.js';
import { retrievalSources } from './knowledge/retriever.js';
import { synthesizeFirmware } from './firmwareSynth.js';
import { synthesizeSoftware, type SoftwareSynthResult } from './softwareSynth.js';
import { validateFirmware } from './firmwareValidator.js';
import { validateSoftware } from './softwareValidator.js';
import { createWorkDir } from './terminal.js';
import type {
  AgenticBuildResult,
  BuildEvent,
  EmitFn,
  PipelineInput,
  ValidationFinding,
  ValidationReport,
} from './types.js';

/**
 * The Wireup agentic build pipeline.
 *
 *   retrieve (RAG) → resolve plan → generate firmware → compile in terminal
 *     → repair loop → generate MERN software → build in terminal → repair loop
 *     → cross-artifact consistency → ship.
 *
 * Generation is deterministic-first (knowledge base templates). When
 * GROQ_API_KEY is configured the LLM is offered the first draft, but every
 * artifact — LLM or template — must pass the same terminal gauntlet, and any
 * LLM failure falls back to the deterministic path. Nothing ships unvalidated.
 */

const PIPELINE_VERSION = 'wireup-agentic-2.0';

function now(): string {
  return new Date().toISOString().slice(11, 19);
}

export async function runAgenticPipeline(input: PipelineInput, emit: EmitFn): Promise<void> {
  const t0 = Date.now();
  const { graph: graphParsed } = normaliseGraph(input.graph ?? {});
  const brief = input.brief.trim();
  const projectName = (input.projectName ?? graphParsed.project ?? '').trim() || 'Wireup Device';
  const slug = slugify(projectName);

  const say = (stage: string, line: string, tone: 'info' | 'ok' | 'warn' | 'error' = 'info') =>
    emit({ type: 'log', stage, line: `[${now()}] ${line}`, tone });

  const work = await createWorkDir(slug);
  let result: AgenticBuildResult | null = null;

  try {
    // ── Stage 1: retrieval ──────────────────────────────────────────────────
    emit({ type: 'stage', stage: 'retrieve', title: 'Retrieving device knowledge (RAG)' });
    say('retrieve', `pipeline ${PIPELINE_VERSION} · workdir ${work.root}`);
    say('retrieve', `brief: "${brief.slice(0, 140)}${brief.length > 140 ? '…' : ''}"`);

    const resolved = resolveBuildPlan(brief, projectName, graphParsed);
    const { plan } = resolved;

    if (plan.modules.length === 0) {
      emit({
        type: 'error',
        message:
          'No supported hardware modules were recognised in the brief or graph. The Wireup knowledge base covers: ' +
          'DHT11/DHT22, BME280, DS18B20, soil moisture, MQ-2, HC-SR04, PIR, relay, servo, LED, OLED — on ESP32.',
      });
      return;
    }

    for (const module of plan.modules) {
      say('retrieve', `⟶ ${module.name} (${module.partNumber}) · bus ${module.bus} · pins ${JSON.stringify(module.pins)}`, 'ok');
    }
    for (const source of retrievalSources(resolved.hits)) {
      say('retrieve', `source: ${source.title} — ${source.url}`);
    }
    say('retrieve', `board profile: ${plan.board.name} (${plan.board.mcu}) — matched on ${resolved.boardMatchedOn}`);
    say('retrieve', `sample cadence: ${plan.sampleIntervalMs} ms · web dashboard: ${plan.webServer ? 'yes' : 'no'} · wifi creds in brief: ${plan.wifi.configured ? 'yes' : 'no'}`);
    for (const warning of resolved.warnings) say('retrieve', warning, 'warn');

    // ── Stage 2: firmware (generate → compile → repair) ─────────────────────
    emit({ type: 'stage', stage: 'firmware', title: 'Generating firmware' });

    const llmAvailable = Boolean(env.GROQ_API_KEY);
    let firmware: FirmwareResult = synthesizeFirmware(plan);
    let firmwareSource: 'deterministic' | 'llm-assisted' = 'deterministic';

    if (llmAvailable) {
      try {
        say('firmware', 'GROQ_API_KEY present — asking the LLM for a first draft (it still has to survive the compiler).');
        const draft = await generateFirmwareLlm(brief, projectName, graphParsed);
        firmware = firmwareResultSchema.parse(draft);
        firmwareSource = 'llm-assisted';
        say('firmware', `LLM draft: ${firmware.files.length} file(s) for ${firmware.board}`);
      } catch (error) {
        say('firmware', `LLM draft unavailable (${error instanceof Error ? error.message : String(error)}) — using the knowledge-base synthesiser.`, 'warn');
        firmwareSource = 'deterministic';
      }
    } else {
      say('firmware', 'No LLM key configured — knowledge-base synthesis engine drives (this is the primary path, not a fallback).');
    }

    let firmwareReport: ValidationReport | null = null;
    let firmwareIterations = 0;

    for (let attempt = 1; attempt <= env.AGENTIC_MAX_REPAIR_LOOPS; attempt++) {
      firmwareIterations = attempt;
      emit({ type: 'stage', stage: 'firmware-validate', title: `Compiling firmware (attempt ${attempt})` });
      firmwareReport = await validateFirmware(firmware.files, {
        workDir: path.join(work.root, 'firmware'),
        boardDefine: plan.board.archDefine,
      });
      reportToEvents('firmware-validate', firmwareReport, emit);

      if (firmwareReport.ok) {
        say('firmware-validate', `firmware compiles clean — ${firmware.files.length} files, attempt ${attempt}`, 'ok');
        break;
      }

      const errors = firmwareReport.findings.filter((f) => f.severity === 'error');
      say('firmware-validate', `${errors.length} error(s): ${errors.map((e) => e.code).join(', ')}`, 'error');

      if (attempt === env.AGENTIC_MAX_REPAIR_LOOPS) break;

      // Repair policy: deterministic fix-ups first; if the draft came from the
      // LLM and cannot be fixed structurally, swap in the KB synthesiser.
      const repaired = repairFirmware(firmware, errors, plan);
      if (repaired) {
        say('firmware-repair', 'repair pass applied: unknown includes stripped / entrypoint normalised');
        firmware = repaired;
      } else if (firmwareSource === 'llm-assisted') {
        say('firmware-repair', 'LLM draft is unrepairable — replacing with knowledge-base synthesis', 'warn');
        firmware = synthesizeFirmware(plan);
        firmwareSource = 'deterministic';
      } else {
        say('firmware-repair', 'deterministic engine produced an invalid artifact — stopping with diagnostics', 'error');
        break;
      }
    }

    if (!firmwareReport?.ok) {
      emit({ type: 'error', message: `Firmware did not pass validation after ${firmwareIterations} attempt(s). See the log for compiler output.` });
      return;
    }

    emit({
      type: 'artifact',
      stage: 'firmware',
      summary: `${firmware.board} · ${firmware.files.map((f) => f.path).join(', ')}`,
      files: firmware.files.map((f) => f.path),
    });

    // ── Stage 3: software (generate → build → repair) ───────────────────────
    emit({ type: 'stage', stage: 'software', title: 'Assembling MERN dashboard software' });

    let software: SoftwareSynthResult = await synthesizeSoftware(plan);
    say('software', `merged ${software.files.length} files (scaffold + device wiring)`);
    say('software', `metrics: ${plan.modules.flatMap((m) => m.metrics.map((x) => x.id)).join(', ') || 'none'}; controls: ${plan.modules.flatMap((m) => m.controls.map((x) => x.id)).join(', ') || 'none'}`);

    const firmwareJsonFields = collectFirmwareJsonFields(firmware);
    say('software', `firmware publishes JSON fields: ${firmwareJsonFields.join(', ') || '(none detected)'}`);

    let softwareReport: ValidationReport | null = null;
    let softwareIterations = 0;

    for (let attempt = 1; attempt <= env.AGENTIC_MAX_REPAIR_LOOPS; attempt++) {
      softwareIterations = attempt;
      emit({ type: 'stage', stage: 'software-validate', title: `Building MERN project (attempt ${attempt})` });
      softwareReport = await validateSoftware(software.files, {
        workDir: path.join(work.root, 'software'),
        devicePort: 80,
        firmwareJsonFields,
      });
      reportToEvents('software-validate', softwareReport, emit);

      if (softwareReport.ok) {
        say('software-validate', `MERN project builds clean — attempt ${attempt}`, 'ok');
        break;
      }

      const errors = softwareReport.findings.filter((f) => f.severity === 'error');
      say('software-validate', `${errors.length} error(s): ${[...new Set(errors.map((e) => e.code))].join(', ')}`, 'error');
      if (attempt === env.AGENTIC_MAX_REPAIR_LOOPS) break;

      const repaired = await repairSoftware(software, errors, plan, firmwareJsonFields);
      if (repaired) {
        software = repaired;
        say('software-repair', 'regenerated device wiring from the knowledge base and re-validating');
      } else {
        say('software-repair', 'no repair strategy available — stopping with diagnostics', 'error');
        break;
      }
    }

    if (!softwareReport?.ok) {
      emit({ type: 'error', message: `Software did not pass validation after ${softwareIterations} attempt(s). See the log for the build output.` });
      return;
    }

    emit({
      type: 'artifact',
      stage: 'software',
      summary: `MERN dashboard · ${software.files.length} files`,
      files: software.files.map((f) => f.path),
    });

    // ── Stage 4: cross-artifact consistency ─────────────────────────────────
    emit({ type: 'stage', stage: 'consistency', title: 'Cross-checking firmware ⇄ software contract' });
    const consistency = crossConsistency(firmware, software, firmwareJsonFields);
    reportToEvents('consistency', consistency, emit);
    if (!consistency.ok) {
      emit({ type: 'error', message: 'Firmware and software disagree on their API contract. See findings in the log.' });
      return;
    }

    // ── Done ────────────────────────────────────────────────────────────────
    result = {
      projectName,
      slug,
      engine: firmwareSource,
      iterations: { firmware: firmwareIterations, software: softwareIterations },
      firmware,
      websiteRequirements: software.requirements,
      software: {
        projectName: `${slug}-dashboard`,
        files: software.files,
        readme: software.readme,
        envExampleLines: software.envExampleLines,
      },
      validation: {
        firmware: firmwareReport,
        software: softwareReport,
        consistency,
      },
    };

    say('done', `pipeline complete in ${((Date.now() - t0) / 1000).toFixed(1)} s — firmware ⇢ ${firmwareIterations} iteration(s), software ⇢ ${softwareIterations} iteration(s)`, 'ok');
    emit({ type: 'result', result });
  } catch (error) {
    logger.error({ err: error }, 'agentic pipeline crashed');
    emit({ type: 'error', message: error instanceof Error ? error.message : 'Agentic build crashed.' });
  } finally {
    await work.cleanup();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function reportToEvents(stage: string, report: ValidationReport, emit: EmitFn): void {
  emit({ type: 'validation', stage, report });
  for (const command of report.commands) {
    emit({ type: 'command', stage, cmd: command.cmd });
    emit({ type: 'command_result', stage, cmd: command.cmd, exitCode: command.exitCode, output: command.output, durationMs: command.durationMs });
  }
  for (const check of report.checks) {
    emit({ type: 'log', stage, line: `  ${check.ok ? '✔' : '✘'} ${check.name} — ${check.detail}`, tone: check.ok ? 'ok' : 'error' });
  }
  for (const finding of report.findings.slice(0, 20)) {
    emit({
      type: 'log',
      stage,
      line: `    [${finding.severity}] ${finding.code}${finding.file ? ` ${finding.file}${finding.line ? `:${finding.line}` : ''}` : ''} — ${finding.message}`,
      tone: finding.severity === 'error' ? 'error' : finding.severity === 'warning' ? 'warn' : 'info',
    });
  }
}

/** JSON fields the firmware publishes — extracted from sensor JSON emission lines. */
function collectFirmwareJsonFields(firmware: FirmwareResult): string[] {
  const fields = new Set<string>();
  for (const file of firmware.files) {
    for (const match of file.content.matchAll(/\\"([a-z_]+)\\"\s*:/g)) {
      fields.add(match[1] ?? '');
    }
  }
  // Control state variables also serialise as "<id>" or "<field>" keys.
  return [...fields].filter((f) => !['error', 'not found'].includes(f));
}

/** Deterministic fix-ups for LLM-drafted firmware. */
function repairFirmware(
  firmware: FirmwareResult,
  errors: ValidationFinding[],
  plan: import('./types.js').DeviceBuildPlan,
): FirmwareResult | null {
  const unknownIncludes = new Set(
    errors.filter((e) => e.code === 'UNKNOWN-INCLUDE').map((e) => e.message.match(/#include <([^>]+)>/)?.[1]).filter(Boolean) as string[],
  );
  const missingEntrypoint = errors.some((e) => e.code === 'NO-ENTRYPOINT' || e.code === 'NO-SETUP-LOOP');

  if (missingEntrypoint) return null; // structural — switch generator

  if (unknownIncludes.size > 0) {
    // Known near-miss header spellings → the libraries the harness supports.
    const remap = new Map<string, string>([
      ['Adafruit_DHT.h', 'DHT.h'],
      ['DHTesp.h', 'DHT.h'],
      ['WiFi101.h', 'WiFi.h'],
      ['ESP8266WiFi.h', 'WiFi.h'],
      ['ESP32WebServer.h', 'WebServer.h'],
    ]);
    const files: BuildFile[] = firmware.files.map((file) => ({
      ...file,
      content: file.content
        .split('\n')
        .map((line) => {
          const inc = line.match(/#include\s*[<"]([^>"]+)[>"]/)?.[1];
          if (!inc) return line;
          if (unknownIncludes.has(inc)) {
            const replacement = remap.get(inc) ?? remap.get(inc.split('/').pop() ?? '');
            return replacement ? `#include <${replacement}>` : null; // unknown lib → drop the include
          }
          return line;
        })
        .filter((line): line is string => line !== null)
        .join('\n'),
    }));
    return { ...firmware, files };
  }

  // "not declared in this scope" for standard Arduino symbols → the sketch is
  // salvageable by forcing the Arduino prelude.
  if (errors.some((e) => /was not declared|not declared in this scope/.test(e.message))) {
    const files: BuildFile[] = firmware.files.map((file) =>
      /\.ino$/.test(file.path) && !/#include\s*[<"]Arduino\.h[>"]/.test(file.content)
        ? { ...file, content: `#include <Arduino.h>\n${file.content}` }
        : file,
    );
    return { ...firmware, files };
  }

  return null;
}

/** Deterministic repair for software trees: regenerate the AI-owned files. */
async function repairSoftware(
  software: SoftwareSynthResult,
  errors: ValidationFinding[],
  plan: import('./types.js').DeviceBuildPlan,
  firmwareJsonFields: string[],
): Promise<SoftwareSynthResult | null> {
  // If any finding touches the two generated files (or the consistency
  // findings), regenerate those files from the KB; scaffold errors are fatal.
  const scaffoldBroken = errors.some(
    (e) =>
      e.file &&
      !['frontend/src/lib/deviceSpec.ts', 'backend/src/config/deviceEndpoints.ts', 'backend/.env', 'backend/.env.example', 'README.md'].includes(e.file),
  );
  if (scaffoldBroken) return null;

  const fresh = await synthesizeSoftware(plan);
  void firmwareJsonFields;
  return fresh;
}

/** Final contract check between the two zips. */
function crossConsistency(
  firmware: FirmwareResult,
  software: SoftwareSynthResult,
  jsonFields: string[],
): ValidationReport {
  const checks: ValidationReport['checks'] = [];
  const findings: ValidationFinding[] = [];
  const byPath = new Map(software.files.map((f) => [f.path, f.content]));

  const spec = byPath.get('frontend/src/lib/deviceSpec.ts') ?? '';
  const endpoints = byPath.get('backend/src/config/deviceEndpoints.ts') ?? '';
  const firmwareSource = firmware.files.map((f) => f.content).join('\n');

  // 1. Every metric path is emitted by the firmware.
  for (const match of spec.matchAll(/path:\s*'[a-z_]+\.([a-z_0-9]+)'/g)) {
    const field = match[1] ?? '';
    const published = jsonFields.includes(field) || firmwareSource.includes(`\\"${field}\\"`);
    checks.push({
      name: `field ${field}`,
      ok: published,
      detail: published ? `firmware publishes ${field}; dashboard reads it` : `${field} is read by the dashboard but never emitted by firmware`,
    });
    if (!published) findings.push({ severity: 'error', code: 'CONTRACT-FIELD', message: field });
  }

  // 2. Every endpoint path exists as a route in the firmware.
  for (const match of endpoints.matchAll(/path:\s*'(\/api\/[^']+)'/g)) {
    const route = match[1] ?? '';
    const implemented = firmwareSource.includes(`"${route}"`);
    checks.push({
      name: `route ${route}`,
      ok: implemented,
      detail: implemented ? 'firmware serves this route' : 'software calls a route the firmware never registers',
    });
    if (!implemented) findings.push({ severity: 'error', code: 'CONTRACT-ROUTE', message: route });
  }

  // 3. Device name alignment.
  const nameMatch = spec.match(/name:\s*'([^']+)'/)?.[1] ?? '';
  checks.push({
    name: 'identity',
    ok: Boolean(nameMatch),
    detail: nameMatch ? `dashboard identity: ${nameMatch}` : 'dashboard device name missing',
  });

  return {
    target: 'consistency',
    ok: !findings.some((f) => f.severity === 'error'),
    checks,
    findings,
    commands: [],
    durationMs: 0,
  };
}
