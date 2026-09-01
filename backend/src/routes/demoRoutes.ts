/**
 * GET /api/demo/build — one canonical, fully-populated demo project:
 *
 *   "esp32 + bme280 weather station logging to a website i can open at home"
 *
 * Purpose: jump STRAIGHT from the landing page to page 04 (simulator +
 * website) without running the full pipeline. Nothing here is hand-faked
 * JSON — the artifacts come from the SAME generators the real pipeline uses
 * (plan resolver → firmware synth → software synth → BOM → instructions →
 * mock virtual bench → preview publish), so every consumer downstream
 * (SimPage, WokwiBench, the Velxio push, the zips, the preview iframe) sees
 * exactly the shape a real build produces.
 *
 * What IS different, and said so on the result: the terminal gates
 * (g++/npm/tsc/vite/smoke) are not run. Their reports are labelled
 * "demo — gate not executed" instead of pretending they passed.
 *
 * The result is cached in memory; the preview is re-published if it was
 * pruned (only the newest 8 previews are kept).
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Router } from 'express';

import { buildBom } from '../agentic/bom.js';
import { buildInstructions } from '../agentic/instructions.js';
import { getPreview, newPreviewId, publishPreview } from '../agentic/preview.js';
import { resolveBuildPlan } from '../agentic/planResolver.js';
import { synthesizeFirmware } from '../agentic/firmwareSynth.js';
import { synthesizeSoftware } from '../agentic/softwareSynth.js';
import type { AgenticBuildResult, BuildSimulationSummary, DeviceBuildPlan, ValidationReport } from '../agentic/types.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { normaliseGraph } from '../schemas/architecture.js';
import { MockHardwareSimProvider } from '../providers/sim/mockHardwareSimProvider.js';
import { logger } from '../config/logger.js';

export const DEMO_BRIEF = 'esp32 + bme280 weather station logging to a website i can open at home';
export const DEMO_PROJECT_NAME = 'Weather Station (demo)';

const router = Router();

let cached: AgenticBuildResult | null = null;

/** A demo gate report: honest about what did NOT run. */
function demoReport(target: ValidationReport['target'], checks: ValidationReport['checks']): ValidationReport {
  return {
    target,
    ok: true,
    checks: [
      ...checks,
      {
        name: 'terminal gates',
        ok: true,
        detail: 'demo — g++/npm/tsc/vite/smoke were NOT executed for this pre-baked project. Run a real build on page 03 for verified gates.',
      },
    ],
    findings: [],
    commands: [],
    durationMs: 0,
  };
}

/**
 * The demo dashboard the Website half serves. Self-contained (no build
 * step), talks to the SAME preview stub API a real generated bundle uses
 * (relative ./api/… resolves under /api/preview/<id>/).
 */
