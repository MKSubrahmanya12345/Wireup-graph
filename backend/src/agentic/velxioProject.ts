/**
 * Velxio project (.vlx) generation.
 *
 * Velxio (https://velxio.dev, source vendored as the `external/velxio`
 * submodule, AGPL-3.0) is an open-source multi-board emulator. Its native
 * project format is a single JSON file — `format: "velxio-project"`,
 * `version: 1` — carrying the boards, the source files, the placed components
 * and the wires between them. Its importer (`frontend/src/utils/vlxFile.ts`
 * upstream) reads exactly the shape produced here.
 *
 * So every Wireup build can ship one more artifact: open `<slug>.vlx` in
 * Velxio and the circuit the pipeline resolved is on the canvas, wired to the
 * same GPIOs the firmware drives, with the generated sketch already loaded.
 *
 * Two rules this file keeps:
 *   1. It is derived from the SAME wiring the Wokwi config uses, so the
 *      simulator, the firmware and the instructions cannot drift apart.
 *   2. A part Velxio has no model for is reported in `unsupported`, never
 *      substituted with a lookalike component.
 */

import type { DeviceBuildPlan } from './types.js';
import { generateWokwiConfig } from './wokwiConfig.js';

// ── The .vlx shape (mirrors upstream VlxPayload) ────────────────────────────

export interface VlxBoard {
  id: string;
  name?: string;
  boardKind: string;
  x: number;
  y: number;
  activeFileGroupId: string;
  languageMode?: 'arduino' | 'micropython' | 'espidf';
  serialBaudRate?: number;
  libraries?: string[];
}

export interface VlxComponent {
  id: string;
  metadataId: string;
  x: number;
  y: number;
  properties: Record<string, unknown>;
}

export interface VlxWireEndpoint {
  componentId: string;
  pinName: string;
  x: number;
  y: number;
}

export interface VlxWire {
  id: string;
  start: VlxWireEndpoint;
  end: VlxWireEndpoint;
  waypoints: { x: number; y: number }[];
  color: string;
  signalType?: 'power-vcc' | 'power-gnd' | 'analog' | 'digital' | 'pwm' | 'i2c' | 'spi' | 'usart';
}

export interface VlxProject {
  format: 'velxio-project';
  version: 1;
  exportedAt: string;
  name: string;
  boards: VlxBoard[];
  fileGroups: Record<string, { name: string; content: string }[]>;
  components: VlxComponent[];
  wires: VlxWire[];
  activeBoardId: string | null;
}

export interface VelxioProjectResult {
  project: VlxProject;
  json: string;
  /** Wokwi part types Velxio has no component for — reported, not faked. */
  unsupported: string[];
}

// ── Mapping tables ──────────────────────────────────────────────────────────

/** Wireup board id → Velxio `boardKind` (drives which CPU core emulates it). */
function boardKindFor(plan: DeviceBuildPlan): string {
  switch (plan.board.id) {
    case 'esp32-s3-devkit':
      return 'esp32-s3';
    case 'esp32-devkit-v1':
    default:
      return 'esp32';
  }
}

/**
 * Wokwi part type → Velxio component `metadataId`.
 *
 * Velxio's catalog is generated from wokwi-elements, so the id is the element
 * name without the `wokwi-` prefix — with a few renames upstream made
 * (`bme280` → `bmp280`, `ds18b20` → `ds18b20-temp`). Anything not listed here
 * has no verified Velxio model and is skipped with a report.
 */
const METADATA_BY_WOKWI_TYPE: Record<string, string> = {
  'wokwi-dht22': 'dht22',
  'wokwi-hc-sr04': 'hc-sr04',
  'wokwi-pir-motion-sensor': 'pir-motion-sensor',
  'wokwi-servo': 'servo',
  'wokwi-ssd1306': 'ssd1306',
  'wokwi-led': 'led',
  'wokwi-buzzer': 'buzzer',
  'wokwi-pushbutton': 'pushbutton',
  'wokwi-potentiometer': 'potentiometer',
  'wokwi-photoresistor-sensor': 'photoresistor-sensor',
  'wokwi-ntc-temperature-sensor': 'ntc-temperature-sensor',
  'wokwi-mpu6050': 'mpu6050',
  'wokwi-lcd1602': 'lcd1602',
  'wokwi-neopixel': 'neopixel',
  'wokwi-resistor': 'resistor',
  'wokwi-bme280': 'bmp280',
  // NOTE deliberately absent: 'wokwi-ds18b20'. The pinned Velxio catalog
  // (components-metadata.json, 156 parts) has no DS18B20 model — mapping it
  // to a made-up id would put a dead part on the canvas. It stays in
  // `unsupported` and is reported instead.
};

