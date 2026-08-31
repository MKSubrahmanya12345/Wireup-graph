/**
 * Universal circuit diagram JSON — backwards-compatible with Wokwi diagram.json
 * and extendable for Velxio / any embedded circuit simulator.
 *
 * The format keeps the same top-level keys as Wokwi (version, author, parts,
 * connections) but adds universal fields:
 *   - parts[].role   (e.g. "mcu", "sensor", "actuator", "passive")
 *   - parts[].model  (canonical part number / KB device id)
 *   - connections[].signal  (GPIO/net name, for cross-reference with build plan)
 *
 * Changing either direction (agentic JSON file <-> UI drag/drop) updates the
 * other through the same structure. The frontend reads this file and renders
 * the circuit; editing the circuit writes back to this file.
 */

import type { DeviceBuildPlan } from './types.js';

export interface UniversalPart {
  type: string;     // simulator-specific part type (e.g. "board-esp32-devkit-v1")
  id: string;       // instance id
  role: string;     // universal role: "mcu" | "sensor" | "actuator" | "passive" | "display"
  model: string;    // canonical device id from KB (e.g. "dht22", "bme280")
  attrs: Record<string, string>;
  pins?: Record<string, string>; // pin label -> net/GPIO assignment
}

export interface UniversalConnection {
  from: { partId: string; pin: string };
  to:   { partId: string; pin: string };
  net?: string;     // signal / net name (e.g. "GPIO4", "+3V3", "GND")
}

export interface UniversalDiagram {
  version: 2;       // bumped from 1 for universal fields
  format: 'wireup-universal';
  author: string;
  sourcePlan?: string; // build plan slug / reference
  parts: UniversalPart[];
  connections: UniversalConnection[];
  nets?: Array<{
    name: string;
    voltage?: string; // e.g. "3V3", "5V", "GND"
    nodes: Array<{ partId: string; pin: string }>;
  }>;
}

/** Derive universal parts/connections from the existing Wokwi-style plan. */
export function generateUniversalDiagram(
  plan: DeviceBuildPlan,
  wokwiDiagram: { version: number; author: string; parts: Array<{ type: string; id: string; attrs: Record<string, string> }>; connections: [string, string, string, string][] },
): UniversalDiagram {
  const universalParts: UniversalPart[] = wokwiDiagram.parts.map((p) => {
    const role = p.type.includes('board') ? 'mcu' : (p.type.includes('dht') ? 'sensor' : (p.type.includes('relay') || p.type.includes('servo') ? 'actuator' : (p.type.includes('oled') ? 'display' : 'sensor')));
    const model = p.id.replace(/_[0-9]+$/, '').replace(/-/g, '_');
    return {
      type: p.type,
      id: p.id,
      role,
      model,
      attrs: p.attrs,
    };
  });

  // Add passives (pull-ups) as universal parts so the diagram is complete.
  const passives: UniversalPart[] = [
    { type: 'resistor-4k7', id: 'pullup_sda_1', role: 'passive', model: '4.7k', attrs: { value: '4.7k', foot: '0603' } },
    { type: 'resistor-4k7', id: 'pullup_scl_1', role: 'passive', model: '4.7k', attrs: { value: '4.7k', foot: '0603' } },
    { type: 'resistor-10k',  id: 'pullup_1w_1', role: 'passive', model: '10k', attrs: { value: '10k', foot: '0603' } },
  ];
  universalParts.push(...passives);

  const connections: UniversalConnection[] = wokwiDiagram.connections.map((c) => ({
    from: { partId: c[0], pin: c[1] },
    to:   { partId: c[2], pin: c[3] },
    net: c[3].startsWith('GPIO') ? c[3] : (c[3].includes('3V3') || c[3].includes('5V') ? c[3] : c[3]),
  }));

  // Add passives connections (pull-ups to +3V3).
  connections.push(
    { from: { partId: 'pullup_sda_1', pin: '1' }, to: { partId: universalParts.find(p => p.id === 'bme_1' || p.id === 'dht_1')?.id || 'esp', pin: 'SDA' }, net: '3V3' },
    { from: { partId: 'pullup_scl_1', pin: '1' }, to: { partId: universalParts.find(p => p.id === 'bme_1' || p.id === 'oled_1')?.id || 'esp', pin: 'SCL' }, net: '3V3' },
  );

  return {
    version: 2,
    format: 'wireup-universal',
    author: 'Wireup',
    sourcePlan: plan.slug ?? 'unknown',
    parts: universalParts,
    connections,
    nets: [
      { name: 'GND', nodes: [{ partId: 'esp', pin: 'GND.0' }] },
      { name: '+3V3', nodes: [{ partId: 'esp', pin: '3V3' }] },
      { name: '+5V', nodes: [{ partId: 'esp', pin: '5V' }] },
    ],
  };
}
