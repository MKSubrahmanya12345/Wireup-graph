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
import { isSpecGraphReadyForHandoff, saveSpecGraphToDisk } from './specGraph.js';
import { newPreviewId, previewApiBaseFor, previewBaseFor, publishPreview } from './preview.js';
import { ProgressTracker } from './progressTracker.js';
import { ErrorContextTracker } from './errorContext.js';
import { healthMonitor } from './healthMonitor.js';
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
 *   retrieve (RAG) → resolve plan → start the firmware LLM draft IN THE
 *     BACKGROUND → generate the WEBSITE → build it in the terminal
 *     (pnpm/tsc/vite, warm dependency store, both trees concurrently) →
 *     PUBLISH it live → collect the background draft → compile firmware →
 *     repair loop → cross-check the contract → simulate → ship.
 *
 * Website-first is deliberate: the dashboard is the half a human can look at,
 * so it is built, validated and published before the firmware is gated. Page
 * 04 can run that website while the firmware is still being worked on — the
 * two halves of one build finish at different times, and each is announced on
 * the wire (`progress` events) the moment it is usable.
 *
 * The halves share no resources: the firmware draft is one network call to
 * the LLM, the website stage is local pnpm/tsc/vite work — so the draft
 * starts the moment the plan resolves and its latency hides entirely inside
 * the website build.
 *
 * Generation is deterministic-first (knowledge base templates). When AWS
 * Bedrock is configured the LLM is offered the first draft, but every
 * artifact — LLM or template — must pass the same terminal gauntlet, and any
 * LLM failure falls back to the deterministic path. Nothing ships unvalidated.
 */

const PIPELINE_VERSION = 'wireup-agentic-2.1';

/** The firmware LLM draft, started in the background during the website stage. */
interface FirmwareDraft {
  /** Resolves with the parsed draft, or null when the LLM failed/timed out. */
  promise: Promise<FirmwareResult | null>;
  startedAt: number;
  /** Why the draft did not come back (null while it is still running). */
  error: { message: string | null };
}

function now(): string {
  return new Date().toISOString().slice(11, 19);
}

