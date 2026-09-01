/**
 * Canvas → diagram.json reverse sync (the pull half of the bidirectional
 * bridge). Asserted without a browser: pure data in, pure data out.
 *
 * The invariants that matter:
 *   1. A canvas wire moved to a different GPIO lands in diagram.json with the
 *      plan's net vocabulary (D5 → "5", GND.2 → "GND.0", VIN → "5V").
 *   2. Parts the canvas does not manage (the board, pull-up resistors) are
 *      preserved byte-for-byte — the sync never touches what it cannot see.
 *   3. A canvas part with no Wireup mapping is REPORTED, never invented.
 *   4. A part deleted on the canvas disappears from parts AND connections.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { applyCanvasToArtifacts, planNetFromBoardPin } = await import('../src/lib/vlxSync.ts');

const baseDiagram = {
  version: 2,
  format: 'wireup-universal',
  author: 'Wireup',
  sourcePlan: 'dht22-monitor',
  parts: [
    { type: 'board-esp32-devkit-v1', id: 'esp', role: 'mcu', model: 'esp', attrs: {} },
    { type: 'wokwi-dht22', id: 'dht_1', role: 'sensor', model: 'dht', attrs: {} },
    { type: 'resistor-4k7', id: 'pullup_sda_1', role: 'passive', model: '4.7k', attrs: { value: '4.7k' } },
  ],
  connections: [
    { from: { partId: 'dht_1', pin: 'VCC' }, to: { partId: 'esp', pin: '3V3' }, net: '3V3' },
    { from: { partId: 'dht_1', pin: 'SDA' }, to: { partId: 'esp', pin: '4' }, net: '4' },
    { from: { partId: 'dht_1', pin: 'GND' }, to: { partId: 'esp', pin: 'GND.0' }, net: 'GND.0' },
    { from: { partId: 'pullup_sda_1', pin: '1' }, to: { partId: 'dht_1', pin: 'SDA' }, net: '3V3' },
  ],
};

function filesWith(diagram) {
  return [
    { path: 'diagram.json', content: JSON.stringify(diagram) },
    { path: 'hardware/universal-diagram.json', content: JSON.stringify(diagram) },
    { path: 'simulation/dht22-monitor.vlx', content: '{}' },
  ];
}

function canvasPayload(overrides = {}) {
  return {
    format: 'velxio-project',
    version: 1,
    name: 'DHT22 Monitor',
    boards: [{ id: 'board-1', boardKind: 'esp32', activeFileGroupId: 'group-1' }],
    fileGroups: { 'group-1': [{ name: 'sketch.ino', content: '// sketch' }] },
    components: [{ id: 'dht_1', metadataId: 'dht22', x: 0, y: 0, properties: {} }],
    wires: [
      { id: 'w1', start: { componentId: 'dht_1', pinName: 'VCC' }, end: { componentId: 'board-1', pinName: '3V3' } },
      { id: 'w2', start: { componentId: 'dht_1', pinName: 'SDA' }, end: { componentId: 'board-1', pinName: 'D5' } },
      { id: 'w3', start: { componentId: 'board-1', pinName: 'GND.2' }, end: { componentId: 'dht_1', pinName: 'GND' } },
    ],
    activeBoardId: 'board-1',
    ...overrides,
  };
}

describe('board-pin → plan-net translation (inverse of the exporter)', () => {
  it('translates every pin family', () => {
    assert.equal(planNetFromBoardPin('D4'), '4');
    assert.equal(planNetFromBoardPin('D21'), '21');
    assert.equal(planNetFromBoardPin('GND.1'), 'GND.0');
    assert.equal(planNetFromBoardPin('GND.2'), 'GND.0');
    assert.equal(planNetFromBoardPin('3V3'), '3V3');
    assert.equal(planNetFromBoardPin('VIN'), '5V');
  });
});

describe('canvas pull → diagram.json', () => {
  it('moves a rewired pin into the diagram with plan-net names', () => {
    const sync = applyCanvasToArtifacts(canvasPayload(), filesWith(baseDiagram));
    assert.ok(sync, 'sync must produce updates');
    const diagram = JSON.parse(sync.updates.find((u) => u.path === 'diagram.json').content);

    const sda = diagram.connections.find((c) => c.from.partId === 'dht_1' && c.from.pin === 'SDA');
    assert.equal(sda.net, '5', 'the canvas moved SDA from GPIO4 to GPIO5');
    const gnd = diagram.connections.find((c) => c.from.partId === 'dht_1' && c.from.pin === 'GND');
    assert.equal(gnd.net, 'GND.0', 'board GND.2 must come back as the plan\u2019s GND.0');
    // Wire direction was board→part on the canvas; diagram always points at the board.
    assert.equal(gnd.to.partId, 'esp');
  });

  it('preserves the board and unmanaged passives untouched', () => {
    const sync = applyCanvasToArtifacts(canvasPayload(), filesWith(baseDiagram));
    const diagram = JSON.parse(sync.updates.find((u) => u.path === 'diagram.json').content);
    assert.ok(diagram.parts.some((p) => p.id === 'esp' && p.type === 'board-esp32-devkit-v1'));
    assert.ok(diagram.parts.some((p) => p.id === 'pullup_sda_1' && p.attrs.value === '4.7k'));
    // The pull-up's own wire survives because dht_1 still exists.
    assert.ok(diagram.connections.some((c) => c.from.partId === 'pullup_sda_1'));
  });

  it('reports unmapped canvas parts instead of inventing them', () => {
    const payload = canvasPayload({
      components: [
        { id: 'dht_1', metadataId: 'dht22', x: 0, y: 0, properties: {} },
        { id: 'mystery_1', metadataId: 'flux-capacitor', x: 0, y: 0, properties: {} },
      ],
    });
    const sync = applyCanvasToArtifacts(payload, filesWith(baseDiagram));
    assert.deepEqual(sync.unmapped, ['mystery_1 (flux-capacitor)']);
    const diagram = JSON.parse(sync.updates.find((u) => u.path === 'diagram.json').content);
    assert.ok(!diagram.parts.some((p) => p.id === 'mystery_1'));
    assert.match(sync.summary, /flux-capacitor/);
  });

  it('drops a part deleted on the canvas, and every wire that touched it', () => {
    const payload = canvasPayload({ components: [], wires: [] });
    const sync = applyCanvasToArtifacts(payload, filesWith(baseDiagram));
    const diagram = JSON.parse(sync.updates.find((u) => u.path === 'diagram.json').content);
    assert.ok(!diagram.parts.some((p) => p.id === 'dht_1'));
    assert.ok(!diagram.connections.some((c) => c.from.partId === 'dht_1' || c.to.partId === 'dht_1'));
    // The pull-up wire pointed at dht_1 — it must not survive as a dangler.
    assert.ok(!diagram.connections.some((c) => c.from.partId === 'pullup_sda_1'));
  });

  it('rewrites the .vlx artifact and the universal twin in the same pull', () => {
    const sync = applyCanvasToArtifacts(canvasPayload(), filesWith(baseDiagram));
    const paths = sync.updates.map((u) => u.path).sort();
    assert.deepEqual(paths, ['diagram.json', 'hardware/universal-diagram.json', 'simulation/dht22-monitor.vlx']);
    const d1 = sync.updates.find((u) => u.path === 'diagram.json').content;
    const d2 = sync.updates.find((u) => u.path === 'hardware/universal-diagram.json').content;
    assert.equal(d1, d2, 'the two diagram copies must never drift');
  });
});
