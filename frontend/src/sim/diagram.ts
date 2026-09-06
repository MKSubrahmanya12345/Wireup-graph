/**
 * Parse the diagram the backend ships inside the firmware zip and turn it into
 * something the browser bench can draw.
 *
 * Two shapes are accepted, because the backend emits both:
 *   • Wokwi v1  (`diagram.json`)            — connections are 4-string tuples
 *   • Wireup universal v2 (`hardware/universal-diagram.json`) — connections are
 *     `{ from: {partId, pin}, to: {partId, pin}, net }`
 *
 * Nothing here invents parts: a part type with no registered @wokwi/elements
 * custom element renders as a labelled placeholder tile (WokwiBench checks
 * `customElements.get(tag)` at runtime), not silently swapped for a
 * lookalike. The one deliberate exception is same-family stand-ins
 * (DHT11 → DHT22 element, LCD2004 → LCD1602 element), which are captioned
 * as such on the tile.
 */

import { identifyPart } from '../three/partIdentity';

export interface BenchPart {
  /** Part id from the diagram (e.g. "dht_1"). */
  id: string;
  /** Raw type from the diagram (e.g. "board-esp32-devkit-v1"). */
  type: string;
  /** Custom element tag to render, or null when no element exists. */
  tag: string | null;
  role?: string;
  model?: string;
  attrs: Record<string, string | number | boolean>;
}

export interface BenchConnection {
  fromPart: string;
  fromPin: string;
  toPart: string;
  toPin: string;
  net: string;
}

export interface BenchDiagram {
  source: string;
  version: number;
  parts: BenchPart[];
  connections: BenchConnection[];
  /** Part types we could not render as a real Wokwi element. */
  unrendered: string[];
}

/**
 * Diagram part type → registered custom element tag.
 * Tags are verified at runtime via customElements.get(); anything absent
 * falls through to a placeholder so the bench never fakes a component.
 */
const TAG_BY_TYPE: Record<string, string> = {
  'board-esp32-devkit-v1': 'wokwi-esp32-devkit-v1',
  'board-esp32-s3-devkitc-1': 'wokwi-esp32-devkit-v1',
  'wokwi-esp32-devkit-v1': 'wokwi-esp32-devkit-v1',
  'board-arduino-uno': 'wokwi-arduino-uno',
  'wokwi-arduino-uno': 'wokwi-arduino-uno',
  'board-arduino-nano': 'wokwi-arduino-nano',
  'wokwi-arduino-nano': 'wokwi-arduino-nano',
  'board-arduino-mega': 'wokwi-arduino-mega',
  'wokwi-arduino-mega': 'wokwi-arduino-mega',
  attiny85: 'wokwi-attiny85',
  'wokwi-attiny85': 'wokwi-attiny85',
  'wokwi-dht22': 'wokwi-dht22',
  dht22: 'wokwi-dht22',
  // Same-family stand-in, captioned on the tile.
  dht11: 'wokwi-dht22',
  'wokwi-hc-sr04': 'wokwi-hc-sr04',
  'hc-sr04': 'wokwi-hc-sr04',
  'wokwi-pir-motion-sensor': 'wokwi-pir-motion-sensor',
  'pir-motion-sensor': 'wokwi-pir-motion-sensor',
  'wokwi-servo': 'wokwi-servo',
  servo: 'wokwi-servo',
  'wokwi-stepper-motor': 'wokwi-stepper-motor',
  'stepper-motor': 'wokwi-stepper-motor',
  'wokwi-ssd1306': 'wokwi-ssd1306',
  ssd1306: 'wokwi-ssd1306',
  'wokwi-led': 'wokwi-led',
  led: 'wokwi-led',
  'wokwi-rgb-led': 'wokwi-rgb-led',
  'rgb-led': 'wokwi-rgb-led',
  'wokwi-neopixel': 'wokwi-neopixel',
  neopixel: 'wokwi-neopixel',
  'wokwi-neopixel-matrix': 'wokwi-neopixel-matrix',
  'neopixel-matrix': 'wokwi-neopixel-matrix',
  'wokwi-7segment': 'wokwi-7segment',
  '7segment': 'wokwi-7segment',
  'wokwi-buzzer': 'wokwi-buzzer',
  buzzer: 'wokwi-buzzer',
  'wokwi-pushbutton': 'wokwi-pushbutton',
  pushbutton: 'wokwi-pushbutton',
  'pushbutton-6mm': 'wokwi-pushbutton',
  'wokwi-potentiometer': 'wokwi-potentiometer',
  potentiometer: 'wokwi-potentiometer',
  'wokwi-slide-potentiometer': 'wokwi-slide-potentiometer',
  'slide-potentiometer': 'wokwi-slide-potentiometer',
  'wokwi-slide-switch': 'wokwi-slide-switch',
  'slide-switch': 'wokwi-slide-switch',
  'wokwi-photoresistor-sensor': 'wokwi-photoresistor-sensor',
  'photoresistor-sensor': 'wokwi-photoresistor-sensor',
  'wokwi-ntc-temperature-sensor': 'wokwi-ntc-temperature-sensor',
  'ntc-temperature-sensor': 'wokwi-ntc-temperature-sensor',
  'wokwi-relay-module': 'wokwi-ks2e-m-dc5',
  'wokwi-ks2e-m-dc5': 'wokwi-ks2e-m-dc5',
  relay: 'wokwi-ks2e-m-dc5',
  'wokwi-mpu6050': 'wokwi-mpu6050',
  mpu6050: 'wokwi-mpu6050',
  'wokwi-lcd1602': 'wokwi-lcd1602',
  lcd1602: 'wokwi-lcd1602',
  'lcd1602-i2c': 'wokwi-lcd1602',
  // Same-family stand-in, captioned on the tile.
  lcd2004: 'wokwi-lcd1602',
  'lcd2004-i2c': 'wokwi-lcd1602',
  'wokwi-membrane-keypad': 'wokwi-membrane-keypad',
  'membrane-keypad': 'wokwi-membrane-keypad',
  'wokwi-analog-joystick': 'wokwi-analog-joystick',
  'analog-joystick': 'wokwi-analog-joystick',
  'wokwi-rotary-encoder': 'wokwi-rotary-encoder',
  'ky-040': 'wokwi-rotary-encoder',
  'wokwi-resistor': 'wokwi-resistor',
  resistor: 'wokwi-resistor',
};

