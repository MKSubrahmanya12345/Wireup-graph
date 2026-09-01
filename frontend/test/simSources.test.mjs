/**
 * Page 04's decisions, tested without a browser.
 *
 * The swap button is only useful if each half knows whether it has anything to
 * show — an iframe pointed at nothing looks like a broken product, so the page
 * asks these functions first and renders the reason instead.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { velxioArtifact, previewTarget, previewBlockedReason, chooseEngine } = await import(
  '../src/lib/simSources.ts'
);

const vlxContent = JSON.stringify({
  format: 'velxio-project',
  version: 1,
  boards: [{ id: 'board-1', boardKind: 'esp32' }],
  components: [{ id: 'dht_1', metadataId: 'dht22' }],
  wires: [{ id: 'wire-1' }, { id: 'wire-2' }],
});

const buildResult = {
  projectName: 'Weather',
  slug: 'weather',
  firmware: {
    board: 'ESP32 DevKit v1',
    files: [
      { path: 'platformio.ini', content: '' },
      { path: 'simulation/weather.vlx', content: vlxContent },
    ],
  },
  preview: {
    id: 'abc',
    url: '/api/preview/abc/',
    apiBase: '/api/preview/abc/api',
    publishedAt: '2026-09-01T00:00:00.000Z',
    stubbedApi: true,
    note: 'real bundle, stub device API',
  },
};

describe('page 04 sources', () => {
  it('finds the Velxio project the build shipped', () => {
    const vlx = velxioArtifact(buildResult);
    assert.ok(vlx);
    assert.equal(vlx.filename, 'weather.vlx');
    assert.equal(vlx.path, 'simulation/weather.vlx');
    assert.equal(vlx.parts, 1);
    assert.equal(vlx.wires, 2);
    assert.equal(vlx.boardKind, 'esp32');
  });

  it('refuses anything that is not a velxio project', () => {
    const notVelxio = {
      ...buildResult,
      firmware: { ...buildResult.firmware, files: [{ path: 'x.vlx', content: '{"format":"wokwi"}' }] },
    };
    assert.equal(velxioArtifact(notVelxio), null);
    const broken = {
      ...buildResult,
      firmware: { ...buildResult.firmware, files: [{ path: 'x.vlx', content: 'not json' }] },
    };
    assert.equal(velxioArtifact(broken), null);
    assert.equal(velxioArtifact(null), null);
  });

  it('reads the live preview target, and explains its absence', () => {
    const target = previewTarget(buildResult);
    assert.ok(target);
    assert.equal(target.url, '/api/preview/abc/');

    assert.equal(previewTarget(null), null);
    assert.match(previewBlockedReason(null), /Run the agentic build/i);

    const noPreview = { ...buildResult, preview: null };
    assert.equal(previewTarget(noPreview), null);
    assert.match(previewBlockedReason(noPreview), /Re-run the build/i);
  });

  it('embeds Velxio only when this deployment actually has one', () => {
    const withVelxio = { velxio: { configured: true, embedUrl: 'http://localhost:3000' } };
    const without = { velxio: { configured: false, embedUrl: null } };

    // Default: whatever is available.
    assert.equal(chooseEngine(withVelxio, null), 'velxio');
    assert.equal(chooseEngine(without, null), 'native');
    assert.equal(chooseEngine(null, null), 'native');

    // A user preference is honoured — except asking for an instance that is
    // not configured, which must fall back rather than iframe `null`.
    assert.equal(chooseEngine(withVelxio, 'native'), 'native');
    assert.equal(chooseEngine(without, 'velxio'), 'native');
    assert.equal(chooseEngine(withVelxio, 'velxio'), 'velxio');
  });
});
