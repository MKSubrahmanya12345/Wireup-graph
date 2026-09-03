/**
 * Live preview of the generated dashboard.
 *
 * Page 04's "Website" half must show the app, not a description of it. The
 * pipeline already builds the generated MERN frontend for real (warm
 * `node_modules` hydration → `tsc -b` → `vite build`) inside the validation
 * workspace, and then throws
 * the workspace away. This module keeps that exact `dist/` — the artifact the
 * gate approved — and serves it under an unguessable id.
 *
 * What is real and what is not, stated plainly (and repeated in the UI):
 *   • The HTML/JS/CSS served here IS the generated dashboard bundle. Nothing
 *     is re-rendered or re-implemented by Wireup.
 *   • The API behind it is a STUB. The real Express backend in the software
 *     zip talks to your ESP32 over your LAN; a browser preview cannot. So the
 *     preview answers the same contract (`/health`, `/capabilities`,
 *     `/telemetry/live`, `/telemetry/history`, `/telemetry/control`) with
 *     values derived from the resolved plan's metrics.
 *
 * The build is told about the prefix up front (`vite build --base=…` plus
 * `VITE_API_BASE`), so what runs in the iframe is the same bundle that was
 * validated — no post-hoc HTML rewriting.
 */

import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import express, { Router } from 'express';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { DeviceBuildPlan } from './types.js';

export interface PreviewMetric {
  id: string;
  label: string;
  unit: string;
  jsonField: string;
  min: number;
  max: number;
}

export interface PreviewControl {
  id: string;
  label: string;
}

export interface PreviewSpec {
  id: string;
  slug: string;
  projectName: string;
  board: string;
  metrics: PreviewMetric[];
  controls: PreviewControl[];
  sampleIntervalMs: number;
  createdAt: number;
  dir: string;
  /** Feed behind this preview's browser terminal (/api/preview/<id>/terminal). */
  terminal: PreviewTerminalLog;
}

/** Public description handed to the browser with the build result. */
export interface PreviewSummary {
  id: string;
  /** Where the dashboard is served (iframe src). */
  url: string;
  /** Where its API calls land. */
  apiBase: string;
  publishedAt: string;
  /** Always true: the bundle is real, the device behind it is simulated. */
  stubbedApi: true;
  note: string;
}

/** How many previews are kept before the oldest is deleted. */
const KEEP = 8;

const previews = new Map<string, PreviewSpec>();

// ── The preview's own browser terminal ──────────────────────────────────────

export interface PreviewTerminalLine {
  seq: number;
  at: string;
  kind: 'boot' | 'request' | 'device' | 'control' | 'error' | 'info';
  text: string;
}

/**
 * The in-memory line feed behind a preview's browser terminal — the same
 * design as the generated scaffold's terminal (ring buffer + live emitter),
 * bound to ONE preview so parallel builds never interleave.
 */
export class PreviewTerminalLog {
  private buffer: PreviewTerminalLine[] = [];
  private nextSeq = 1;
  private emitter = new EventEmitter();

  constructor() {
    // Terminal tabs come and go; never die on a detached viewer's warning.
    this.emitter.setMaxListeners(0);
  }

  push(kind: PreviewTerminalLine['kind'], text: string): PreviewTerminalLine {
    const line: PreviewTerminalLine = {
      seq: this.nextSeq,
      at: new Date().toISOString().slice(11, 19),
      kind,
      text,
    };
    this.nextSeq += 1;
    this.buffer.push(line);
    if (this.buffer.length > 500) this.buffer.shift();
    this.emitter.emit('line', line);
    return line;
  }

  recent(sinceSeq = 0): PreviewTerminalLine[] {
    if (sinceSeq <= 0) return this.buffer.slice(-100);
    return this.buffer.filter((line) => line.seq > sinceSeq);
  }

  subscribe(listener: (line: PreviewTerminalLine) => void): () => void {
    this.emitter.on('line', listener);
    return () => {
      this.emitter.off('line', listener);
    };
  }
}