/** `resistor-10k`, `resistor-220` … all render as a resistor with that value. */
function resistorValue(type: string): string | null {
  const match = /^resistor-([0-9a-zA-Z.]+)$/.exec(type);
  return match ? match[1] : null;
}

/** Strip vendor/board prefixes so `board-x` and `wokwi-x` meet in the middle. */
function bareType(type: string): string {
  return type
    .trim()
    .toLowerCase()
    .replace(/^board-/, '')
    .replace(/^velxio-/, '');
}

export function tagForType(type: string): { tag: string | null; attrs: Record<string, string> } {
  const direct = TAG_BY_TYPE[type] ?? TAG_BY_TYPE[bareType(type)];
  if (direct) return { tag: direct, attrs: {} };
  const value = resistorValue(bareType(type));
  if (value) return { tag: 'wokwi-resistor', attrs: { value } };
  // Logic ICs have no @wokwi/elements model: say so explicitly (tag null →
  // labelled stub tile + `unrendered` note) instead of guessing a tag.
  // They are still solved in the nets and exact in 3D.
  const fineKey = identifyPart({ name: type, partNumber: type }).key;
  if (
    fineKey === 'ne555' ||
    fineKey === 'cd4017' ||
    fineKey === 'hc595' ||
    fineKey === 'hc165' ||
    fineKey === 'logic-ic' ||
    /^hc(00|02|04|08|14|32|86)$/.test(fineKey) ||
    fineKey === 'cd4011' ||
    // New 3D-first modules with no @wokwi/elements model: labelled stub
    // tile instead of a fabricated wokwi-* tag. Solved in nets, exact in 3D.
    fineKey === 'wemos-d1-mini' ||
    fineKey === 'wemos-d1-r32' ||
    fineKey === 'arduino-leonardo' ||
    fineKey === 'pro-micro' ||
    fineKey === 'rpi-4b' ||
    fineKey === 'pi-zero' ||
    fineKey === 'microbit' ||
    fineKey === 'rc522' ||
    fineKey === 'nrf24l01' ||
    fineKey === 'hc-05' ||
    fineKey === 'pca9685' ||
    fineKey === 'ads1115' ||
    fineKey === 'tp4056' ||
    fineKey === 'buck-module' ||
    fineKey === 'hlk-pm01' ||
    fineKey === 'mg996r' ||
    fineKey === 'stepper-28byj' ||
    fineKey === 'stepper-nema17' ||
    fineKey === 'tt-motor' ||
    fineKey === 'vibration-motor' ||
    fineKey === 'fan-30mm' ||
    fineKey === 'speaker-40mm' ||
    fineKey === 'peltier' ||
    fineKey === 'l298n' ||
    fineKey === 'ttp223' ||
    fineKey === 'sw420' ||
    fineKey === 'rain-plate' ||
    fineKey === 'soil-resistive' ||
    fineKey === 'water-level' ||
    fineKey === 'max7219-matrix' ||
    fineKey === 'tm1637' ||
    fineKey === 'nokia-5110'
  ) {
    return { tag: null, attrs: {} };
  }
  // Optimistic candidate: WokwiBench verifies registration at runtime and
  // falls back to a labelled placeholder when the tag does not exist.
  const bare = bareType(type);
  if (/^[a-z0-9][a-z0-9-]*$/.test(bare)) {
    return { tag: `wokwi-${bare}`, attrs: {} };
  }
  return { tag: null, attrs: {} };
}

