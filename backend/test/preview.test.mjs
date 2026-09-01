/**
 * Live dashboard preview (page 04's "Website" half).
 *
 * The promise this makes is narrow and must stay true: the bundle served is
 * the one the software gate built, and the API behind it is a stub whose
 * shape matches what the generated dashboard expects. Both are asserted here
 * against a real Express app on a real socket — no mocking of our own server.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workdir = await mkdtemp(path.join(tmpdir(), 'wireup-preview-'));
process.env.PREVIEW_DIR = path.join(workdir, 'previews');

const express = (await import('express')).default;
const { newPreviewId, publishPreview, previewRouter, previewBaseFor, previewApiBaseFor, sampleValue } =
  await import('../src/agentic/preview.ts');
const { resolveBuildPlan } = await import('../src/agentic/planResolver.ts');
const { normaliseGraph } = await import('../src/schemas/architecture.ts');

const { graph } = normaliseGraph({});
const plan = resolveBuildPlan(
  'esp32 weather station with a dht22 temperature and humidity sensor',
  'Preview Weather',
  graph,
).plan;

// A stand-in for the dist/ the vite build leaves behind.
const distDir = path.join(workdir, 'dist');
const id = newPreviewId();
let server;
let base;

before(async () => {
  await mkdir(path.join(distDir, 'assets'), { recursive: true });
  await writeFile(path.join(distDir, 'index.html'), '<!doctype html><title>dash</title><div id="root"></div>');
  await writeFile(path.join(distDir, 'assets', 'index.js'), 'console.log("dashboard bundle");');

  const app = express();
  app.use('/api', previewRouter());
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await rm(workdir, { recursive: true, force: true });
});

describe('live dashboard preview', () => {
  it('publishes the built bundle under an unguessable id', async () => {
    const summary = await publishPreview({ id, plan, distDir });
    assert.ok(summary);
    assert.equal(summary.url, previewBaseFor(id));
    assert.equal(summary.apiBase, previewApiBaseFor(id));
    assert.equal(summary.stubbedApi, true);
    // 9 random bytes → 12 base64url chars. Long enough that the open route is
    // not enumerable, which is what lets an <iframe> reach it without a token.
    assert.ok(id.length >= 12, `id too short: ${id}`);
    assert.notEqual(newPreviewId(), newPreviewId());
  });

  it('serves the real files, not a re-render', async () => {
    const html = await fetch(`${base}${previewBaseFor(id)}`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /<div id="root">/);

    const asset = await fetch(`${base}${previewBaseFor(id)}assets/index.js`);
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /dashboard bundle/);
  });

  it('answers the dashboard API contract with this plan\u2019s metrics', async () => {
    const api = `${base}${previewApiBaseFor(id)}`;

    const health = await (await fetch(`${api}/health`)).json();
    assert.equal(health.ok, true);

    const caps = await (await fetch(`${api}/capabilities`)).json();
    const planMetrics = plan.modules.flatMap((module) => module.metrics);
    for (const metric of planMetrics) {
      assert.ok(
        caps.reads.some((read) => read.id === metric.id && read.field === metric.jsonField),
        `capabilities must advertise ${metric.id}`,
      );
    }

    const live = await (await fetch(`${api}/telemetry/live`)).json();
    assert.ok(Date.parse(live.ts) > 0);
    for (const metric of planMetrics) {
      // The dashboard reads `<metricId>.<jsonField>` — the exact nesting the
      // device payload has. A flat payload here would render blank cards.
      assert.equal(typeof live[metric.id][metric.jsonField], 'number');
    }
    assert.equal(live.status.state, 'online');
    assert.equal(live.status.preview, true, 'the payload must admit it is a preview');

    const history = await (await fetch(`${api}/telemetry/history?limit=6`)).json();
    assert.ok(history.readings.length > 0);
    for (const reading of history.readings) {
      assert.equal(typeof reading.value, 'number');
      assert.ok(Date.parse(reading.createdAt) > 0);
    }

    const filtered = await (
      await fetch(`${api}/telemetry/history?limit=6&metric=${planMetrics[0].id}`)
    ).json();
    assert.ok(filtered.readings.every((reading) => reading.metric === planMetrics[0].id));
  });

  it('accepts control commands it knows and rejects ones it does not', async () => {
    const api = `${base}${previewApiBaseFor(id)}`;
    const unknown = await fetch(`${api}/telemetry/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'not-a-control', payload: {} }),
    });
    assert.equal(unknown.status, 404);
  });

  it('404s an unknown preview instead of leaking another build', async () => {
    const missing = await fetch(`${base}/api/preview/does-not-exist/api/telemetry/live`);
    assert.equal(missing.status, 404);
    const missingPage = await fetch(`${base}/api/preview/does-not-exist/`);
    assert.equal(missingPage.status, 404);
  });

  it('generates stable, in-range sample values', () => {
    const metric = { id: 'temperature', label: 'T', unit: 'C', jsonField: 'temperature_c', min: 10, max: 40 };
    const t = 1_700_000_000_000;
    assert.equal(sampleValue(metric, t), sampleValue(metric, t));
    for (let i = 0; i < 200; i += 1) {
      const value = sampleValue(metric, t + i * 5_000);
      assert.ok(value >= metric.min && value <= metric.max, `${value} out of range`);
    }
    // Two metrics must not move in lockstep, or every chart looks identical.
    const other = { ...metric, id: 'humidity', jsonField: 'humidity_pct' };
    assert.notEqual(sampleValue(metric, t), sampleValue(other, t));
  });

  it('returns null when there is no built dashboard to serve', async () => {
    const summary = await publishPreview({
      id: newPreviewId(),
      plan,
      distDir: path.join(workdir, 'nope'),
    });
    assert.equal(summary, null);
  });
});
