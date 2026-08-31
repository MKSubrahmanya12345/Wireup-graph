import path from 'node:path';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { normaliseGraph } from '../schemas/architecture.js';
import type { BuildFile, FirmwareResult } from '../schemas/build.js';
import { generateFirmware as generateFirmwareLlm } from '../services/firmwareGenerator.js';
import { firmwareResultSchema } from '../schemas/build.js';
import { isLlmAvailable } from '../services/llmService.js';
import { resolveBuildPlan, slugify } from './planResolver.js';
import { retrievalSources } from './knowledge/retriever.js';
import { synthesizeFirmware } from './firmwareSynth.js';
import { synthesizeSoftware, type SoftwareSynthResult } from './softwareSynth.js';
import { extractPublishedJsonFields, mapMetricFieldsToFirmware } from './jsonContract.js';
import { validateFirmware } from './firmwareValidator.js';
import { validateSoftware } from './softwareValidator.js';
import {
  applyFirmwareEdits,
  deterministicFixEdits,
  repairFirmwareWithLlm,
  reviseFirmwareWithLlm,
} from './repairAgent.js';
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

    const resolved = resolveBuildPlan(brief, projectName, graphParsed, input.sampleIntervalMs);
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

    const llmAvailable = isLlmAvailable(input.provider);
    let firmware: FirmwareResult = synthesizeFirmware(plan);
    let firmwareSource: 'deterministic' | 'llm-assisted' = 'deterministic';

    // The JSON contract the dashboard is generated against: one field per KB
    // metric plus the status badge key. The firmware MUST publish these exact
    // names — enforced at the firmware gate and re-checked downstream.
    const expectedJsonFields = [
      ...new Set(plan.modules.flatMap((m) => m.metrics.map((metric) => metric.jsonField))),
      'state',
    ];

    if (llmAvailable) {
      try {
        say('firmware', `${input.provider ?? env.LLM_PROVIDER} available — asking the LLM for a first draft (it still has to survive the compiler).`);
        const draft = await generateFirmwareLlm(brief, projectName, graphParsed, {
          provider: input.provider,
          model: input.model,
          jsonContract: { endpoint: '/api/sensors', fields: expectedJsonFields },
        });
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

    // ── Multi-turn revision: apply a human follow-up request before gating ──
    const revision = input.revisionInstruction?.trim();
    if (revision) {
      emit({ type: 'stage', stage: 'firmware-revise', title: 'Applying requested change' });
      if (!isLlmAvailable(input.provider)) {
        say('firmware-revise', `Cannot apply change ("${revision.slice(0, 80)}") without an LLM key — building the unmodified plan instead.`, 'warn');
      } else {
        const revised = await reviseFirmwareWithLlm(firmware, revision, plan, {
          provider: input.provider,
          model: input.model,
        });
        if (revised) {
          firmware = revised.firmware;
          firmwareSource = 'llm-assisted';
          say('firmware-revise', `change applied: ${revised.summary} (${revised.applied.length} edit(s)${revised.skipped.length ? `, ${revised.skipped.length} rejected` : ''})`, 'ok');
        } else {
          say('firmware-revise', 'the model returned no applicable edits for that change — validating the unmodified firmware instead.', 'warn');
        }
      }
    }

    let firmwareReport: ValidationReport | null = null;
    let firmwareIterations = 0;
    let previousFirmwareFingerprint = '';

    for (let attempt = 1; attempt <= env.AGENTIC_MAX_REPAIR_LOOPS; attempt++) {
      firmwareIterations = attempt;
      emit({ type: 'stage', stage: 'firmware-validate', title: `Compiling firmware (attempt ${attempt})` });
      firmwareReport = await validateFirmware(firmware.files, {
        workDir: path.join(work.root, 'firmware'),
        boardDefine: plan.board.archDefine,
        expectedJsonFields,
      });
      reportToEvents('firmware-validate', firmwareReport, emit);

      if (firmwareReport.ok) {
        const compilerSkipped = firmwareReport.findings.some((f) => f.code === 'GPP-MISSING');
        say(
          'firmware-validate',
          compilerSkipped
            ? `firmware passes the structural + contract gate (${firmware.files.length} files, attempt ${attempt}) — g++ unavailable, real compile skipped`
            : `firmware compiles clean — ${firmware.files.length} files, attempt ${attempt}`,
          'ok',
        );
        break;
      }

      const errors = firmwareReport.findings.filter((f) => f.severity === 'error');
      say('firmware-validate', `${errors.length} error(s): ${[...new Set(errors.map((e) => e.code))].join(', ')}`, 'error');

      if (attempt === env.AGENTIC_MAX_REPAIR_LOOPS) break;

      // ── Repair, diagnostics-first ─────────────────────────────────────────
      // Layer 1: mechanical fix-ups derived from the findings (include remap,
      // missing prelude, DHT-class spelling). Layer 2: when an LLM is
      // configured, hand it the failing sources AND the exact compiler output
      // and apply the surgical edits it returns. Layer 3 (last resort): an
      // LLM draft that cannot be patched is replaced by the KB synthesiser,
      // whose published fields are the contract by construction.
      const structural = errors.some((e) => e.code === 'NO-ENTRYPOINT' || e.code === 'NO-SETUP-LOOP');
      let next: FirmwareResult | null = null;
      let repairNote = '';

      if (!structural) {
        const autoEdits = deterministicFixEdits(firmware, errors);
        if (autoEdits.length > 0) {
          const applied = applyFirmwareEdits(firmware.files, autoEdits);
          if (applied.changed) {
            next = firmwareResultSchema.parse({ ...firmware, files: applied.files });
            repairNote = `mechanical fix-ups: ${applied.applied.map((e) => e.reason).filter(Boolean).join('; ')}`;
          }
        }

        // Layer 2: the model reads the real diagnostics and edits the code.
        if (!next && isLlmAvailable(input.provider)) {
          const llmRepair = await repairFirmwareWithLlm(firmware, firmwareReport.findings, plan, {
            provider: input.provider,
            model: input.model,
            expectedJsonFields,
          });
          if (llmRepair) {
            next = llmRepair.firmware;
            firmwareSource = 'llm-assisted';
            repairNote = `LLM patch from diagnostics — ${llmRepair.summary} (${llmRepair.applied.length} edit(s) applied${llmRepair.skipped.length ? `, ${llmRepair.skipped.length} rejected` : ''})`;
          }
        }
      }

      if (next) {
        const fingerprint = firmwareFingerprint(next);
        if (fingerprint === previousFirmwareFingerprint) {
          say('firmware-repair', 'repair produced no change to the source — the loop cannot make progress; falling through', 'warn');
          next = null;
        } else {
          previousFirmwareFingerprint = fingerprint;
        }
      }

      if (next) {
        say('firmware-repair', repairNote, 'ok');
        firmware = next;
      } else if (firmwareSource === 'llm-assisted') {
        const reason = errors.some((e) => e.code === 'FW-CONTRACT-FIELD')
          ? 'LLM draft does not publish the JSON fields the dashboard contract requires — replacing with knowledge-base synthesis'
          : 'LLM draft is unrepairable by diagnostics — replacing with knowledge-base synthesis';
        say('firmware-repair', reason, 'warn');
        firmware = synthesizeFirmware(plan);
        firmwareSource = 'deterministic';
        previousFirmwareFingerprint = '';
      } else {
        say('firmware-repair', 'no repair strategy could change the artifact — stopping with diagnostics', 'error');
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

    let firmwareJsonFields = collectFirmwareJsonFields(firmware);
    say('software', `firmware publishes JSON fields: ${firmwareJsonFields.join(', ') || '(none detected)'}`);

    let softwareReport: ValidationReport | null = null;
    let softwareIterations = 0;
    let previousSoftwareFingerprint = '';

    for (let attempt = 1; attempt <= env.AGENTIC_MAX_REPAIR_LOOPS; attempt++) {
      softwareIterations = attempt;
      emit({ type: 'stage', stage: 'software-validate', title: `Building MERN project (attempt ${attempt})` });
      softwareReport = await validateSoftware(software.files, {
        workDir: path.join(work.root, 'software'),
        devicePort: 80,
        firmwareJsonFields,
        metrics: plan.modules.flatMap((m) => m.metrics),
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

      if (repaired === 'swap-firmware') {
        // The dashboard contract can only be satisfied by the KB firmware.
        // Swap it in (deterministic fields are the contract by construction)
        // and regenerate the wiring against it.
        say('software-repair', `firmware does not publish the fields the dashboard needs (${errors.filter((e) => e.code === 'FIELD-NOT-PUBLISHED').length} mismatch) — replacing the LLM draft with knowledge-base firmware so the pair agrees`, 'warn');
        firmware = synthesizeFirmware(plan);
        firmwareSource = 'deterministic';
        firmwareJsonFields = collectFirmwareJsonFields(firmware);
        say('software-repair', `replacement firmware publishes JSON fields: ${firmwareJsonFields.join(', ')}`);
        software = await synthesizeSoftware(plan);
      } else if (repaired) {
        software = repaired;
        say('software-repair', 'device wiring regenerated against the firmware that actually exists — re-validating');
      } else {
        say('software-repair', 'no repair strategy available — stopping with diagnostics', 'error');
        break;
      }

      // Progress guard: if this iteration produced byte-identical wiring to the
      // last failed one, more loops cannot help — report and stop instead of
      // freezing on the same errors.
      const fingerprint = softwareFingerprint(software);
      if (fingerprint === previousSoftwareFingerprint) {
        say('software-repair', 'repair produced no change — the loop cannot make progress; stopping with diagnostics', 'error');
        break;
      }
      previousSoftwareFingerprint = fingerprint;
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
  // Shared extractor with firmwareValidator/softwareValidator — one source of
  // truth for what the firmware publishes, in every spelling real code uses.
  return extractPublishedJsonFields(firmware.files.map((f) => f.content));
}

/** Byte-level identity of firmware source — the repair loop's progress guard. */
function firmwareFingerprint(firmware: FirmwareResult): string {
  return firmware.files
    .filter((f) => /\.(ino|cpp|h|hpp)$/.test(f.path))
    .map((f) => `${f.path}:${f.content}`)
    .join('\n');
}

/**
 * Deterministic repair for software trees.
 *
 * Strategies, in order:
 *  1. FIELD-NOT-PUBLISHED / CONTRACT-FIELD — point every metric path at a
 *     field the firmware actually publishes (returns fresh wiring).
 *  2. Firmware publishes nothing that satisfies the contract — return
 *     'swap-firmware' so the caller replaces an LLM draft with the KB
 *     synthesiser (whose fields are the contract by construction).
 *  3. Anything else touching only the generated files — regenerate from KB.
 *  4. Scaffold errors are fatal — return null (no strategy).
 */
async function repairSoftware(
  software: SoftwareSynthResult,
  errors: ValidationFinding[],
  plan: import('./types.js').DeviceBuildPlan,
  firmwareJsonFields: string[],
): Promise<SoftwareSynthResult | 'swap-firmware' | null> {
  const scaffoldBroken = errors.some(
    (e) =>
      e.file &&
      !['frontend/src/lib/deviceSpec.ts', 'backend/src/config/deviceEndpoints.ts', 'backend/.env', 'backend/.env.example', 'README.md'].includes(e.file),
  );
  if (scaffoldBroken) return null;

  const fieldErrors = errors.filter(
    (e) => e.code === 'FIELD-NOT-PUBLISHED' || e.code === 'CONTRACT-FIELD',
  );
  if (fieldErrors.length > 0) {
    const { overrides, unmapped } = mapMetricFieldsToFirmware(plan, firmwareJsonFields);
    if (unmapped.length === 0) {
      // Every KB metric can read a field the firmware publishes.
      return synthesizeSoftware(plan, overrides);
    }
    // The firmware can never satisfy the contract → swap it for the KB synth.
    return 'swap-firmware';
  }

  return synthesizeSoftware(plan);
}

/** Byte-level identity of the generated wiring — the loop's progress guard. */
function softwareFingerprint(software: SoftwareSynthResult): string {
  return software.files
    .filter((f) => f.path === 'frontend/src/lib/deviceSpec.ts' || f.path === 'backend/src/config/deviceEndpoints.ts' || f.path === 'backend/.env.example')
    .map((f) => `${f.path}:${f.content}`)
    .join('\\n');
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