export function previewRoot(): string {
  return env.PREVIEW_DIR || path.join(os.tmpdir(), 'wireup-previews');
}

/** Fresh, unguessable id — preview routes are unauthenticated by necessity
 *  (an iframe cannot carry the Bearer token the API uses). */
export function newPreviewId(): string {
  return randomBytes(9).toString('base64url');
}

export function previewBaseFor(id: string): string {
  return `/api/preview/${id}/`;
}

export function previewApiBaseFor(id: string): string {
  return `/api/preview/${id}/api`;
}

function metricsFor(plan: DeviceBuildPlan): PreviewMetric[] {
  return plan.modules.flatMap((module) =>
    module.metrics.map((metric) => ({
      id: metric.id,
      label: metric.label,
      unit: metric.unit,
      jsonField: metric.jsonField,
      min: metric.min ?? 0,
      max: metric.max ?? 100,
    })),
  );
}

/** Delete every preview beyond the newest KEEP. */
async function prune(): Promise<void> {
  const ordered = [...previews.values()].sort((a, b) => b.createdAt - a.createdAt);
  for (const spec of ordered.slice(KEEP)) {
    previews.delete(spec.id);
    await rm(spec.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Copy the freshly built dashboard out of the (about to be deleted) validation
 * workspace. Best-effort by design: a missing dist means "no preview", never a
 * failed build.
 */
export async function publishPreview(options: {
  id: string;
  plan: DeviceBuildPlan;
  distDir: string;
}): Promise<PreviewSummary | null> {
  const { id, plan, distDir } = options;
  try {
    const info = await stat(path.join(distDir, 'index.html'));
    if (!info.isFile()) return null;
  } catch {
    return null;
  }

  const dir = path.join(previewRoot(), id);
  try {
    await mkdir(previewRoot(), { recursive: true });
    await rm(dir, { recursive: true, force: true });
    await cp(distDir, dir, { recursive: true });
  } catch (error) {
    logger.warn({ err: error, id }, 'preview: could not copy the built dashboard');
    return null;
  }

  const spec: PreviewSpec = {
    id,
    slug: plan.slug,
    projectName: plan.projectName,
    board: plan.board.name,
    metrics: metricsFor(plan),
    controls: plan.modules.flatMap((module) =>
      module.controls.map((control) => ({ id: control.id, label: control.label })),
    ),
    sampleIntervalMs: plan.sampleIntervalMs,
    createdAt: Date.now(),
    dir,
    terminal: new PreviewTerminalLog(),
  };
  spec.terminal.push('boot', `preview terminal ready — ${spec.projectName} (${spec.board})`);
  spec.terminal.push('boot', 'device API is the preview stub; the shipped Express backend talks to the real board over your LAN');
  previews.set(id, spec);
  await prune();

  const files = await readdir(dir).catch(() => []);
  logger.info({ id, files: files.length, slug: plan.slug }, 'preview: generated dashboard published');

  return {
    id,
    url: previewBaseFor(id),
    apiBase: previewApiBaseFor(id),
    publishedAt: new Date(spec.createdAt).toISOString(),
    stubbedApi: true,
    note:
      'Real generated bundle (the one the software gate built). Its device API is a Wireup preview stub — the shipped Express backend talks to your board over the LAN.',
  };
}

export function getPreview(id: string): PreviewSpec | undefined {
  return previews.get(id);
}

// ── The stub device API ─────────────────────────────────────────────────────

/** Stable per-metric phase so two metrics never move in lockstep. */
function phase(metricId: string): number {
  let hash = 0;
  for (const char of metricId) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return (hash / 9973) * Math.PI * 2;
}

/** A plausible reading for `metric` at time `t` (ms). Deterministic. */
export function sampleValue(metric: PreviewMetric, t: number): number {
  const mid = (metric.min + metric.max) / 2;
  const amplitude = Math.max((metric.max - metric.min) / 6, 0.5);
  const value = mid + amplitude * Math.sin(t / 24_000 + phase(metric.id));
  return Math.round(value * 10) / 10;
}

function livePayload(spec: PreviewSpec, now: number): Record<string, unknown> {
  const readings: Record<string, unknown> = {};
  for (const metric of spec.metrics) {
    // The dashboard reads `<metricId>.<jsonField>` off this object, exactly as
    // it would off the device's /api/sensors payload.
    readings[metric.id] = { [metric.jsonField]: sampleValue(metric, now) };
  }
  readings.status = {
    state: 'online',
    ip: '192.168.1.100',
    rssi: -54,
    uptimeMs: now % 86_400_000,
    preview: true,
  };
  return readings;
}

/**
 * Router mounted at /api/preview — static bundle plus the stub API.
 * Unauthenticated on purpose: iframes cannot send the Bearer token, and the
 * ids are 12 random bytes of base64url.
 */
export function previewRouter(): Router {
  const router = Router();

  // Feed the browser terminal: every stub-API call (minus the high-frequency
  // polling and the terminal's own stream) becomes a line on the log.
  router.use('/preview/:id', (req, res, next) => {
    const spec = getPreview(req.params.id);
    if (spec && req.path.startsWith('/api/')) {
      const noisy =
        req.path.startsWith('/api/telemetry/live') ||
        req.path.startsWith('/api/telemetry/history') ||
        req.path.startsWith('/api/terminal');
      if (!noisy) {
        if (req.path.startsWith('/api/telemetry/control')) {
          spec.terminal.push('control', `${req.method} ${req.path} → device command (preview stub accepts, nothing actuated)`);
        } else {
          spec.terminal.push('request', `${req.method} ${req.path}`);
        }
      }
    }
    next();
  });

  router.get('/preview/:id/api/terminal/stream', (req, res) => {
    const spec = getPreview(req.params.id);
    if (!spec) return res.status(404).json({ error: 'preview expired' });
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write(': connected\n\n');
    const since = Number(req.query.since ?? 0);
    for (const line of spec.terminal.recent(Number.isFinite(since) ? since : 0)) {
      res.write(`data: ${JSON.stringify(line)}\n\n`);
    }
    const unsubscribe = spec.terminal.subscribe((line) => res.write(`data: ${JSON.stringify(line)}\n\n`));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  });

  router.post('/preview/:id/api/terminal/probe', (req, res) => {
    const spec = getPreview(req.params.id);
    if (!spec) return res.status(404).json({ error: 'preview expired' });
    const now = Date.now();
    spec.terminal.push('device', `probing stub device … ${spec.metrics.length} metric(s) online`);
    for (const metric of spec.metrics) {
      spec.terminal.push('device', `${metric.id} = ${sampleValue(metric, now)} ${metric.unit} (field ${metric.jsonField})`);
    }
    res.json({ ok: true, metrics: spec.metrics.length });
  });

  // The terminal page itself. Relative URLs only — it lands on whatever host
  // and port this deployment is serving, nothing hard-coded.
  router.get('/preview/:id/terminal', (req, res) => {
    const spec = getPreview(req.params.id);
    if (!spec) return res.status(404).json({ error: 'preview expired — run the build again' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(previewTerminalPage(spec.projectName));
  });

  router.get('/preview/:id/api/health', (req, res) => {
    const spec = getPreview(req.params.id);
    if (!spec) return res.status(404).json({ error: 'preview expired' });
    res.json({ ok: true, service: 'wireup-preview-stub', project: spec.projectName });
  });

  router.get('/preview/:id/api/device/info', (req, res) => {
    const spec = getPreview(req.params.id);
    if (!spec) return res.status(404).json({ error: 'preview expired' });
    res.json({
      name: spec.slug,
      firmware: 'wireup-firmware-1.0.0 (preview stub)',
      transport: 'preview',
      board: spec.board,
      note: 'Values are generated from the resolved plan — no physical device is attached.',
    });
  });

  router.get('/preview/:id/api/capabilities', (req, res) => {
    const spec = getPreview(req.params.id);
    if (!spec) return res.status(404).json({ error: 'preview expired' });
    res.json({
      reads: [
        ...spec.metrics.map((metric) => ({
          id: metric.id,
          label: metric.label,
          path: '/api/sensors',
          method: 'GET',
          kind: 'json',
          unit: metric.unit,
          field: metric.jsonField,
        })),
        { id: 'status', label: 'Status', path: '/api/status', method: 'GET', kind: 'json' },
      ],
      controls: spec.controls.map((control) => ({
        id: control.id,
        label: control.label,
        path: `/api/control/${control.id}`,
        method: 'POST',
        kind: 'json',
        payload: true,
      })),
    });
  });

  router.get('/preview/:id/api/telemetry/live', (req, res) => {
    const spec = getPreview(req.params.id);
    if (!spec) return res.status(404).json({ error: 'preview expired' });
    const now = Date.now();
    res.json({ ts: new Date(now).toISOString(), ...livePayload(spec, now) });
  });

  router.get('/preview/:id/api/telemetry/history', (req, res) => {
    const spec = getPreview(req.params.id);
    if (!spec) return res.status(404).json({ error: 'preview expired' });
    const metricFilter = typeof req.query.metric === 'string' ? req.query.metric : undefined;
    const limitRaw = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : 200;
    const step = Math.max(spec.sampleIntervalMs, 1000);
    const now = Date.now();
    const wanted = metricFilter ? spec.metrics.filter((m) => m.id === metricFilter) : spec.metrics;

    const readings: unknown[] = [];
    const points = Math.max(1, Math.floor(limit / Math.max(wanted.length, 1)));
    for (let i = points - 1; i >= 0; i -= 1) {
      const t = now - i * step;
      for (const metric of wanted) {
        readings.push({
          metric: metric.id,
          value: sampleValue(metric, t),
          unit: metric.unit,
          createdAt: new Date(t).toISOString(),
        });
      }
    }
    res.json({ metric: metricFilter ?? null, readings });
  });

  router.post('/preview/:id/api/telemetry/control', express.json(), (req, res) => {
    const spec = getPreview(req.params.id);
    if (!spec) return res.status(404).json({ error: 'preview expired' });
    const endpoint = String((req.body as { endpoint?: unknown } | undefined)?.endpoint ?? '');
    const known = spec.controls.some((control) => control.id === endpoint);
    if (!known) return res.status(404).json({ error: `Unknown control endpoint: ${endpoint}` });
    // The preview accepts the command and echoes it — nothing is actuated,
    // and the UI is told so rather than being shown a fake success state.
    res.json({
      ok: true,
      result: { accepted: true, endpoint, payload: (req.body as { payload?: unknown }).payload, preview: true },
    });
  });

  // Anything else under a preview id is a static asset of the built bundle.
  router.use('/preview/:id', (req, res, next) => {
    const spec = getPreview(req.params.id);
    if (!spec) {
      res.status(404).json({ error: 'preview expired — run the build again' });
      return;
    }
    express.static(spec.dir, { index: 'index.html', fallthrough: true, maxAge: 0 })(req, res, () => {
      // SPA fallback: unknown paths render the dashboard shell.
      res.sendFile(path.join(spec.dir, 'index.html'), (error) => {
        if (error) next(error);
      });
    });
  });

  return router;
}

// ── The preview terminal page ───────────────────────────────────────────────

/**
 * Zero-dependency terminal page for a published preview. Stream and probe
 * use RELATIVE URLs, so the page works on any host/port the deployment is
 * reached through — nothing hard-coded, same rule as the generated scaffold.
 */
function previewTerminalPage(projectName: string): string {
  const safeName = projectName.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const style = [
    ':root { color-scheme: dark; }',
    '* { box-sizing: border-box; }',
    'body { margin: 0; background: #0b0f14; color: #d7e2ea; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; height: 100vh; display: flex; flex-direction: column; }',
    'header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #1d2a36; background: #0e141b; }',
    'header h1 { font-size: 12px; letter-spacing: 2px; margin: 0; color: #7fd1a8; }',
    '.name { color: #6b7f8f; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.state { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid #1d2a36; color: #6b7f8f; }',
    '.state.live { color: #7fd1a8; border-color: #245a41; }',
    '.state.dead { color: #e2726e; border-color: #5a2424; }',
    'button { font: inherit; font-size: 11px; background: #12202c; color: #d7e2ea; border: 1px solid #24435a; border-radius: 6px; padding: 4px 10px; cursor: pointer; }',
    'button:hover { background: #172a39; }',
    'button:disabled { opacity: 0.5; cursor: default; }',
    'main { flex: 1; overflow-y: auto; padding: 10px 14px; }',
    '.ln { white-space: pre-wrap; word-break: break-word; }',
    '.ln .at { color: #4d6273; margin-right: 10px; }',
    '.ln.boot { color: #e5c07b; }',
    '.ln.request { color: #8296a5; }',
    '.ln.device { color: #7fd1a8; }',
    '.ln.control { color: #61afef; }',
    '.ln.error { color: #e2726e; }',
    'footer { padding: 6px 14px; border-top: 1px solid #1d2a36; color: #4d6273; font-size: 11px; }',
  ];
  const script = [
    'var term = document.getElementById("term");',
    'var state = document.getElementById("state");',
    'var lastSeq = 0;',
    'function addLine(line) {',
    '  if (!line || typeof line !== "object") return;',
    '  if (typeof line.seq === "number") lastSeq = Math.max(lastSeq, line.seq);',
    '  var row = document.createElement("div");',
    '  row.className = "ln " + (line.kind || "info");',
    '  var at = document.createElement("span");',
    '  at.className = "at";',
    '  at.textContent = line.at || "";',
    '  var tx = document.createElement("span");',
    '  tx.textContent = line.text || "";',
    '  row.appendChild(at);',
    '  row.appendChild(tx);',
    '  var stick = term.scrollHeight - term.scrollTop - term.clientHeight < 48;',
    '  term.appendChild(row);',
    '  if (stick) term.scrollTop = term.scrollHeight;',
    '}',
    'function connect() {',
    '  var es = new EventSource("api/terminal/stream?since=" + lastSeq);',
    '  es.onopen = function () { state.textContent = "live"; state.className = "state live"; };',
    '  es.onmessage = function (event) {',
    '    try { addLine(JSON.parse(event.data)); } catch (e) { /* keep-alive */ }',
    '  };',
    '  es.onerror = function () {',
    '    state.textContent = "reconnecting…";',
    '    state.className = "state dead";',
    '    es.close();',
    '    setTimeout(connect, 1500);',
    '  };',
    '}',
    'document.getElementById("probe").addEventListener("click", function () {',
    '  var btn = this;',
    '  btn.disabled = true;',
    '  fetch("api/terminal/probe", { method: "POST" }).finally(function () { btn.disabled = false; });',
    '});',
    'document.getElementById("clear").addEventListener("click", function () { term.replaceChildren(); });',
    'connect();',
  ];
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>' + safeName + ' — preview terminal</title>',
    '<style>' + style.join('') + '</style>',
    '</head>',
    '<body>',
    '<header>',
    '<h1>DEVICE TERMINAL</h1>',
    '<span class="name">' + safeName + ' · preview stub</span>',
    '<span class="state" id="state">connecting…</span>',
    '<button id="probe" type="button">Probe device</button>',
    '<button id="clear" type="button">Clear</button>',
    '</header>',
    '<main id="term" role="log" aria-live="polite"></main>',
    '<footer>Live feed of this preview\'s stub API and device probes. The shipped zip runs the real Express backend with this same terminal on your own machine — on whatever port it binds.</footer>',
    '<script>' + script.join('') + '</script>',
    '</body>',
    '</html>',
  ].join('\n');
}