function demoDashboardHtml(plan: DeviceBuildPlan): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${plan.projectName} — Live Dashboard (demo)</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 15px/1.5 system-ui, sans-serif; background: #0b0f14; color: #dbe4ee; padding: 28px; }
  header { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
  h1 { font-size: 20px; }
  .pill { font-size: 12px; color: #7fd4a2; border: 1px solid #2c5340; border-radius: 999px; padding: 2px 10px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
  .card { background: #121924; border: 1px solid #1f2c3d; border-radius: 12px; padding: 16px; }
  .card h2 { font-size: 13px; font-weight: 600; color: #8aa0b8; text-transform: uppercase; letter-spacing: .06em; }
  .value { font-size: 34px; font-weight: 700; margin: 6px 0 2px; font-variant-numeric: tabular-nums; }
  .unit { font-size: 15px; color: #8aa0b8; font-weight: 400; }
  canvas { width: 100%; height: 46px; margin-top: 8px; }
  footer { margin-top: 22px; font-size: 12px; color: #66788d; }
  .err { color: #ff9c9c; }
</style>
</head>
<body>
<header>
  <h1>${plan.projectName}</h1>
  <span class="pill" id="status">connecting…</span>
</header>
<div class="grid" id="grid"></div>
<footer>
  Demo dashboard · board: ${plan.board.name} · polling <code>./api/telemetry/live</code> every 2 s ·
  the readings come from Wireup's preview stub — flash the firmware zip and run the software zip to
  see your real BME280 here.
</footer>
<script>
(function () {
  var histories = {};
  var grid = document.getElementById('grid');
  var status = document.getElementById('status');
  var cards = {};

  function card(key, label, unit) {
    var el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = '<h2>' + label + '</h2><div class="value"><span data-v>–</span> <span class="unit">' + unit + '</span></div><canvas></canvas>';
    grid.appendChild(el);
    return { value: el.querySelector('[data-v]'), canvas: el.querySelector('canvas') };
  }

  function spark(canvas, values) {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
    var ctx = canvas.getContext('2d');
    if (!ctx || values.length < 2) return;
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var span = (max - min) || 1;
    ctx.strokeStyle = '#5c9ded'; ctx.lineWidth = 2 * dpr; ctx.beginPath();
    values.forEach(function (v, i) {
      var x = (i / (values.length - 1)) * canvas.width;
      var y = canvas.height - ((v - min) / span) * (canvas.height - 4 * dpr) - 2 * dpr;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  var UNITS = { temperature_c: '°C', humidity_pct: '%', pressure_hpa: 'hPa' };

  function tick() {
    fetch('./api/telemetry/live').then(function (r) { return r.json(); }).then(function (live) {
      status.textContent = 'live · ' + new Date(live.ts).toLocaleTimeString();
      status.classList.remove('err');
      Object.keys(live).forEach(function (metric) {
        var group = live[metric];
        if (typeof group !== 'object' || group === null || metric === 'status') return;
        Object.keys(group).forEach(function (field) {
          var value = group[field];
          if (typeof value !== 'number') return;
          if (!cards[field]) cards[field] = card(field, metric, UNITS[field] || '');
          cards[field].value.textContent = Math.round(value * 10) / 10;
          (histories[field] = histories[field] || []).push(value);
          if (histories[field].length > 60) histories[field].shift();
          spark(cards[field].canvas, histories[field]);
        });
      });
    }).catch(function () {
      status.textContent = 'stub API unreachable — is the Wireup backend running?';
      status.classList.add('err');
    });
  }
  tick();
  setInterval(tick, 2000);
})();
</script>
</body>
</html>
`;
}

async function buildDemoResult(): Promise<AgenticBuildResult> {
  const { graph } = normaliseGraph({});
  const { plan } = resolveBuildPlan(DEMO_BRIEF, DEMO_PROJECT_NAME, graph);

  // The same generators the pipeline runs — real artifacts, not props.
  let firmware = synthesizeFirmware(plan);
  const software = await synthesizeSoftware(plan);
  const bom = buildBom(plan);

  // Real (mock-provider) virtual-bench run — deterministic per plan.
  const hardwareSim = await new MockHardwareSimProvider().runSim(plan);

  const instructionsContent = buildInstructions({
    plan,
    firmware,
    bom,
    hardwareSim,
    softwareReady: true,
    softwareFileCount: software.files.length,
  });
  const instructionsPath = `INSTRUCTIONS-${plan.slug}.md`;
  firmware = {
    ...firmware,
    files: [
      ...firmware.files.filter((file) => file.path !== instructionsPath),
      { path: instructionsPath, content: instructionsContent },
    ],
  };

  // A real preview, published through the real machinery, serving the demo
  // dashboard against the same stub API a generated bundle would use.
  const distDir = await mkdtemp(path.join(os.tmpdir(), 'wireup-demo-'));
  await writeFile(path.join(distDir, 'index.html'), demoDashboardHtml(plan), 'utf8');
  const preview = await publishPreview({ id: newPreviewId(), plan, distDir });

  const simulation: BuildSimulationSummary = {
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
      ready: true,
      checks: [
        {
          name: 'software gates',
          ok: true,
          detail: 'demo — npm/tsc/vite/smoke not executed for this pre-baked project',
        },
      ],
      detail: 'demo project — software gates were not run; run a real build on page 03 for verified artifacts',
    },
    downloadUnlocked: hardwareSim.ok && !hardwareSim.errored,
  };

  return {
    projectName: plan.projectName,
    slug: plan.slug,
    engine: 'deterministic',
    iterations: { firmware: 1, software: 1 },
    firmware,
    websiteRequirements: software.requirements,
    software: {
      projectName: `${plan.slug}-dashboard`,
      files: software.files,
      readme: software.readme,
      envExampleLines: software.envExampleLines,
    },
    validation: {
      firmware: demoReport('firmware', [
        { name: 'entrypoint', ok: true, detail: `Sketch entry point: firmware/${plan.slug}.ino` },
        { name: 'artifacts', ok: true, detail: `${firmware.files.length} files generated from the resolved plan` },
      ]),
      software: demoReport('software', [
        { name: 'artifacts', ok: true, detail: `${software.files.length} files generated from the resolved plan` },
      ]),
      consistency: demoReport('consistency', [
        {
          name: 'shared generators',
          ok: true,
          detail: 'firmware and software were generated from the SAME resolved plan in one pass — the contract cannot drift in a demo build',
        },
      ]),
    },
    llm: {
      plan: 'free',
      requested: 'none',
      actual: 'none (deterministic knowledge-base engine)',
      note: 'Demo project — pre-baked from the canonical weather-station brief.',
    },
    simulation,
    instructions: { path: instructionsPath, content: instructionsContent },
    bom,
    preview,
  };
}

/**
 * Public on purpose: the demo is the product tour, it must work one click
 * from the landing page with zero setup. It exposes nothing user-specific —
 * the identical result is handed to everyone.
 */
router.get(
  '/demo/build',
  asyncHandler(async (_req, res) => {
    // Re-publish when the preview registry pruned our dashboard away.
    if (!cached || !cached.preview || !getPreview(cached.preview.id)) {
      cached = await buildDemoResult();
      logger.info(
        { slug: cached.slug, preview: cached.preview?.id ?? null },
        'demo: weather-station project (re)built',
      );
    }
    res.status(200).json({ demo: true, brief: DEMO_BRIEF, result: cached });
  }),
);

export default router;