export async function runAgenticPipeline(input: PipelineInput, emit: EmitFn): Promise<void> {
  const t0 = Date.now();
  
  // Initialize enhanced progress tracking and health monitoring
  const progressTracker = new ProgressTracker(emit);
  progressTracker.startHeartbeat();
  healthMonitor.start(emit);
  
  // Generate unique job ID for health tracking
  const jobId = Math.random().toString(36).substr(2, 9);
  healthMonitor.recordBuildStart(jobId);
  
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
  /** §7 handoff snapshot — filled by stage 0 when a validated spec graph rides along. */
  let specHandoff: {
    nodeCount: number;
    decisions: { node: string; claim: string; why: string }[];
    uncertainties: { node: string; note: string }[];
    dir: string;
  } | null = null;

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
    // ── Stage 0: spec-graph handoff gate (design doc §7) ──────────────────────
    // The coding agent accepts the full node graph ONLY when every node is
    // validated, the question queue is empty and no error-severity issue is
    // open. A not-ready graph fails the build loudly — never a silent build
    // from half-resolved specs.
    if (input.specGraph) {
      if (!isSpecGraphReadyForHandoff(input.specGraph)) {
        say(
          'spec-graph',
          'spec graph is NOT ready for handoff (open questions, unresolved nodes or error-severity issues) — refusing to build',
          'error',
        );
        emit({
          type: 'error',
          message:
            'The spec graph is not ready for handoff: every node must be validated with an empty question queue before the build can run. Answer the open questions on the spec-graph page first.',
        });
        markProgress({ status: 'error', stage: 'spec-graph' });
        return;
      }
      emit({ type: 'stage', stage: 'spec-graph', title: 'Spec graph handoff — validated graph accepted' });
      markProgress({ stage: 'spec-graph' });
      const specDir = path.join(work.root, 'spec-graph');
      saveSpecGraphToDisk(input.specGraph, specDir);
      const specNodes = Object.values(input.specGraph.nodes);
      const decisions = specNodes.flatMap((node) =>
        node.assumptions.map((assumption) => ({
          node: node.title,
          claim: assumption.claim,
          why: assumption.why,
        })),
      );
      const uncertainties = specNodes.flatMap((node) =>
        node.known_uncertainty.map((note) => ({ node: node.title, note })),
      );
      specHandoff = { nodeCount: specNodes.length, decisions, uncertainties, dir: specDir };
      say(
        'spec-graph',
        `handoff accepted: ${specNodes.length} validated node(s), ${decisions.length} preserved assumption(s), ${uncertainties.length} disclosed known-uncertaint${uncertainties.length === 1 ? 'y' : 'ies'} → ${specDir} (manifest.json + nodes/*.json)`,
        'ok',
      );
    }

    // ── Stage 1: retrieval ──────────────────────────────────────────────────
    const stageDefinitions = ProgressTracker.getStageDefinitions();
    progressTracker.initStage('retrieve', stageDefinitions.retrieve.title, stageDefinitions.retrieve.substeps);
    progressTracker.startStage('retrieve');
    progressTracker.startSubstep('retrieve', 'parse-brief', `Parsing: "${brief.slice(0, 80)}${brief.length > 80 ? '...' : ''}"`);
    
    emit({ type: 'stage', stage: 'retrieve', title: 'Retrieving device knowledge (RAG)' });
    say('retrieve', `pipeline ${PIPELINE_VERSION} · workdir ${work.root}`);
    say('retrieve', `brief: "${brief.slice(0, 140)}${brief.length > 140 ? '…' : ''}"`);

    progressTracker.completeSubstep('retrieve', 'parse-brief');
    progressTracker.startSubstep('retrieve', 'knowledge-lookup', 'Looking up device knowledge');
    
    const resolved = resolveBuildPlan(brief, projectName, graphParsed, input.sampleIntervalMs);
    const { plan } = resolved;

    progressTracker.updateSubstep('retrieve', 'knowledge-lookup', 50, 'Resolving build plan');
    progressTracker.completeSubstep('retrieve', 'knowledge-lookup');
    progressTracker.startSubstep('retrieve', 'resolve-plan', 'Resolving hardware modules');

    if (plan.modules.length === 0) {
      progressTracker.failSubstep('retrieve', 'resolve-plan', 'No supported hardware modules found');
      emit({
        type: 'error',
        message:
          'No supported hardware modules were recognised in the brief or graph. The Wireup knowledge base covers: ' +
          'DHT11/DHT22, BME280, DS18B20, soil moisture, MQ-2, HC-SR04, PIR, relay, servo, LED, OLED — on ESP32.',
      });
      return;
    }

    progressTracker.completeSubstep('retrieve', 'resolve-plan');
    progressTracker.startSubstep('retrieve', 'validate-modules', `Found ${plan.modules.length} modules`);

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

    progressTracker.completeSubstep('retrieve', 'validate-modules');
    progressTracker.completeStage('retrieve');
    
    // Record stage performance
    const retrieveTime = Date.now() - t0;
    healthMonitor.recordStagePerformance('retrieve', retrieveTime, true);
    say('retrieve', `✅ Stage completed in ${Math.round(retrieveTime / 1000)}s`, 'ok');

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

    // ── Provider selection (M2) + the background firmware draft ─────────────
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
    let firmwareDraft: FirmwareDraft | null = null;
    if (llmAvailable) {
      // The draft is one network call and shares NOTHING with the website
      // stage (local pnpm/tsc/vite work) — so it starts NOW, in the
      // background, and stage 3 collects the result instead of paying its
      // latency after the website gate. Deterministic fallback stays instant.
      const startedAt = Date.now();
      const error = { message: null as string | null };
      say('firmware', `${llmProvider} available — LLM draft started in the background (45s timeout guard) while the website builds.`);
      const promise = (async (): Promise<FirmwareResult | null> => {
        try {
          const draftPromise = generateFirmwareLlm(brief, projectName, graphParsed, {
            provider: llmProvider,
            model: input.model,
            jsonContract: { endpoint: '/api/sensors', fields: expectedJsonFields },
          });
          const timeoutPromise = new Promise<never>((_, reject) => {
            const timer = setTimeout(() => reject(new Error('LLM response timeout (45s safety limit reached)')), 45_000);
            timer.unref?.();
          });
          return firmwareResultSchema.parse(await Promise.race([draftPromise, timeoutPromise]));
        } catch (err) {
          error.message = err instanceof Error ? err.message : String(err);
          return null;
        }
      })();
      promise.catch(() => undefined); // never unhandled — stage 3 awaits it again
      firmwareDraft = { promise, startedAt, error };
    } else {
      say('firmware', 'No LLM key configured — knowledge-base synthesis engine drives (this is the primary path, not a fallback).');
    }

    // ── Stage 2: website (generate → build → repair → PUBLISH) ──────────────
    progressTracker.initStage('software', stageDefinitions.software.title, stageDefinitions.software.substeps);
    progressTracker.startStage('software');
    progressTracker.startSubstep('software', 'synthesize', 'Synthesizing MERN stack');
    
    emit({ type: 'stage', stage: 'software', title: 'Assembling MERN dashboard software' });

    let software: SoftwareSynthResult = await synthesizeSoftware(plan);
    progressTracker.completeSubstep('software', 'synthesize');
    progressTracker.startSubstep('software', 'merge-files', `Merging ${software.files.length} files`);
    
    say('software', `merged ${software.files.length} files (scaffold + device wiring)`);
    say('software', `metrics: ${plan.modules.flatMap((m) => m.metrics.map((x) => x.id)).join(', ') || 'none'}; controls: ${plan.modules.flatMap((m) => m.controls.map((x) => x.id)).join(', ') || 'none'}`);

    // Until the firmware exists, the "fields the firmware publishes" ARE the
    // contract fields. Re-read from the real sketch at stage 4.
    let firmwareJsonFields = [...expectedJsonFields];
    say('software', `dashboard wired against the knowledge-base contract: ${firmwareJsonFields.join(', ')}`);

    progressTracker.completeSubstep('software', 'merge-files');
    progressTracker.startSubstep('software', 'wire-endpoints', 'Wiring device endpoints');
    
    let softwareReport: ValidationReport | null = null;
    let softwareIterations = 0;
    let previousSoftwareFingerprint = '';

    progressTracker.completeSubstep('software', 'wire-endpoints');
    progressTracker.startSubstep('software', 'generate-types', 'Generating TypeScript types');
    
    // Initialize software validation stage
    progressTracker.initStage('software-validate', stageDefinitions['software-validate'].title, stageDefinitions['software-validate'].substeps);
    
    const softwareStageStart = Date.now();

    for (let attempt = 1; attempt <= env.AGENTIC_MAX_REPAIR_LOOPS; attempt++) {
      softwareIterations = attempt;
      progressTracker.startStage('software-validate');
      progressTracker.startSubstep('software-validate', 'install-deps', `Installing dependencies (attempt ${attempt})`);
      
      emit({ type: 'stage', stage: 'software-validate', title: `Building MERN project (attempt ${attempt})` });
      
      // Add detailed logging for what's happening
      say('software-validate', `Starting validation attempt ${attempt}/${env.AGENTIC_MAX_REPAIR_LOOPS}`, 'info');
      say('software-validate', `Working directory: ${path.join(work.root, 'software')}`, 'info');
      say('software-validate', `Files to validate: ${software.files.length}`, 'info');
      
      progressTracker.updateSubstep('software-validate', 'install-deps', 25, 'Setting up build environment');
      
      const validationStartTime = Date.now();
      
      softwareReport = await validateSoftware(software.files, {
        workDir: path.join(work.root, 'software'),
        devicePort: 80,
        firmwareJsonFields,
        metrics: plan.modules.flatMap((m) => m.metrics),
        preview: { base: previewBaseFor(previewId), apiBase: previewApiBaseFor(previewId) },
      });
      
      const validationDuration = Date.now() - validationStartTime;
      say('software-validate', `Validation completed in ${validationDuration}ms`, 'info');
      
      // Emit performance warning if validation is taking too long
      if (validationDuration > 120000) { // 2 minutes
        say('software-validate', `⚠️ Validation took ${Math.round(validationDuration / 1000)}s - this may indicate performance issues`, 'warn');
      }
      
      progressTracker.completeSubstep('software-validate', 'install-deps');
      progressTracker.startSubstep('software-validate', 'type-check', 'Type checking TypeScript files');
      
      reportToEvents('software-validate', softwareReport, emit);

      if (softwareReport.ok) {
        progressTracker.completeSubstep('software-validate', 'type-check');
        progressTracker.completeStage('software-validate');
        
        const totalSoftwareTime = Date.now() - softwareStageStart;
        healthMonitor.recordStagePerformance('software', totalSoftwareTime, true);
        say('software-validate', `MERN project builds clean — attempt ${attempt} (${Math.round(totalSoftwareTime / 1000)}s total)`, 'ok');
        break;
      }

      progressTracker.failSubstep('software-validate', 'type-check', `Validation failed with ${softwareReport.findings.filter(f => f.severity === 'error').length} errors`);
      
      const errors = softwareReport.findings.filter((f) => f.severity === 'error');
      say('software-validate', `${errors.length} error(s): ${[...new Set(errors.map((e) => e.code))].join(', ')}`, 'error');
      
      if (attempt === env.AGENTIC_MAX_REPAIR_LOOPS) {
        progressTracker.failStage('software-validate', 'Maximum repair attempts reached');
        break;
      }

      say('software-repair', `Attempting repair for attempt ${attempt}`, 'info');
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

    // ── Stage 3: firmware (collect background draft → compile → repair) ─────
    emit({ type: 'stage', stage: 'firmware', title: 'Generating firmware' });

    // What actually generated the artifacts, recorded per build.
    let actualLlmProvider = 'none (deterministic knowledge-base engine)';
    let firmware: FirmwareResult = synthesizeFirmware(plan);
    let firmwareSource: 'deterministic' | 'llm-assisted' = 'deterministic';

    // The JSON contract (`expectedJsonFields`, resolved at stage 1) is now a
    // hard gate on this sketch: the website already shipped against those exact
    // names, so a draft that renames them is repaired or replaced — the website
    // is never bent to fit a draft.
    say('firmware', `firmware must publish the website's contract fields: ${expectedJsonFields.join(', ')}`);

    if (firmwareDraft) {
      // Collect the draft that has been running since before the website
      // gate — by now it is usually already done, so this costs ~0 ms.
      const waitedMs = Date.now() - firmwareDraft.startedAt;
      say('firmware', `collecting the background LLM draft (running for ${(waitedMs / 1000).toFixed(1)} s alongside the website)…`);
      const draft = await firmwareDraft.promise;
      if (draft) {
        firmware = draft;
        firmwareSource = 'llm-assisted';
        actualLlmProvider = llmProvider;
        say(
          'firmware',
          `LLM draft came back from ${llmProvider}: ${firmware.files.length} file(s) for ${firmware.board} (finished ${((Date.now() - firmwareDraft.startedAt) / 1000).toFixed(1)} s after start, largely hidden inside the website build)`,
          'ok',
        );
      } else {
        say('firmware', `LLM draft skipped (${firmwareDraft.error.message ?? 'unknown error'}) — using fast knowledge-base synthesiser.`, 'warn');
        firmwareSource = 'deterministic';
      }
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
      specDecisions: specHandoff?.decisions,
      specUncertainties: specHandoff?.uncertainties,
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
      specGraphHandoff: specHandoff
        ? {
            nodeCount: specHandoff.nodeCount,
            assumptions: specHandoff.decisions.length,
            uncertainties: specHandoff.uncertainties.length,
            dir: specHandoff.dir,
          }
        : undefined,
    };

    // The single line an operator can grep for: which provider actually ran.
    say(
      'done',
      `LLM provider that actually ran for this build: ${actualLlmProvider} (plan ${userPlan}, provider ${requestedProvider}${llmNote ? `; ${llmNote}` : ''})`,
      'ok',
    );

    say('done', `pipeline complete in ${((Date.now() - t0) / 1000).toFixed(1)} s — website ⇢ ${softwareIterations} iteration(s), firmware ⇢ ${firmwareIterations} iteration(s)`, 'ok');
    
    // Record successful build completion
    healthMonitor.recordBuildEnd(jobId, true);
    
    // Emit final health report
    const healthReport = healthMonitor.getPerformanceReport();
    say('health', `🏥 Build Health: ${healthReport.buildStats.totalBuilds} total builds, ${Math.round(healthReport.buildStats.successRate)}% success rate, avg ${Math.round(healthReport.buildStats.avgBuildTime / 1000)}s`, 'info');
    
    if (healthReport.recommendations.length > 0) {
      say('health', `💡 Performance recommendations: ${healthReport.recommendations.slice(0, 2).join('; ')}`, 'info');
    }
    
    markProgress({ status: 'done', stage: 'done' });
    emit({ type: 'result', result });
  } catch (error) {
    logger.error({ err: error }, 'agentic pipeline crashed');
    
    // Record failed build
    healthMonitor.recordBuildEnd(jobId, false);
    
    emit({ type: 'error', message: error instanceof Error ? error.message : 'Agentic build crashed.' });
  } finally {
    // Cleanup progress tracker and health monitoring
    progressTracker.stopHeartbeat();
    
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
  
  // Enhanced logging for each command with detailed output
  for (const command of report.commands) {
    emit({ type: 'command', stage, cmd: command.cmd });
    
    // Log the command start with timing
    emit({ type: 'log', stage, line: `[${now()}] 🔧 Running: ${command.cmd}`, tone: 'info' });
    
    emit({ type: 'command_result', stage, cmd: command.cmd, exitCode: command.exitCode, output: command.output, durationMs: command.durationMs });
    
    // Enhanced result logging
    if (command.exitCode === 0) {
      emit({ type: 'log', stage, line: `[${now()}] ✅ Command completed (${command.durationMs}ms): ${command.cmd}`, tone: 'ok' });
      
      // Log useful output snippets for successful operations
      if (command.output.length > 0) {
        const lines = command.output.split('\n').filter(line => line.trim());
        const importantLines = lines.filter(line => 
          line.includes('compiled') || 
          line.includes('built') || 
          line.includes('generated') ||
          line.includes('installed') ||
          line.includes('dependencies')
        ).slice(0, 3);
        
        for (const line of importantLines) {
          emit({ type: 'log', stage, line: `[${now()}] 📝 ${line.trim()}`, tone: 'info' });
        }
      }
    } else {
      emit({ type: 'log', stage, line: `[${now()}] ❌ Command failed (exit ${command.exitCode}, ${command.durationMs}ms): ${command.cmd}`, tone: 'error' });
      
      // Log error details
      if (command.output.length > 0) {
        const errorLines = command.output.split('\n')
          .filter(line => line.trim() && (
            line.toLowerCase().includes('error') ||
            line.toLowerCase().includes('failed') ||
            line.toLowerCase().includes('cannot') ||
            line.includes('ERR!')
          ))
          .slice(0, 5);
          
        for (const errorLine of errorLines) {
          emit({ type: 'log', stage, line: `[${now()}] 🚨 ${errorLine.trim()}`, tone: 'error' });
        }
      }
    }
  }
  
  // Enhanced check reporting
  for (const check of report.checks) {
    const status = check.ok ? '✔' : '✘';
    const tone = check.ok ? 'ok' : 'error';
    emit({ type: 'log', stage, line: `[${now()}] ${status} ${check.name} — ${check.detail}`, tone });
  }
  
  // Enhanced finding reporting with context
  for (const finding of report.findings.slice(0, 20)) {
    const location = finding.file && finding.line ? ` (${finding.file}:${finding.line})` : '';
    const prefix = finding.severity === 'error' ? '🚨' : finding.severity === 'warning' ? '⚠️' : 'ℹ️';
    
    emit({ 
      type: 'log', 
      stage, 
      line: `[${now()}] ${prefix} ${finding.code}: ${finding.message}${location}`, 
      tone: finding.severity === 'error' ? 'error' : 'warn' 
    });
    
    if (finding.hint) {
      emit({ 
        type: 'log', 
        stage, 
        line: `[${now()}] 💡 Hint: ${finding.hint}`, 
        tone: 'info' 
      });
    }
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