/** Fine 3D/sim/controls key for a diagram part type (single mapping). */
export function diagramPartKey(type: string): string {
  return identifyPart({ name: type, partNumber: type }).key;
}

interface RawPart {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  attrs?: Record<string, unknown>;
}

function coerceAttrs(attrs: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined) continue;
    out[key] = String(value);
  }
  return out;
}

/** Wokwi v1 endpoints look like "dht_1:VCC" or "esp:GND.0". */
function splitEndpoint(endpoint: string): { partId: string; pin: string } {
  const idx = endpoint.indexOf(':');
  if (idx === -1) return { partId: endpoint, pin: '' };
  return { partId: endpoint.slice(0, idx), pin: endpoint.slice(idx + 1) };
}

export function parseDiagram(json: string, source: string): BenchDiagram | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as { version?: number; parts?: RawPart[]; connections?: unknown[] };
  if (!Array.isArray(doc.parts)) return null;

  const unrendered: string[] = [];
  const parts: BenchPart[] = doc.parts
    .filter((part): part is RawPart => Boolean(part && part.type))
    .map((part) => {
      const type = String(part.type);
      const mapped = tagForType(type);
      if (!mapped.tag && !unrendered.includes(type)) unrendered.push(type);
      return {
        id: String(part.id ?? type),
        type,
        tag: mapped.tag,
        role: part.role,
        model: part.model,
        attrs: { ...mapped.attrs, ...coerceAttrs(part.attrs) },
      };
    });

  const connections: BenchConnection[] = [];
  for (const conn of doc.connections ?? []) {
    if (Array.isArray(conn)) {
      // Wokwi v1: [fromPart, fromPin, toPart, toPin] — Wireup writes the pin
      // pair as ("part", "PIN", "esp", "NET").
      const [fromPart, fromPin, toPart, toPin] = conn.map((entry) => String(entry ?? ''));
      if (!fromPart || !toPart) continue;
      connections.push({ fromPart, fromPin, toPart, toPin, net: toPin || fromPin });
      continue;
    }
    if (conn && typeof conn === 'object') {
      const c = conn as {
        from?: { partId?: string; pin?: string } | string;
        to?: { partId?: string; pin?: string } | string;
        net?: string;
      };
      const from = typeof c.from === 'string' ? splitEndpoint(c.from) : c.from;
      const to = typeof c.to === 'string' ? splitEndpoint(c.to) : c.to;
      if (!from?.partId || !to?.partId) continue;
      connections.push({
        fromPart: from.partId,
        fromPin: from.pin ?? '',
        toPart: to.partId,
        toPin: to.pin ?? '',
        net: c.net ?? to.pin ?? '',
      });
    }
  }

  return {
    source,
    version: typeof doc.version === 'number' ? doc.version : 1,
    parts,
    connections,
    unrendered,
  };
}

/** Pick the best diagram out of the firmware file list (v2 preferred). */
export function diagramFromFiles(files: { path: string; content: string }[]): BenchDiagram | null {
  const ranked = [...files]
    .filter((file) => file.path.endsWith('.json') && /diagram/.test(file.path))
    .sort((a, b) => Number(b.path.includes('universal')) - Number(a.path.includes('universal')));
  for (const file of ranked) {
    const parsed = parseDiagram(file.content, file.path);
    if (parsed && parsed.parts.length) return parsed;
  }
  return null;
}

/** Sensor samples the hardware provider printed, e.g. "sample tempC = 24.8 C". */
export interface BenchSample {
  field: string;
  value: string;
  unit: string;
}

export function samplesFromLog(log: string[] | undefined): BenchSample[] {
  const out: BenchSample[] = [];
  for (const line of log ?? []) {
    const match = /sample\s+([A-Za-z0-9_]+)\s*=\s*(-?[\d.]+)\s*(\S*)/.exec(line);
    if (!match) continue;
    out.push({ field: match[1], value: match[2], unit: match[3] ?? '' });
  }
  return out;
}
