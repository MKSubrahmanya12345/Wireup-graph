import type { ArchitectureGraph } from '../schemas/architecture.js';
import type { RequirementsSpec } from '../schemas/requirements.js';
import { isPowerSource, resolvePart, usableTorque, type PartSpec } from './partLibrary.js';

export type Severity = 'error' | 'warning' | 'notice';

export interface Issue {
  id: string;
  severity: Severity;
  code: string;
  title: string;
  detail: string;
  scope: 'node' | 'connection' | 'graph';
  targetId?: string;
  remedy?: string;
  evidence?: Record<string, string | number>;
}

/** Pulls a voltage out of labels like "5V Output" or "3.3 V". */
function parseVoltage(label: string | null | undefined): number | undefined {
  if (!label) return undefined;
  const match = label.match(/(\d+(?:\.\d+)?)\s*v/i);
  return match ? Number(match[1]) : undefined;
}

function nominalDraw(spec: PartSpec | undefined): number {
  return spec?.currentTypMa ?? 0;
}

/**
 * Deterministic engineering validation. No LLM, no tokens, no opinions —
 * just arithmetic over the machine-readable part library.
 */
export function runEngineeringChecks(
  graph: ArchitectureGraph,
  requirements?: RequirementsSpec | null,
): Issue[] {
  const issues: Issue[] = [];
  const { nodes, connections } = graph;

  const specFor = new Map<string, PartSpec | undefined>();
  for (const node of nodes) specFor.set(node.id, resolvePart(node.partNumber));

  const degree = new Map<string, number>();
  for (const node of nodes) degree.set(node.id, 0);
  for (const connection of connections) {
    degree.set(connection.from, (degree.get(connection.from) ?? 0) + 1);
    degree.set(connection.to, (degree.get(connection.to) ?? 0) + 1);
  }

  // ---- 1. Orphaned components -------------------------------------------
  for (const node of nodes) {
    if ((degree.get(node.id) ?? 0) > 0) continue;
    const spec = specFor.get(node.id);
    const isSourceish = isPowerSource(spec, node.type, node.id, node.name);
    issues.push({
      id: `orphan-${node.id}`,
      severity: isSourceish ? 'error' : 'warning',
      code: 'ORPHAN_NODE',
      title: 'Component is not connected to anything',
      detail: isSourceish
        ? `${node.name} is a power source but has no connections, so nothing in this design is actually powered.`
        : `${node.name} has no connections. Either wire it up or remove it.`,
      scope: 'node',
      targetId: node.id,
      remedy: isSourceish
        ? 'Connect it through the power chain: source → charger → regulator → loads.'
        : 'Add the missing connections, or delete the component.',
    });
  }

  // ---- 2. Power reachability --------------------------------------------
  // Undirected traversal over power/ground edges: a load is powered only if it
  // is connected back to a source.
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a)!.push(b);
  };
  for (const connection of connections) {
    if (connection.kind !== 'power' && connection.kind !== 'ground') continue;
    link(connection.from, connection.to);
    link(connection.to, connection.from);
  }

  const sources = nodes.filter((node) => isPowerSource(specFor.get(node.id), node.type, node.id, node.name));
  const reached = new Set<string>();
  const queue = sources.map((node) => node.id);
  while (queue.length) {
    const current = queue.shift()!;
    if (reached.has(current)) continue;
    reached.add(current);
    for (const next of adjacency.get(current) ?? []) if (!reached.has(next)) queue.push(next);
  }

  const loads = nodes.filter((node) => {
    const spec = specFor.get(node.id);
    return !isPowerSource(spec, node.type, node.id, node.name) && nominalDraw(spec) > 0;
  });

  const unpowered = loads.filter((node) => !reached.has(node.id));
  if (unpowered.length) {
    const totalMa = unpowered.reduce((sum, node) => sum + nominalDraw(specFor.get(node.id)), 0);
    issues.push({
      id: 'power-unreachable',
      severity: 'error',
      code: 'POWER_CHAIN_BROKEN',
      title: 'No power path from a source to the loads',
      detail:
        sources.length === 0
          ? 'This design has no power source at all.'
          : `${unpowered.length} load(s) totalling ~${totalMa} mA have no electrical path back to ${sources.map((s) => s.name).join(', ')}.`,
      scope: 'graph',
      remedy: 'Wire source → charger → regulator → loads with power and ground connections.',
      evidence: { unpowered: unpowered.map((node) => node.id).join(','), loadMa: totalMa },
    });
  }

  // ---- 3. Supply overcurrent --------------------------------------------
  for (const node of nodes) {
    const spec = specFor.get(node.id);
    const limitMa = spec?.outputMaxMa ?? spec?.maxContinuousMa;
    if (!limitMa) continue;

    const fedLoads = connections
      .filter((connection) => connection.from === node.id && connection.kind === 'power')
      .map((connection) => nodes.find((candidate) => candidate.id === connection.to))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

    const drawMa = fedLoads.reduce((sum, load) => sum + nominalDraw(specFor.get(load.id)), 0);
    if (drawMa <= limitMa) continue;

    issues.push({
      id: `overcurrent-${node.id}`,
      severity: 'error',
      code: 'SUPPLY_OVERCURRENT',
      title: 'Supply is undersized for its loads',
      detail: `${node.name} is rated for ${limitMa} mA but its connected loads draw about ${drawMa} mA (${(drawMa / limitMa).toFixed(1)}× over). It will hit current limit or thermal shutdown.`,
      scope: 'node',
      targetId: node.id,
      remedy: `Use a supply rated for at least ${Math.ceil((drawMa * 1.3) / 100) * 100} mA (30% headroom), or split the loads across rails.`,
      evidence: { limitMa, drawMa, overBy: drawMa - limitMa },
    });
  }

  // ---- 4. Voltage domain mismatch ---------------------------------------
  for (const connection of connections) {
    if (connection.kind !== 'power') continue;
    const sourceNode = nodes.find((node) => node.id === connection.from);
    const targetNode = nodes.find((node) => node.id === connection.to);
    if (!sourceNode || !targetNode) continue;

    const port = sourceNode.ports.find((candidate) => candidate.id === connection.fromPort);
    const railV = parseVoltage(port?.label);
    const targetSpec = specFor.get(targetNode.id);
    if (railV === undefined || !targetSpec?.supplyMinV || !targetSpec?.supplyMaxV) continue;

    if (railV >= targetSpec.supplyMinV && railV <= targetSpec.supplyMaxV) continue;

    issues.push({
      id: `voltage-${connection.id}`,
      severity: 'error',
      code: 'VOLTAGE_MISMATCH',
      title: 'Rail voltage is outside the load operating range',
      detail: `${sourceNode.name} supplies ${railV} V, but ${targetNode.name} requires ${targetSpec.supplyMinV}–${targetSpec.supplyMaxV} V.`,
      scope: 'connection',
      targetId: connection.id,
      remedy: 'Add a regulator or level shifter, or move the load to a different rail.',
      evidence: { railV, minV: targetSpec.supplyMinV, maxV: targetSpec.supplyMaxV },
    });
  }

  // ---- 5. Single-output regulator modelled with several rails -----------
  for (const node of nodes) {
    const spec = specFor.get(node.id);
    if (spec?.kind !== 'regulator' || spec.outputs !== 1) continue;

    const railVoltages = new Set<number>();
    for (const port of node.ports) {
      if (port.direction === 'in') continue;
      const volts = parseVoltage(port.label);
      if (volts !== undefined) railVoltages.add(volts);
    }
    if (railVoltages.size < 2) continue;

    issues.push({
      id: `multi-rail-${node.id}`,
      severity: 'error',
      code: 'MULTI_OUTPUT_REGULATOR',
      title: 'Single-output regulator is modelled with several voltage rails',
      detail: `${node.name} provides one output, but the design uses it for ${[...railVoltages].sort((a, b) => a - b).map((v) => `${v} V`).join(' and ')}. One part cannot produce both.`,
      scope: 'node',
      targetId: node.id,
      remedy: 'Add a second regulator (or a buck for 5 V plus an LDO for 3.3 V).',
      evidence: { rails: [...railVoltages].join(',') },
    });
  }

  // ---- 6. Servo rail needs bulk capacitance -----------------------------
  const servos = nodes.filter((node) => specFor.get(node.id)?.kind === 'servo');
  const hasBulkCap = nodes.some((node) =>
    /capacitor|cap\b|electrolytic/i.test(`${node.name} ${node.partNumber ?? ''}`),
  );
  if (servos.length >= 3 && !hasBulkCap) {
    issues.push({
      id: 'servo-bulk-cap',
      severity: 'warning',
      code: 'MISSING_BULK_CAPACITANCE',
      title: 'Servo rail has no bulk capacitance',
      detail: `${servos.length} servos share a rail with no bulk capacitor. Servo starts draw large current transients that will brown out the logic rail.`,
      scope: 'graph',
      remedy: 'Add a 470–1000 µF electrolytic across the servo rail, plus 0.1 µF per servo.',
      evidence: { servoCount: servos.length },
    });
  }

  // ---- 7. I2C bus needs pull-ups ----------------------------------------
  const hasI2c = connections.some(
    (connection) =>
      connection.kind === 'data' &&
      /i2c/i.test(`${connection.label} ${connection.details} ${connection.fromPort ?? ''}`),
  );
  const hasPullups = nodes.some((node) =>
    /pull-?up|resistor/i.test(`${node.name} ${node.partNumber ?? ''}`),
  );
  if (hasI2c && !hasPullups) {
    issues.push({
      id: 'i2c-pullups',
      severity: 'warning',
      code: 'MISSING_I2C_PULLUPS',
      title: 'I2C bus has no pull-up resistors',
      detail: 'An I2C bus will not function without pull-ups on SDA and SCL.',
      scope: 'graph',
      remedy: 'Add 4.7 kΩ pull-ups from SDA and SCL to the logic rail.',
    });
  }

  if (!requirements) return issues;

  // ---- 8. Degrees of freedom vs locomotion ------------------------------
  const mech = requirements.mechanical;
  if (mech?.legCount && mech.legCount > 0 && servos.length > 0) {
    const perLeg = servos.length / mech.legCount;
    const minimum = mech.minDofPerLeg ?? 2;
    if (perLeg < minimum) {
      issues.push({
        id: 'dof-insufficient',
        severity: 'error',
        code: 'DOF_INSUFFICIENT',
        title: 'Not enough joints per leg to walk',
        detail: `${servos.length} servo(s) across ${mech.legCount} leg(s) is ${perLeg.toFixed(1)} per leg. Below ${minimum} DOF the leg can swivel but cannot lift, so the gait degenerates to skidding.`,
        scope: 'graph',
        remedy: `Use at least ${mech.legCount * minimum} servos (${minimum} DOF per leg), or relax the gait requirement.`,
        evidence: { servos: servos.length, legs: mech.legCount, perLeg: Number(perLeg.toFixed(2)) },
      });
    }
  }

  // ---- 9. Torque margin --------------------------------------------------
  if (mech?.payloadGrams && mech.legCount && servos.length > 0) {
    const sample = servos
      .map((node) => usableTorque(specFor.get(node.id)))
      .find((value): value is number => Boolean(value));
    if (sample) {
      const groundedLegs = Math.max(1, Math.ceil(mech.legCount / 2));
      const leverCm = mech.legLengthCm ?? 5;
      // 2× dynamic factor over the statically grounded legs.
      const required = ((mech.payloadGrams / groundedLegs) * leverCm * 2) / 1000;
      if (required > sample) {
        issues.push({
          id: 'torque-margin',
          severity: 'warning',
          code: 'TORQUE_MARGIN_LOW',
          title: 'Servo torque margin is too small',
          detail: `Continuous demand is about ${required.toFixed(2)} kg·cm vs roughly ${sample.toFixed(2)} kg·cm usable (stall ÷ 3). Shock loads will strip plastic gears.`,
          scope: 'graph',
          remedy: 'Move to metal-gear servos (MG90S / MG996R) or shorten the lever arm.',
          evidence: {
            requiredKgCm: Number(required.toFixed(2)),
            usableKgCm: Number(sample.toFixed(2)),
          },
        });
      }
    }
  }

  return issues;
}

export function hasBlockingIssue(issues: Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
