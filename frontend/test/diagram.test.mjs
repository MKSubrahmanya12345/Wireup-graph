/**
 * The bench must draw the diagram the pipeline really produced — both the
 * Wokwi v1 tuples and the Wireup universal v2 objects — and it must never
 * substitute a lookalike part for one it has no model of.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

const { parseDiagram, diagramFromFiles, samplesFromLog, tagForType } = await import(
  '../src/sim/diagram.ts'
);

const universal = readFileSync(new URL('../public/hardware/universal-diagram.json', import.meta.url), 'utf8');

const wokwiV1 = JSON.stringify({
  version: 1,
  author: 'Wireup',
  parts: [
    { type: 'board-esp32-devkit-v1', id: 'esp', attrs: {} },
    { type: 'wokwi-dht22', id: 'dht_1', attrs: {} },
  ],
  connections: [
    ['dht_1', 'VCC', 'esp', '3V3'],
    ['dht_1', 'SDA', 'esp', '4'],
  ],
});

describe('bench diagram parsing', () => {
  it('reads the universal v2 diagram, parts and object connections', () => {
    const diagram = parseDiagram(universal, 'hardware/universal-diagram.json');
    assert.ok(diagram);
    assert.equal(diagram.version, 2);
    assert.deepEqual(
      diagram.parts.map((p) => p.id),
      ['esp', 'dht_1', 'pullup_1w_1'],
    );
    assert.equal(diagram.connections.length, 4);
    const power = diagram.connections[0];
    assert.equal(power.fromPart, 'dht_1');
    assert.equal(power.toPart, 'esp');
    assert.equal(power.net, '+3V3');
  });

  it('reads Wokwi v1 tuple connections', () => {
    const diagram = parseDiagram(wokwiV1, 'diagram.json');
    assert.ok(diagram);
    assert.equal(diagram.connections.length, 2);
    assert.deepEqual(diagram.connections[1], {
      fromPart: 'dht_1',
      fromPin: 'SDA',
      toPart: 'esp',
      toPin: '4',
      net: '4',
    });
  });

  it('maps part types to real registered custom elements only', () => {
    assert.equal(tagForType('board-esp32-devkit-v1').tag, 'wokwi-esp32-devkit-v1');
    assert.equal(tagForType('wokwi-dht22').tag, 'wokwi-dht22');
    // resistor-10k has no element of its own — it renders as a valued resistor.
    assert.deepEqual(tagForType('resistor-10k'), { tag: 'wokwi-resistor', attrs: { value: '10k' } });
    // No @wokwi/elements model exists for these: they must stay unrendered,
    // NOT be swapped for a different-looking part.
    assert.equal(tagForType('wokwi-bme280').tag, null);
    assert.equal(tagForType('wokwi-ds18b20').tag, null);
  });

  it('only maps to custom element tags @wokwi/elements really registers', () => {
    // Guards against typo'd tags: a wrong tag renders as an invisible unknown
    // element, which would look like a bug in the diagram, not in this map.
    const dir = new URL('../node_modules/@wokwi/elements/dist/esm/', import.meta.url);
    let registered;
    try {
      registered = new Set(
        readdirSync(dir)
          .filter((name) => name.endsWith('-element.js'))
          .flatMap((name) => [...readFileSync(new URL(name, dir), 'utf8').matchAll(/customElement\('([a-z0-9-]+)'\)/g)])
          .map((match) => match[1]),
      );
    } catch {
      return; // package not installed in this environment — nothing to check
    }
    assert.ok(registered.size > 10, 'expected to find the wokwi element registry');
    for (const type of ['board-esp32-devkit-v1', 'wokwi-dht22', 'wokwi-relay-module', 'resistor-10k', 'wokwi-led']) {
      const { tag } = tagForType(type);
      assert.ok(tag && registered.has(tag), `${type} → ${tag} is not a registered element`);
    }
  });

  it('reports part types it cannot draw', () => {
    const diagram = parseDiagram(
      JSON.stringify({ version: 2, parts: [{ type: 'wokwi-ds18b20', id: 'ds_1' }], connections: [] }),
      'diagram.json',
    );
    assert.ok(diagram);
    assert.deepEqual(diagram.unrendered, ['wokwi-ds18b20']);
    assert.equal(diagram.parts[0].tag, null);
  });

  it('prefers the universal diagram out of the firmware file list', () => {
    const diagram = diagramFromFiles([
      { path: 'src/main.cpp', content: 'int main(){}' },
      { path: 'diagram.json', content: wokwiV1 },
      { path: 'hardware/universal-diagram.json', content: universal },
    ]);
    assert.ok(diagram);
    assert.equal(diagram.source, 'hardware/universal-diagram.json');
  });

  it('survives a malformed or diagram-less build', () => {
    assert.equal(parseDiagram('not json', 'diagram.json'), null);
    assert.equal(diagramFromFiles([{ path: 'src/main.cpp', content: '' }]), null);
  });

  it('replays sensor samples out of the hardware sim log', () => {
    const samples = samplesFromLog([
      'virtual-bench: POST ok — rail stable, brown-out detector armed',
      'virtual-bench: sample temperatureC = 24.8 C',
      'virtual-bench: sample humidityPct = 51.2 %',
    ]);
    assert.deepEqual(samples, [
      { field: 'temperatureC', value: '24.8', unit: 'C' },
      { field: 'humidityPct', value: '51.2', unit: '%' },
    ]);
    assert.deepEqual(samplesFromLog(undefined), []);
  });
});
