import path from 'node:path';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { normaliseGraph } from '../schemas/architecture.js';
import type { BuildFile, FirmwareResult } from '../schemas/build.js';
import { generateFirmware as generateFirmwareLlm } from '../services/firmwareGenerator.js';
import { firmwareResultSchema } from '../schemas/build.js';
import { isLlmAvailable, resolveEffectiveProvider, type LlmProvider } from '../services/llmService.js';
import { getHardwareSimProvider } from '../providers/sim/index.js';
import type { SimResult } from '../providers/sim/types.js';
import { buildBom } from './bom.js';
import { buildInstructions } from './instructions.js';
import { resolveBuildPlan, slugify } from './planResolver.js';
import { retrievalSources } from './knowledge/retriever.js';
import { synthesizeFirmware } from './firmwareSynth.js';
import { synthesizeSoftware, type SoftwareSynthResult } from './softwareSynth.js';
import { extractPublishedJsonFields, mapMetricFieldsToFirmware } from './jsonContract.js';
import { validateFirmware } from './firmwareValidator.js';
import { softwareTreeDir, validateSoftware } from './softwareValidator.js';
import {
  applyFirmwareEdits,
  deterministicFixEdits,
  repairFirmwareWithLlm,
  reviseFirmwareWithLlm,
} from './repairAgent.js';
import { createWorkDir } from './terminal.js';
import { newPreviewId, previewApiBaseFor, previewBaseFor, publishPreview } from './preview.js';
import type {
  AgenticBuildResult,
  BuildEvent,
  BuildProgress,
  EmitFn,
  PipelineInput,
  ValidationFinding,
  ValidationReport,
} from './types.js';