/**
 * Normalise a devkit net label to the pin NAME the board element exposes.
 *
 * The ESP32 devkit element's pins are `D4`, `D21`, `3V3`, `VIN`, `GND.1`,
 * `GND.2` … while the plan's nets are bare GPIO numbers plus `GND.0`. Wiring
 * to a pin that does not exist would silently drop the wire on import, so the
 * translation happens here, once.
 */
export function velxioBoardPin(net: string): string | null {
  const value = net.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return `D${value}`;
  if (/^GPIO\d+$/i.test(value)) return `D${value.replace(/^GPIO/i, '')}`;
  if (/^GND(\.\d+)?$/i.test(value)) return 'GND.1'; // the element has GND.1/GND.2 only
  if (/^3V3$|^3\.3V$/i.test(value)) return '3V3';
  if (/^5V$|^VIN$/i.test(value)) return 'VIN';
  if (/^D\d+$/i.test(value)) return value.toUpperCase();
  if (/^(VP|VN|EN|RX0|TX0|RX2|TX2)$/i.test(value)) return value.toUpperCase();
  return null;
}

/** Wire colour + logical signal type, by what the net carries. */
function classifyNet(boardPin: string, partPin: string): { color: string; signalType: VlxWire['signalType'] } {
  if (boardPin === 'GND.1' || boardPin === 'GND.2') return { color: '#3b3b3b', signalType: 'power-gnd' };
  if (boardPin === '3V3' || boardPin === 'VIN') return { color: '#d32f2f', signalType: 'power-vcc' };
  const pin = partPin.toUpperCase();
  if (pin === 'SCL' || pin === 'SDA') {
    // SDA on a DHT22 is its single-wire data line, not I²C — the element
    // simply reuses the name. Only a part that also has SCL is on a bus.
    return { color: '#5c9ded', signalType: 'digital' };
  }
  return { color: '#5c9ded', signalType: 'digital' };
}

// ── Generation ──────────────────────────────────────────────────────────────

const BOARD_POS = { x: 120, y: 140 };
const PART_COLUMN_X = 640;
const PART_ROW_HEIGHT = 170;
const PART_ROW_Y = 60;
/** Rough pin anchor offsets — Velxio recalculates them from the real element
 *  geometry on import; these only keep freshly-imported wires from starting
 *  at the origin. */
const PIN_OFFSET = { x: 40, y: 30 };

/**
 * Velxio's QEMU fork emulates exactly one Wi-Fi access point: SSID
 * "Espressif", open auth, with slirp NAT + a hostfwd of the board's port 80
 * out to Velxio's IoT gateway (`/api/gateway/{client_id}/…`).
 *
 * Velxio's compiler rewrites SSID string literals for QEMU itself — but only
 * in the ENTRY sketch, and Wireup keeps credentials in `config.h`. Left
 * alone, the simulated board would try to join the user's home SSID (which
 * does not exist inside QEMU), fail, and fall back to a softAP the gateway
 * explicitly cannot reach. So every artifact that goes TO the emulator gets
 * the same normalisation applied to all its files: SSID → "Espressif",
 * password → "" . The firmware zip the user flashes is untouched — their
 * real credentials stay in `firmware/config.h`.
 */
export const QEMU_WIFI_SSID = 'Espressif';

