/**
 * Wokwi headless-simulation config generation.
 *
 * Wokwi (https://wokwi.com) boots compiled ESP32 firmware in a virtual circuit.
 * It needs two files in the firmware project:
 *   - wokwi.toml   — where the ELF/hex is, which board, serial settings
 *   - diagram.json — the virtual parts (board + sensors/actuators) and the net
 *                    list wiring them to the exact GPIOs the plan assigned.
 *
 * This module derives both from the resolved DeviceBuildPlan, so the simulated
 * circuit matches the firmware pin-for-pin. Parts Wokwi has no model for (e.g.
 * MQ-2 gas) are noted in `unsupported`; the sim still boots the rest.
 */

import type { DeviceBuildPlan } from './types.js';

export interface WokwiPart {
  type: string;
  id: string;
  attrs: Record<string, string>;
}

export interface WokwiDiagram {
  version: 1;
  author: 'Wireup';
  parts: WokwiPart[];
  connections: [string, string, string, string][];
}

export interface WokwiConfig {
  wokwiToml: string;
  diagramJson: string;
  /** KB device ids Wokwi cannot simulate (no model) — surfaced in the build log. */
  unsupported: string[];
}

/** GPIO label ("GPIO4") -> the ESP32 Wokwi net label on the devkit part. */
function espPin(gpioLabel: string): string {
  const n = gpioLabel.toUpperCase().replace(/^GPIO/, '').trim();
  return n ? `${n}` : '';
}

/**
 * Wokwi part model + the net each signal pin should join, per supported KB
 * device. Nets reference the ESP32 devkit pin names ("4", "5", "GND.0").
 * Returns null for devices Wokwi cannot model.
 */
interface WokwiWiring {
  partType: string;
  partId: string;
  /** [partPin, net] pairs for every module pin in the plan. */
  pinNets: [string, string][];
}

function wiringForDevice(
  deviceId: string,
  index: number,
  pins: Record<string, string>,
): WokwiWiring | null {
  const pin = (role: string) => pins[role];

  switch (deviceId) {
    case 'dht22':
    case 'dht11': {
      const dataNet = espPin(pin('data') ?? 'GPIO4');
      return {
        partType: 'wokwi-dht22',
        partId: `dht_${index + 1}`,
        pinNets: [
          ['VCC', '3V3'],
          ['SDA', dataNet],
          ['GND', 'GND.0'],
        ],
      };
    }
    case 'bme280':
      return {
        partType: 'wokwi-bme280',
        partId: `bme_${index + 1}`,
        pinNets: [
          ['VIN', '3V3'],
          ['GND', 'GND.0'],
          ['SDA', espPin(pin('sda') ?? 'GPIO21')],
          ['SCL', espPin(pin('scl') ?? 'GPIO22')],
        ],
      };
    case 'ds18b20':
      return {
        partType: 'wokwi-ds18b20',
        partId: `ds_${index + 1}`,
        pinNets: [
          ['VCC', '3V3'],
          ['GND', 'GND.0'],
          ['DQ', espPin(pin('data') ?? 'GPIO4')],
        ],
      };
    case 'hc-sr04':
      return {
        partType: 'wokwi-hc-sr04',
        partId: `sr04_${index + 1}`,
        pinNets: [
          ['VCC', '5V'],
          ['GND', 'GND.0'],
          ['TRIG', espPin(pin('trig') ?? 'GPIO13')],
          ['ECHO', espPin(pin('echo') ?? 'GPIO14')],
        ],
      };
    case 'hc-sr501':
      return {
        partType: 'wokwi-pir-motion-sensor',
        partId: `pir_${index + 1}`,
        pinNets: [
          ['VCC', '3V3'],
          ['GND', 'GND.0'],
          ['OUT', espPin(pin('out') ?? pin('data') ?? 'GPIO14')],
        ],
      };
    case 'mq2-gas':
      return {
        partType: 'wokwi-gas-sensor',
        partId: `gas_${index + 1}`,
        pinNets: [
          ['VCC', '5V'],
          ['GND', 'GND.0'],
          ['AOUT', espPin(pin('sig') ?? pin('ao') ?? pin('data') ?? 'GPIO34')],
        ],
      };
    case 'soil-moisture':
      return null;
    case 'relay-1ch':
      return {
        partType: 'wokwi-relay-module',
        partId: `relay_${index + 1}`,
        pinNets: [
          ['VCC', '5V'],
          ['GND', 'GND.0'],
          ['IN', espPin(pin('in') ?? pin('sig') ?? 'GPIO13')],
        ],
      };
    case 'sg90':
    case 'servo-sg90':
      return {
        partType: 'wokwi-servo',
        partId: `servo_${index + 1}`,
        pinNets: [
          ['V+', '5V'],
          ['GND', 'GND.0'],
          ['PWM', espPin(pin('sig') ?? pin('pwm') ?? pin('out') ?? 'GPIO18')],
        ],
      };
    case 'ssd1306':
      return {
        partType: 'wokwi-ssd1306',
        partId: `oled_${index + 1}`,
        pinNets: [
          ['VCC', '3V3'],
          ['GND', 'GND.0'],
          ['SDA', espPin(pin('sda') ?? 'GPIO21')],
          ['SCL', espPin(pin('scl') ?? 'GPIO22')],
        ],
      };
    case 'led':
      return {
        partType: 'wokwi-led',
        partId: `led_${index + 1}`,
        pinNets: [
          ['A', espPin(pin('data') ?? pin('sig') ?? 'GPIO13')],
          ['C', 'GND.0'],
        ],
      };
    default:
      // No Wokwi model for this part — reported as unsupported, not faked.
      return null;
  }
}