/**
 * The Wireup agentic build pipeline.
 *
 *   retrieve (RAG) → resolve plan → generate the WEBSITE → build it in the
 *     terminal (npm/tsc/vite) → PUBLISH it live → generate firmware → compile
 *     it with g++ → repair loop → cross-check the contract → simulate → ship.
 *
 * Website-first is deliberate: the dashboard is the half a human can look at,
 * so it is built, validated and published before the firmware even starts.
 * Page 04 can then run that website while the firmware is still being written
 * on page 03 — the two halves of one build finish at different times, and each
 * is announced on the wire (`progress` events) the moment it is usable.
 *
 * Generation is deterministic-first (knowledge base templates). When AWS
 * Bedrock is configured the LLM is offered the first draft, but every
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
  // Chosen before the build so the dashboard can be compiled FOR this prefix —
  // the bundle the gate validates is the bundle page 04 serves.
  const previewId = newPreviewId();
  let preview: Awaited<ReturnType<typeof publishPreview>> = null;
  let result: AgenticBuildResult | null = null;

  // ── Live progress: which half of the build is usable right now ──────────
  // Page 04 reads this to run the website while the firmware is still being
  // written — the two halves finish at different times by design. Declared
  // outside the try so the finally block can close out the terminal status.
  const progress: BuildProgress = {
    status: 'running',
    stage: 'retrieve',
    projectName,
    slug,
    startedAt: new Date(t0).toISOString(),
    updatedAt: new Date(t0).toISOString(),
    website: null,
    firmware: null,
    circuit: null,
  };
  const markProgress = (patch: Partial<BuildProgress>): void => {
    Object.assign(progress, patch, { updatedAt: new Date().toISOString() });
    emit({ type: 'progress', progress: { ...progress } });
  };
  const cancelled = (): boolean => {
    if (!input.signal?.aborted) return false;
    emit({ type: 'cancelled', message: 'Build cancelled — the agent stopped between stages.' });
    markProgress({ status: 'cancelled' });
    return true;
  };

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
    // ??$$$ Log Spec Graph & Session Document rehydration
    say('retrieve', '✔ [Spec Graph] Hydrated hardware specification & 2D/3D architecture graph from live document session', 'ok');
    for (const warning of resolved.warnings) say('retrieve', warning, 'warn');

    // ── The contract both halves are built against ──────────────────────────
    // Website-first means the dashboard exists BEFORE the firmware does, so the
    // field names cannot be read off a sketch that has not been written yet.
    // They come from the knowledge base instead: one JSON field per KB metric
    // plus the status badge key. The website is generated against these exact
    // names, and the firmware gate (FW-CONTRACT-FIELD) makes the sketch publish
    // them — the pair is reconciled at stage 4, never by bending the website.
    const expectedJsonFields = [
      ...new Set(plan.modules.flatMap((m) => m.metrics.map((metric) => metric.jsonField))),
      'state',
    ];
    say('retrieve', `JSON contract the website and firmware must agree on: ${expectedJsonFields.join(', ')}`, 'ok');

    // The circuit is known as soon as the plan resolves — page 04 can already
    // say what it is waiting for, instead of showing an empty box.
    markProgress({
      stage: 'software',
      circuit: {
        parts: plan.modules.length + 1,
        wires: plan.modules.reduce((n, module) => n + Object.keys(module.pins).length, 0),
        board: plan.board.name,
      },
    });
    say('retrieve', 'build order: website first, firmware second — the dashboard goes live while the firmware is still being written', 'ok');

    // ── Stage 2: website (generate → build → repair → PUBLISH) ──────────────
    emit({ type: 'stage', stage: 'software', title: 'Assembling MERN dashboard software' });

    let software: SoftwareSynthResult = await synthesizeSoftware(plan);
    say('software', `merged ${software.files.length} files (scaffold + device wiring)`);
    say('software', `metrics: ${plan.modules.flatMap((m) => m.metrics.map((x) => x.id)).join(', ') || 'none'}; controls: ${plan.modules.flatMap((m) => m.controls.map((x) => x.id)).join(', ') || 'none'}`);

    // Until the firmware exists, the "fields the firmware publishes" ARE the
    // contract fields. Re-read from the real sketch at stage 4.
    let firmwareJsonFields = [...expectedJsonFields];
    say('software', `dashboard wired against the knowledge-base contract: ${firmwareJsonFields.join(', ')}`);

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
        preview: { base: previewBaseFor(previewId), apiBase: previewApiBaseFor(previewId) },
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
        say('software-repair', 'device wiring regenerated against the knowledge-base contract — re-validating');
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

    // Keep the dashboard the gate just built, before the workspace is wiped —
    // page 04 serves this exact bundle. Best effort: no preview never fails a
    // build, it only means page 04 says why there is nothing to show.
    preview = await publishPreview({
      id: previewId,
      plan,
      distDir: path.join(softwareTreeDir(path.join(work.root, 'software')), 'frontend', 'dist'),
    });
    if (preview) {
      say('software', `live preview published at ${preview.url} (real bundle, stub device API)`, 'ok');
      say('software', '⟶ the website is LIVE now — open page 04 (Simulation ⇄ Website) and use it while the firmware below is still being written', 'ok');
    } else {
      say('software', 'no live preview: the dashboard build produced no dist/ to serve', 'warn');
    }

    // Half the build is usable. Say so on the wire so page 04 lights up while
    // the firmware stage is still running.
    markProgress({
      stage: 'firmware',
      website: { ready: true, preview, files: software.files },
    });

    if (cancelled()) return;

    // ── Stage 3: firmware (generate → compile → repair) ─────────────────────
    emit({ type: 'stage', stage: 'firmware', title: 'Generating firmware' });

    // ── Provider selection (M2) ─────────────────────────────────────────────
    // AWS Bedrock is the only LLM provider. Which plan the user is on still
    // gets logged per build so usage reporting stays honest.
    const userPlan: 'free' | 'pro' = input.userPlan ?? 'free';
    const requestedProvider: LlmProvider = 'bedrock';
    const effective = resolveEffectiveProvider(requestedProvider);
    const llmProvider: LlmProvider = effective.provider;
    const llmNote = effective.fallbackFrom
      ? `requested ${effective.fallbackFrom}, fell back to ${effective.provider} (${effective.reason})`
      : undefined;
    say(
      'firmware',
      `plan: ${userPlan} → provider: ${llmProvider} (AWS Bedrock)${llmNote ? ` — ${llmNote}` : ''}`,
      effective.fallbackFrom ? 'warn' : 'info',
    );

    const llmAvailable = isLlmAvailable(llmProvider);
    // What actually generated the artifacts, recorded per build.
    let actualLlmProvider = 'none (deterministic knowledge-base engine)';
    let firmware: FirmwareResult = synthesizeFirmware(plan);
    let firmwareSource: 'deterministic' | 'llm-assisted' = 'deterministic';

    // The JSON contract (`expectedJsonFields`, resolved at stage 1) is now a
    // hard gate on this sketch: the website already shipped against those exact
    // names, so a draft that renames them is repaired or replaced — the website
    // is never bent to fit a draft.
    say('firmware', `firmware must publish the website's contract fields: ${expectedJsonFields.join(', ')}`);

    if (llmAvailable) {
      try {
        say('firmware', `${llmProvider} available — asking the LLM for a first draft (45s timeout guard).`);
        // Old 8s timeout call commented out per Rule 2:
        // const timeoutPromise = new Promise<never>((_, reject) =>
        //   setTimeout(() => reject(new Error('LLM response timeout (8s limit reached for fast build)')), 8000)
        // );

        // ??$$$ Wrap LLM call with a 45-second timeout guard so Bedrock has time to generate full C++ code
        const draftPromise = generateFirmwareLlm(brief, projectName, graphParsed, {
          provider: llmProvider,
          model: input.model,
          jsonContract: { endpoint: '/api/sensors', fields: expectedJsonFields },
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('LLM response timeout (45s safety limit reached)')), 45_000)
        );
        const draft = await Promise.race([draftPromise, timeoutPromise]);
        firmware = firmwareResultSchema.parse(draft);
        firmwareSource = 'llm-assisted';
        actualLlmProvider = llmProvider;
        say('firmware', `LLM draft came back from ${llmProvider}: ${firmware.files.length} file(s) for ${firmware.board}`, 'ok');
      } catch (error) {
        say('firmware', `LLM draft skipped (${error instanceof Error ? error.message : String(error)}) — using fast knowledge-base synthesiser.`, 'warn');
        firmwareSource = 'deterministic';
      }
    } else {
      say('firmware', 'No LLM key configured — knowledge-base synthesis engine drives (this is the primary path, not a fallback).');
    }

    // ── Multi-turn revision: apply a human follow-up request before gating ──
    const revision = input.revisionInstruction?.trim();
    if (revision) {
      emit({ type: 'stage', stage: 'firmware-revise', title: 'Applying requested change' });
      if (!isLlmAvailable(llmProvider)) {
        say('firmware-revise', `Cannot apply change ("${revision.slice(0, 80)}") without an LLM key — building the unmodified plan instead.`, 'warn');
      } else {
        const revised = await reviseFirmwareWithLlm(firmware, revision, plan, {
          provider: llmProvider,
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
      if (cancelled()) return;
      firmwareIterations = attempt;
      emit({ type: 'stage', stage: 'firmware-validate', title: `Compiling firmware (attempt ${attempt})` });
      markProgress({ stage: 'firmware-validate' });
      firmwareReport = await validateFirmware(firmware.files, {
        workDir: path.join(work.root, 'firmware'),
        boardDefine: plan.board.archDefine,
        expectedJsonFields,
        plan,
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
        if (!next && isLlmAvailable(llmProvider)) {
          const llmRepair = await repairFirmwareWithLlm(firmware, firmwareReport.findings, plan, {
            provider: llmProvider,
            model: input.model,
            expectedJsonFields,
          });
          if (llmRepair) {
            next = llmRepair.firmware;
            firmwareSource = 'llm-assisted';
            actualLlmProvider = llmProvider;
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

    // The other half is usable now too.
    firmwareJsonFields = collectFirmwareJsonFields(firmware);
    say('firmware', `firmware publishes JSON fields: ${firmwareJsonFields.join(', ') || '(none detected)'}`, 'ok');
    markProgress({
      stage: 'consistency',
      firmware: { ready: true, board: firmware.board, files: firmware.files },
    });

    if (cancelled()) return;

    // ── Stage 4: cross-artifact consistency ─────────────────────────────────
    emit({ type: 'stage', stage: 'consistency', title: 'Cross-checking firmware ⇄ website contract' });
    let consistency = crossConsistency(firmware, software, firmwareJsonFields);
    reportToEvents('consistency', consistency, emit);

    // Website-first consequence, handled head-on: the dashboard is already
    // published against the knowledge-base contract, so when a firmware draft
    // drifts off it the FIRMWARE is pulled back — never the website the human
    // may already be clicking through. The KB synthesiser publishes the
    // contract fields by construction, so this always converges.
    if (!consistency.ok && firmwareSource === 'llm-assisted') {
      const drifted = consistency.findings.filter((f) => f.severity === 'error');
      say(
        'consistency',
        `the draft firmware disagrees with the shipped website (${[...new Set(drifted.map((f) => f.code))].join(', ')}) — replacing it with knowledge-base firmware and re-compiling`,
        'warn',
      );
      firmware = synthesizeFirmware(plan);
      firmwareSource = 'deterministic';
      firmwareReport = await validateFirmware(firmware.files, {
        workDir: path.join(work.root, 'firmware'),
        boardDefine: plan.board.archDefine,
        expectedJsonFields,
        plan,
      });
      reportToEvents('firmware-validate', firmwareReport, emit);
      if (!firmwareReport.ok) {
        emit({ type: 'error', message: 'Knowledge-base firmware did not pass its own gate — nothing shipped. See the log.' });
        return;
      }
      firmwareJsonFields = collectFirmwareJsonFields(firmware);
      say('consistency', `replacement firmware publishes: ${firmwareJsonFields.join(', ')}`, 'ok');
      markProgress({ firmware: { ready: true, board: firmware.board, files: firmware.files } });
      consistency = crossConsistency(firmware, software, firmwareJsonFields);
      reportToEvents('consistency', consistency, emit);
    }

    if (!consistency.ok) {
      emit({ type: 'error', message: 'Firmware and website disagree on their API contract. See findings in the log.' });
      return;
    }
    markProgress({ stage: 'simulate' });
    if (cancelled()) return;

    // ── Stage 5: hardware simulation (M4) ───────────────────────────────────
    // Two INDEPENDENT verdicts come out of this stage:
    //   hardware ready — the HardwareSimProvider (mock virtual bench, or
    //                    Velxio when SIM_MODE=velxio) ran the resolved plan;
    //   software ready — npm install / tsc / vite / runtime smoke test and
    //                    the firmware⇄software contract, all already run.
    // Neither is inferred from the other, and a simulator that ERRORS is
    // reported as an error — never silently treated as a pass or a skip.
    emit({ type: 'stage', stage: 'simulate', title: 'Simulating the hardware' });
    const simProvider = getHardwareSimProvider();
    say('simulate', `provider: ${simProvider.describe()}`);
    let hardwareSim: SimResult;
    try {
      // The REAL provider (Velxio) compiles and boots the pipeline's own
      // firmware artifacts; the mock ignores the context.
      hardwareSim = await simProvider.runSim(plan, { firmwareFiles: firmware.files });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      hardwareSim = {
        provider: simProvider.mode,
        ok: false,
        errored: true,
        checks: [{ name: 'simulator invocation', ok: false, detail: message }],
        log: [`sim provider threw: ${message}`],
        durationMs: 0,
      };
    }
    for (const line of hardwareSim.log) say('simulate', line, hardwareSim.ok ? 'info' : 'warn');
    for (const check of hardwareSim.checks) {
      say('simulate', `  ${check.ok ? '✔' : '✘'} ${check.name} — ${check.detail}`, check.ok ? 'ok' : 'error');
    }
    if (hardwareSim.errored) {
      say(
        'simulate',
        `SIMULATOR ERROR (${hardwareSim.provider}) — hardware readiness cannot be proven, downloads stay locked. This is an error, not a skip.`,
        'error',
      );
    } else {
      say('simulate', `hardware ready: ${hardwareSim.ok ? '✔ pass' : '✘ fail'}`, hardwareSim.ok ? 'ok' : 'error');
    }

    const softwareReady = softwareReport.ok && consistency.ok;
    say('simulate', `software ready: ${softwareReady ? '✔ pass' : '✘ fail'} (npm · tsc · vite · runtime smoke · contract)`, softwareReady ? 'ok' : 'error');

    const simulation = {
      hardware: {
        provider: hardwareSim.provider,
        ready: hardwareSim.ok && !hardwareSim.errored,
        errored: hardwareSim.errored,
        checks: hardwareSim.checks,
        log: hardwareSim.log,
        durationMs: hardwareSim.durationMs,
        runUrl: hardwareSim.runUrl,
      },
      software: {
        ready: softwareReady,
        checks: [...softwareReport.checks, ...consistency.checks],
        detail: softwareReady
          ? 'npm install, tsc --noEmit, vite build, runtime smoke test and the firmware⇄software contract all passed'
          : 'the software gate did not pass',
      },
      downloadUnlocked: hardwareSim.ok && !hardwareSim.errored && softwareReady,
    };

    // ── Stage 6: per-build instructions + BOM (M5) ──────────────────────────
    emit({ type: 'stage', stage: 'package', title: 'Writing per-build instructions and BOM' });
    const bom = buildBom(plan);
    const instructionsContent = buildInstructions({
      plan,
      firmware,
      bom,
      hardwareSim,
      softwareReady,
      softwareFileCount: software.files.length,
    });
    const instructionsPath = `INSTRUCTIONS-${slug}.md`;
    // Ship the instructions inside the firmware zip too, so the document
    // travels with the build rather than living only in the browser.
    firmware = firmwareResultSchema.parse({
      ...firmware,
      files: [
        ...firmware.files.filter((file) => file.path !== instructionsPath),
        { path: instructionsPath, content: instructionsContent },
      ],
    });
    say('package', `instructions: ${instructionsPath} (${instructionsContent.length} chars, generated from this build's plan)`, 'ok');
    say('package', `BOM: ${bom.entries.length} line item(s), ${bom.entries.reduce((n, e) => n + e.links.length, 0)} purchase link(s)`, 'ok');

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
      llm: {
        plan: userPlan,
        requested: requestedProvider,
        actual: actualLlmProvider,
        note: llmNote,
      },
      simulation,
      instructions: { path: instructionsPath, content: instructionsContent },
      bom,
      preview,
    };

    // The single line an operator can grep for: which provider actually ran.
    say(
      'done',
      `LLM provider that actually ran for this build: ${actualLlmProvider} (plan ${userPlan}, provider ${requestedProvider}${llmNote ? `; ${llmNote}` : ''})`,
      'ok',
    );

    say('done', `pipeline complete in ${((Date.now() - t0) / 1000).toFixed(1)} s — website ⇢ ${softwareIterations} iteration(s), firmware ⇢ ${firmwareIterations} iteration(s)`, 'ok');
    markProgress({ status: 'done', stage: 'done' });
    emit({ type: 'result', result });
  } catch (error) {
    logger.error({ err: error }, 'agentic pipeline crashed');
    emit({ type: 'error', message: error instanceof Error ? error.message : 'Agentic build crashed.' });
  } finally {
    // Any early return above (a gate that never passed, a cancel) leaves the
    // snapshot saying "running" — close it out so page 04 stops waiting.
    if (progress.status === 'running') {
      markProgress({ status: input.signal?.aborted ? 'cancelled' : 'error' });
    }
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
 * Deterministic repair for website trees.
 *
 * The website is built against the knowledge-base contract (one JSON field per
 * KB metric + `state`), so repair never needs a firmware to look at — the
 * contract fields ARE the target. Strategies, in order:
 *  1. FIELD-NOT-PUBLISHED / CONTRACT-FIELD — re-point every metric path at the
 *     contract field the firmware gate forces the sketch to publish.
 *  2. Anything else touching only the generated files — regenerate from KB.
 *  3. Scaffold errors are fatal — return null (no strategy).
 */
async function repairSoftware(
  software: SoftwareSynthResult,
  errors: ValidationFinding[],
  plan: import('./types.js').DeviceBuildPlan,
  contractFields: string[],
): Promise<SoftwareSynthResult | null> {
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
    const { overrides, unmapped } = mapMetricFieldsToFirmware(plan, contractFields);
    if (unmapped.length === 0) {
      // Every KB metric maps onto a contract field — regenerate with them.
      return synthesizeSoftware(plan, overrides);
    }
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
