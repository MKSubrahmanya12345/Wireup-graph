/**
 * Canvas → diagram.json reverse sync.
 *
 * When the user rewires the circuit on the embedded Velxio canvas and pulls
 * it back, the edit must land in THIS build's artifacts — otherwise the
 * downloaded zip, the native bench and the canvas silently disagree. This
 * module folds a pulled VlxPayload back into:
 *
 *   • simulation/<slug>.vlx           — replaced with the pulled project
 *   • diagram.json                    — parts + connections regenerated for
 *   • hardware/universal-diagram.json   every canvas-managed part
 *
 * The mapping is the exact inverse of the backend's velxioProject.ts tables.
 * Parts the canvas does not manage (the board itself, pull-up resistors and
 * other unmodelled passives) are preserved untouched, as are their nets —
 * the sync never invents or discards what it cannot see on the canvas.
 */
import type { VlxCanvasPayload } from './velxioBridge';

/** Inverse of the backend's METADATA_BY_WOKWI_TYPE. */
const WOKWI_TYPE_BY_METADATA: Record<string, string> = {
  dht22: 'wokwi-dht22',
  'hc-sr04': 'wokwi-hc-sr04',
  'pir-motion-sensor': 'wokwi-pir-motion-sensor',
  servo: 'wokwi-servo',
  ssd1306: 'wokwi-ssd1306',
  led: 'wokwi-led',
  buzzer: 'wokwi-buzzer',
  pushbutton: 'wokwi-pushbutton',
  potentiometer: 'wokwi-potentiometer',
  'photoresistor-sensor': 'wokwi-photoresistor-sensor',
  'ntc-temperature-sensor': 'wokwi-ntc-temperature-sensor',
  mpu6050: 'wokwi-mpu6050',
  lcd1602: 'wokwi-lcd1602',
  neopixel: 'wokwi-neopixel',
  resistor: 'wokwi-resistor',
  bmp280: 'wokwi-bme280',
  // ds18b20 has no model in the pinned Velxio catalog — see velxioProject.ts.
};

/** Inverse of velxioBoardPin: the board element's pin name → the plan's net label. */
export function planNetFromBoardPin(pinName: string): string {
  const value = pinName.trim().toUpperCase();
  if (/^D\d+$/.test(value)) return value.slice(1); // D4 → "4"
  if (/^GND(\.\d+)?$/.test(value)) return 'GND.0'; // GND.1/GND.2 → the plan's single GND label
  if (value === '3V3') return '3V3';
  if (value === 'VIN') return '5V';
  return value;
}

interface DiagramPart {
  type: string;
  id: string;
  role?: string;
  model?: string;
  attrs?: Record<string, string>;
}

interface DiagramConnection {
  from: { partId: string; pin: string };
  to: { partId: string; pin: string };
  net: string;
}

interface UniversalDiagram {
  version: number;
  format: string;
  author: string;
  sourcePlan?: string;
  parts: DiagramPart[];
  connections: DiagramConnection[];
  nets?: unknown[];
  [key: string]: unknown;
}

export interface CanvasSyncResult {
  /** File updates to apply to the stored build result (path → new content). */
  updates: { path: string; content: string }[];
  /** Human summary for the UI. */
  summary: string;
  /** Canvas components with no Wireup mapping — reported, never faked. */
  unmapped: string[];
}

/**
 * Fold a pulled canvas payload into the build's firmware artifacts.
 * Returns null when the build has no diagram to sync into.
 */