/** Board type for wokwi.toml/diagram. */
function boardPart(plan: DeviceBuildPlan): { type: string; id: string } {
  if (plan.board.id === 'esp32-s3-devkit') {
    return { type: 'board-esp32-s3-devkitc-1', id: 'esp' };
  }
  return { type: 'board-esp32-devkit-v1', id: 'esp' };
}

export function generateWokwiConfig(plan: DeviceBuildPlan): WokwiConfig {
  const board = boardPart(plan);
  const parts: WokwiPart[] = [{ type: board.type, id: board.id, attrs: {} }];
  const connections: [string, string, string, string][] = [];
  const unsupported: string[] = [];

  plan.modules.forEach((module, index) => {
    const wiring = wiringForDevice(module.deviceId, index, module.pins);
    if (!wiring) {
      unsupported.push(module.deviceId);
      return;
    }
    parts.push({ type: wiring.partType, id: wiring.partId, attrs: {} });
    for (const [partPin, net] of wiring.pinNets) {
      if (!net) continue;
      // Nets reference the ESP32 devkit part: power rails by name ("3V3",
      // "5V", "GND.0"), GPIO by bare pin number ("4"), matching Wokwi wiring.
      connections.push([wiring.partId, partPin, board.id, net]);
    }
  });

  const diagram: WokwiDiagram = {
    version: 1,
    author: 'Wireup',
    parts,
    connections,
  };

  // PlatformIO writes the ELF to .pio/build/<env>/firmware.elf; arduino-cli a
  // .hex/.bin. We point Wokwi at the PlatformIO ELF (the gate runs pio first).
  const firmwareElf = `.pio/build/${plan.board.platformioEnv}/firmware.elf`;
  const wokwiToml = `# Wokwi simulation config — generated by Wireup
# Simulate the compiled firmware headlessly:
#   WOKWI_CLI_TOKEN=<token> wokwi-cli . --timeout 30000 --expect-text "listening on port"
# Get a free token at https://wokwi.com/dashboard/ci
[wokwi]
version = 1
firmware = '${firmwareElf}'
elf = '${firmwareElf}'
prompts = false
`;

  return {
    wokwiToml,
    diagramJson: JSON.stringify(diagram, null, 2),
    unsupported,
  };
}
