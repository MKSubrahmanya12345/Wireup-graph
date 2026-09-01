/**
 * Parse the diagram the backend ships inside the firmware zip and turn it into
 * something the browser bench can draw.
 *
 * Two shapes are accepted, because the backend emits both:
 *   • Wokwi v1  (`diagram.json`)            — connections are 4-string tuples
 *   • Wireup universal v2 (`hardware/universal-diagram.json`) — connections are
 *     `{ from: {partId, pin}, to: {partId, pin}, net }`
 *
 * Nothing here invents parts: a part type with no matching @wokwi/elements
 * custom element is rendered as a labelled placeholder tile, not silently
 * swapped for a lookalike.
 */

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
 * Only tags that @wokwi/elements actually defines are listed; anything absent
 * falls through to a placeholder so the bench never fakes a component.
 */
const TAG_BY_TYPE: Record<string, string> = {
  'board-esp32-devkit-v1': 'wokwi-esp32-devkit-v1',
  'board-esp32-s3-devkitc-1': 'wokwi-esp32-devkit-v1',
  'wokwi-esp32-devkit-v1': 'wokwi-esp32-devkit-v1',
  'board-arduino-uno': 'wokwi-arduino-uno',
  'wokwi-arduino-uno': 'wokwi-arduino-uno',
  'wokwi-arduino-nano': 'wokwi-arduino-nano',
  'wokwi-arduino-mega': 'wokwi-arduino-mega',
  'wokwi-dht22': 'wokwi-dht22',
  'wokwi-hc-sr04': 'wokwi-hc-sr04',
  'wokwi-pir-motion-sensor': 'wokwi-pir-motion-sensor',
  'wokwi-servo': 'wokwi-servo',
  'wokwi-ssd1306': 'wokwi-ssd1306',
  'wokwi-led': 'wokwi-led',
  'wokwi-buzzer': 'wokwi-buzzer',
  'wokwi-pushbutton': 'wokwi-pushbutton',
  'wokwi-potentiometer': 'wokwi-potentiometer',
  'wokwi-photoresistor-sensor': 'wokwi-photoresistor-sensor',
  'wokwi-ntc-temperature-sensor': 'wokwi-ntc-temperature-sensor',
  'wokwi-relay-module': 'wokwi-ks2e-m-dc5',
  'wokwi-ks2e-m-dc5': 'wokwi-ks2e-m-dc5',
  'wokwi-mpu6050': 'wokwi-mpu6050',
  'wokwi-lcd1602': 'wokwi-lcd1602',
  'wokwi-neopixel': 'wokwi-neopixel',
  'wokwi-resistor': 'wokwi-resistor',
};

/** `resistor-10k`, `resistor-220` … all render as a resistor with that value. */
function resistorValue(type: string): string | null {
  const match = /^resistor-([0-9a-zA-Z.]+)$/.exec(type);
  return match ? match[1] : null;
}

export function tagForType(type: string): { tag: string | null; attrs: Record<string, string> } {
  const direct = TAG_BY_TYPE[type];
  if (direct) return { tag: direct, attrs: {} };
  const value = resistorValue(type);
  if (value) return { tag: 'wokwi-resistor', attrs: { value } };
  return { tag: null, attrs: {} };
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