export function applyCanvasToArtifacts(
  payload: VlxCanvasPayload,
  files: { path: string; content: string }[],
): CanvasSyncResult | null {
  const diagramFile = files.find((f) => f.path === 'diagram.json');
  const vlxFile = files.find((f) => f.path.endsWith('.vlx'));
  if (!diagramFile || !vlxFile) return null;

  let diagram: UniversalDiagram;
  try {
    diagram = JSON.parse(diagramFile.content) as UniversalDiagram;
  } catch {
    return null;
  }

  const boardPart = diagram.parts.find((part) => part.type.startsWith('board-'));
  const boardId = boardPart?.id ?? 'esp';

  // Which part ids does the canvas manage? Everything with a mapped type.
  const managedTypes = new Set(Object.values(WOKWI_TYPE_BY_METADATA));
  const previouslyManaged = new Set(
    diagram.parts.filter((part) => managedTypes.has(part.type)).map((part) => part.id),
  );
  const previousById = new Map(diagram.parts.map((part) => [part.id, part]));

  // 1. Parts: keep board + unmanaged parts, rebuild the managed set from the canvas.
  const unmapped: string[] = [];
  const canvasParts: DiagramPart[] = [];
  for (const component of payload.components) {
    const type = WOKWI_TYPE_BY_METADATA[component.metadataId];
    if (!type) {
      unmapped.push(`${component.id} (${component.metadataId})`);
      continue;
    }
    const previous = previousById.get(component.id);
    canvasParts.push({
      type,
      id: component.id,
      role: previous?.role ?? 'canvas',
      model: previous?.model ?? component.metadataId,
      attrs: {
        ...(previous?.attrs ?? {}),
        ...(Object.fromEntries(
          Object.entries(component.properties ?? {}).map(([k, v]) => [k, String(v)]),
        ) as Record<string, string>),
      },
    });
  }
  const keptParts = diagram.parts.filter((part) => !previouslyManaged.has(part.id));
  const nextParts = [...keptParts, ...canvasParts];
  const nextPartIds = new Set(nextParts.map((part) => part.id));

  // 2. Connections: canvas wires own every managed part; the rest survive
  //    only while both endpoints still exist.
  const canvasConnections: DiagramConnection[] = [];
  const boardCanvasIds = new Set(payload.boards.map((board) => board.id));
  for (const wire of payload.wires) {
    // Normalise so the board is always the `to` side, matching the generator.
    const startIsBoard = boardCanvasIds.has(wire.start.componentId);
    const endIsBoard = boardCanvasIds.has(wire.end.componentId);
    if (startIsBoard === endIsBoard) continue; // part↔part or board↔board: no plan-net to name
    const partEnd = startIsBoard ? wire.end : wire.start;
    const boardEnd = startIsBoard ? wire.start : wire.end;
    if (!nextPartIds.has(partEnd.componentId)) continue;
    const net = planNetFromBoardPin(boardEnd.pinName);
    canvasConnections.push({
      from: { partId: partEnd.componentId, pin: partEnd.pinName },
      to: { partId: boardId, pin: net },
      net,
    });
  }
  // Existing connections survive when (a) they are NOT a managed-part↔board
  // wire — those are exactly what the canvas owns and regenerates — and
  // (b) both endpoints still exist after the sync. Part↔part links (e.g. a
  // pull-up to a sensor leg) cannot be expressed as canvas board-wires, so
  // they are preserved rather than dropped.
  const isBoard = (id: string) => id === boardId;
  const keptConnections = diagram.connections.filter((connection) => {
    const canvasOwned =
      (previouslyManaged.has(connection.from.partId) && isBoard(connection.to.partId)) ||
      (previouslyManaged.has(connection.to.partId) && isBoard(connection.from.partId));
    if (canvasOwned) return false;
    const fromAlive = isBoard(connection.from.partId) || nextPartIds.has(connection.from.partId);
    const toAlive = isBoard(connection.to.partId) || nextPartIds.has(connection.to.partId);
    return fromAlive && toAlive;
  });

  const nextDiagram: UniversalDiagram = {
    ...diagram,
    author: 'Wireup (synced from the Velxio canvas)',
    parts: nextParts,
    connections: [...keptConnections, ...canvasConnections],
  };
  const diagramJson = JSON.stringify(nextDiagram, null, 2);

  const updates = [
    { path: vlxFile.path, content: JSON.stringify(payload, null, 2) },
    { path: 'diagram.json', content: diagramJson },
  ];
  if (files.some((f) => f.path === 'hardware/universal-diagram.json')) {
    updates.push({ path: 'hardware/universal-diagram.json', content: diagramJson });
  }

  return {
    updates,
    summary: `${canvasParts.length} part(s), ${canvasConnections.length} wire(s) synced from the canvas${
      unmapped.length > 0 ? ` — no Wireup mapping for: ${unmapped.join(', ')}` : ''
    }`,
    unmapped,
  };
}