export function normalizeWifiForEmulator(files: { name: string; content: string }[]): {
  name: string;
  content: string;
}[] {
  return files.map((file) => {
    if (!/\.(ino|h|hpp|cpp|c)$/.test(file.name)) return file;
    const content = file.content
      .replace(
        /(#define\s+WIFI_SSID\s+)"[^"]*"/,
        `$1"${QEMU_WIFI_SSID}" // Velxio/QEMU emulated AP (open). Your real SSID stays in the firmware zip.`,
      )
      .replace(/(#define\s+WIFI_PASSWORD\s+)"[^"]*"/, '$1"" // open auth in the emulator');
    return content === file.content ? file : { ...file, content };
  });
}

/**
 * Build the .vlx project for a resolved plan.
 *
 * `sketch` is the generated Arduino source; it becomes the board's file group
 * so the project opens ready to compile inside Velxio.
 *
 * `extraFiles` are the project-local headers the sketch #includes (config.h
 * etc.). They MUST ship inside the same file group — Velxio compiles exactly
 * the group's files, so a sketch whose `#include "config.h"` has no matching
 * file fails to compile and the emulator reports that no runnable firmware
 * was produced.
 */
export function generateVelxioProject(
  plan: DeviceBuildPlan,
  sketch: { name: string; content: string },
  extraFiles: { name: string; content: string }[] = [],
): VelxioProjectResult {
  const wokwi = generateWokwiConfig(plan);
  const diagram = JSON.parse(wokwi.diagramJson) as {
    parts: { type: string; id: string; attrs?: Record<string, string> }[];
    connections: [string, string, string, string][];
  };

  const boardId = 'board-1';
  const fileGroupId = 'group-1';
  const boardPartIds = new Set(
    diagram.parts.filter((part) => part.type.startsWith('board-')).map((part) => part.id),
  );

  const unsupported: string[] = [...wokwi.unsupported];
  const components: VlxComponent[] = [];
  const positions = new Map<string, { x: number; y: number }>();

  diagram.parts
    .filter((part) => !boardPartIds.has(part.id))
    .forEach((part, index) => {
      const metadataId = METADATA_BY_WOKWI_TYPE[part.type];
      if (!metadataId) {
        if (!unsupported.includes(part.type)) unsupported.push(part.type);
        return;
      }
      const position = { x: PART_COLUMN_X, y: PART_ROW_Y + index * PART_ROW_HEIGHT };
      positions.set(part.id, position);
      components.push({
        id: part.id,
        metadataId,
        ...position,
        properties: { ...(part.attrs ?? {}) },
      });
    });

  const placed = new Set(components.map((component) => component.id));
  const wires: VlxWire[] = [];

  diagram.connections.forEach(([partId, partPin, targetId, net], index) => {
    if (!placed.has(partId)) return; // its component was skipped — no dangling wire
    if (!boardPartIds.has(targetId)) return;
    const boardPin = velxioBoardPin(net);
    if (!boardPin) {
      if (!unsupported.includes(`net:${net}`)) unsupported.push(`net:${net}`);
      return;
    }
    const from = positions.get(partId) ?? { x: PART_COLUMN_X, y: PART_ROW_Y };
    const { color, signalType } = classifyNet(boardPin, partPin);
    wires.push({
      id: `wire-${index + 1}`,
      start: {
        componentId: partId,
        pinName: partPin,
        x: from.x + PIN_OFFSET.x,
        y: from.y + PIN_OFFSET.y,
      },
      end: {
        componentId: boardId,
        pinName: boardPin,
        x: BOARD_POS.x + PIN_OFFSET.x,
        y: BOARD_POS.y + PIN_OFFSET.y + index * 12,
      },
      waypoints: [],
      color,
      signalType,
    });
  });

  const libraries = [...new Set(plan.modules.flatMap((module) => module.libraries.map((lib) => lib.name)))];

  const project: VlxProject = {
    format: 'velxio-project',
    version: 1,
    // Fixed timestamp source: the caller's clock. Kept out of the hash-stable
    // parts of the file so two builds of the same plan differ only here.
    exportedAt: new Date().toISOString(),
    name: plan.projectName,
    boards: [
      {
        id: boardId,
        name: plan.board.name,
        boardKind: boardKindFor(plan),
        x: BOARD_POS.x,
        y: BOARD_POS.y,
        activeFileGroupId: fileGroupId,
        languageMode: 'arduino',
        serialBaudRate: 115_200,
        libraries,
      },
    ],
    fileGroups: {
      // The sketch first (Velxio's main file), then every local header it
      // includes — the group must be self-contained for the compile to work.
      // Wi-Fi credentials are normalised to the emulator's AP (see
      // normalizeWifiForEmulator): this file targets QEMU, not the bench.
      [fileGroupId]: normalizeWifiForEmulator([
        { name: sketch.name, content: sketch.content },
        ...extraFiles,
      ]),
    },
    components,
    wires,
    activeBoardId: boardId,
  };

  return { project, json: JSON.stringify(project, null, 2), unsupported };
}
