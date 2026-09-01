/**
 * Velxio project export (.vlx) — the artifact that opens this build's circuit
 * in the Velxio emulator (external/velxio, AGPL-3.0).
 *
 * The point of these checks: the exported project must describe the SAME
 * circuit the firmware drives. A wire that lands on a pin the board element
 * does not have is silently dropped on import, which would look like Wireup
 * generated a wrong circuit — so pin translation is asserted explicitly.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { resolveBuildPlan } = await import('../src/agentic/planResolver.ts');
const { normaliseGraph } = await import('../src/schemas/architecture.ts');
const { synthesizeFirmware } = await import('../src/agentic/firmwareSynth.ts');
const { generateVelxioProject, velxioBoardPin } = await import('../src/agentic/velxioProject.ts');

function planFor(brief, name) {
  const { graph } = normaliseGraph({});
  return resolveBuildPlan(brief, name, graph).plan;
}

const sketch = { name: 'sketch.ino', content: 'void setup(){}\nvoid loop(){}\n' };

describe('velxio project export', () => {
  it('emits a valid velxio-project v1 document', () => {
    const plan = planFor('esp32 weather station with a dht22 temperature and humidity sensor', 'Weather');
    const { project } = generateVelxioProject(plan, sketch);

    assert.equal(project.format, 'velxio-project');
    assert.equal(project.version, 1);
    assert.equal(project.boards.length, 1);
    assert.equal(project.activeBoardId, project.boards[0].id);
    assert.equal(project.boards[0].boardKind, 'esp32');
    assert.equal(project.boards[0].languageMode, 'arduino');
    assert.equal(project.boards[0].serialBaudRate, 115_200);
    // The board points at a file group that must exist and hold the sketch.
    const group = project.fileGroups[project.boards[0].activeFileGroupId];
    assert.ok(Array.isArray(group) && group.length >= 1);
    assert.equal(group[0].name, 'sketch.ino');
    assert.match(group[0].content, /void setup\(\)/);
    assert.ok(Date.parse(project.exportedAt) > 0);
  });

  it('places the plan\u2019s parts and wires them to pins the board really has', () => {
    const plan = planFor('esp32 weather station with a dht22 sensor', 'Weather');
    const { project } = generateVelxioProject(plan, sketch);

    const dht = project.components.find((component) => component.metadataId === 'dht22');
    assert.ok(dht, 'the DHT22 must be placed on the canvas');

    assert.ok(project.wires.length >= 3, 'power, ground and data must all be wired');
    // Every wire ends on the board, at a pin name the ESP32 devkit element
    // actually exposes (D<n> / 3V3 / VIN / GND.1 / GND.2) — never a bare GPIO
    // number or "GND.0", which the importer would drop on the floor.
    const validBoardPin = /^(D\d+|3V3|VIN|GND\.[12]|VP|VN|EN|RX[02]|TX[02])$/;
    for (const wire of project.wires) {
      assert.equal(wire.end.componentId, project.boards[0].id);
      assert.match(wire.end.pinName, validBoardPin, `bad board pin: ${wire.end.pinName}`);
      assert.ok(
        project.components.some((component) => component.id === wire.start.componentId),
        'a wire may not start on a component that was never placed',
      );
    }

    // The data wire must land on the GPIO the firmware actually reads.
    const dataPin = plan.modules[0].pins.data ?? Object.values(plan.modules[0].pins)[0];
    const expected = `D${String(dataPin).replace(/^GPIO/i, '')}`;
    assert.ok(
      project.wires.some((wire) => wire.end.pinName === expected),
      `expected a wire to ${expected} (plan pin ${dataPin})`,
    );

    const ground = project.wires.find((wire) => wire.signalType === 'power-gnd');
    assert.ok(ground, 'ground must be classified as power-gnd');
    assert.equal(ground.end.pinName, 'GND.1');
  });

  it('translates plan nets to board pin names', () => {
    assert.equal(velxioBoardPin('4'), 'D4');
    assert.equal(velxioBoardPin('GPIO21'), 'D21');
    assert.equal(velxioBoardPin('GND.0'), 'GND.1');
    assert.equal(velxioBoardPin('GND'), 'GND.1');
    assert.equal(velxioBoardPin('3V3'), '3V3');
    assert.equal(velxioBoardPin('5V'), 'VIN');
    assert.equal(velxioBoardPin('nonsense'), null);
  });

  it('reports parts Velxio cannot model instead of substituting one', () => {
    const plan = planFor('esp32 air quality monitor with an mq2 gas sensor', 'Air');
    const { project, unsupported } = generateVelxioProject(plan, sketch);
    for (const component of project.components) {
      assert.ok(component.metadataId && !component.metadataId.startsWith('wokwi-'));
    }
    // Whatever the plan pulled in, nothing unmodelled may appear as a part.
    assert.ok(Array.isArray(unsupported));
  });

  it('ships inside the firmware zip of every build', () => {
    const plan = planFor('esp32 weather station with a dht22 sensor', 'Weather');
    const firmware = synthesizeFirmware(plan);
    const file = firmware.files.find((entry) => entry.path.endsWith('.vlx'));
    assert.ok(file, 'firmware artifacts must include the .vlx project');
    assert.equal(file.path, `simulation/${plan.slug}.vlx`);
    const parsed = JSON.parse(file.content);
    assert.equal(parsed.format, 'velxio-project');
    // The sketch inside the .vlx must be the sketch that was shipped.
    const ino = firmware.files.find((entry) => entry.path.endsWith(`${plan.slug}.ino`));
    const group = parsed.fileGroups[parsed.boards[0].activeFileGroupId];
    assert.equal(group[0].content, ino.content);
    // Every project-local header the sketch #includes must travel with it —
    // Velxio compiles only the group's files, so a missing config.h means the
    // emulator cannot produce a runnable firmware at all.
    const configFile = firmware.files.find((entry) => entry.path === 'firmware/config.h');
    const shippedHeader = group.find((entry) => entry.name === 'config.h');
    assert.ok(shippedHeader, 'config.h must ship inside the .vlx file group');
    assert.equal(shippedHeader.content, configFile.content);
  });

  it('differs between two different devices', () => {
    const weather = generateVelxioProject(planFor('esp32 dht22 weather station', 'Weather'), sketch);
    const motion = generateVelxioProject(planFor('esp32 pir motion alarm with a buzzer', 'Motion'), sketch);
    assert.notDeepEqual(
      weather.project.components.map((c) => c.metadataId),
      motion.project.components.map((c) => c.metadataId),
    );
  });
});
