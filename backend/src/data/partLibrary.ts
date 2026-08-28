/**
 * Machine-readable part specs.
 *
 * The official component bank carries human-readable facts for prompting.
 * This library carries NUMBERS so the rules engine can do arithmetic.
 * Unknown parts return undefined and the rules degrade to a notice — never a
 * false error.
 */
export type PartKind =
  | 'mcu' | 'servo' | 'regulator' | 'battery' | 'charger'
  | 'sensor' | 'driver' | 'passive' | 'other';

export interface PartSpec {
  id: string;
  family: string;
  manufacturer?: string;
  officialUrl?: string;
  kind: PartKind;

  /** Operating supply window. */
  supplyMinV?: number;
  supplyMaxV?: number;

  /** Draw while running / worst case / stalled. */
  currentTypMa?: number;
  currentMaxMa?: number;
  currentStallMa?: number;

  /** Regulators: voltages it can produce, and per-rail current. */
  outputV?: number[];
  outputMaxMa?: number;
  inputMinV?: number;
  inputMaxV?: number;
  /** Independent output rails the package provides. */
  outputs?: number;

  /** Servos / actuators. */
  torqueKgCm?: number;
  weightG?: number;

  /** Batteries. */
  capacityMah?: number;
  nominalV?: number;
  maxContinuousMa?: number;

  /** Drivers: how many channels. */
  channels?: number;

  notes?: string[];
}

export const PARTS: PartSpec[] = [
  {
    id: 'nordic-nrf52840',
    family: 'nRF52840',
    manufacturer: 'Nordic Semiconductor',
    officialUrl: 'https://www.nordicsemi.com/Products/nRF52840',
    kind: 'mcu',
    supplyMinV: 1.7,
    supplyMaxV: 5.5,
    currentTypMa: 8,
    currentMaxMa: 25,
    notes: [
      'BLE TX peaks dominate the current budget.',
      'Needs an external 32 MHz + 32.768 kHz crystal for RF.',
    ],
  },
  {
    id: 'espressif-esp32',
    family: 'ESP32',
    manufacturer: 'Espressif',
    officialUrl: 'https://www.espressif.com/en/products/socs/esp32',
    kind: 'mcu',
    supplyMinV: 3.0,
    supplyMaxV: 3.6,
    currentTypMa: 80,
    currentMaxMa: 250,
  },
  {
    id: 'towerpro-sg90',
    family: 'SG90',
    manufacturer: 'Tower Pro',
    kind: 'servo',
    supplyMinV: 4.8,
    supplyMaxV: 6.0,
    currentTypMa: 150,
    currentStallMa: 650,
    torqueKgCm: 1.8,
    weightG: 9,
    notes: [
      'Quoted torque is STALL at 6 V; usable continuous is roughly a third.',
      'Plastic gears strip under shock loads.',
    ],
  },
  {
    id: 'towerpro-mg90s',
    family: 'MG90S',
    manufacturer: 'Tower Pro',
    kind: 'servo',
    supplyMinV: 4.8,
    supplyMaxV: 6.0,
    currentTypMa: 200,
    currentStallMa: 700,
    torqueKgCm: 2.2,
    weightG: 13,
    notes: ['Metal gears — the usual drop-in upgrade from SG90.'],
  },
  {
    id: 'towerpro-mg996r',
    family: 'MG996R',
    manufacturer: 'Tower Pro',
    kind: 'servo',
    supplyMinV: 4.8,
    supplyMaxV: 7.2,
    currentTypMa: 500,
    currentStallMa: 2500,
    torqueKgCm: 11,
    weightG: 55,
  },
  {
    id: 'texas-instruments-tps63031',
    family: 'TPS63031',
    manufacturer: 'Texas Instruments',
    officialUrl: 'https://www.ti.com/product/TPS63031',
    kind: 'regulator',
    inputMinV: 1.8,
    inputMaxV: 5.5,
    outputMaxMa: 500,
    outputs: 1,
    notes: ['Single adjustable output — one regulator cannot produce two rails.'],
  },
  {
    id: 'texas-instruments-bq24074',
    family: 'BQ24074',
    manufacturer: 'Texas Instruments',
    officialUrl: 'https://www.ti.com/product/BQ24074',
    kind: 'charger',
    inputMinV: 4.35,
    inputMaxV: 10.2,
    outputMaxMa: 1500,
    outputs: 2,
  },
  {
    id: 'generic-18650',
    family: '18650',
    kind: 'battery',
    nominalV: 3.7,
    supplyMinV: 3.0,
    supplyMaxV: 4.2,
    capacityMah: 2500,
    maxContinuousMa: 5000,
    notes: ['A form factor, not a part number — capacity and discharge rating vary wildly.'],
  },
  {
    id: 'nxp-pca9685',
    family: 'PCA9685',
    manufacturer: 'NXP',
    officialUrl: 'https://www.nxp.com/products/PCA9685',
    kind: 'driver',
    supplyMinV: 2.3,
    supplyMaxV: 5.5,
    currentTypMa: 10,
    channels: 16,
    notes: ['Standard 16-channel I2C PWM driver for servo banks.'],
  },
  {
    id: 'bosch-bme280',
    family: 'BME280',
    manufacturer: 'Bosch Sensortec',
    officialUrl:
      'https://www.bosch-sensortec.com/products/environmental-sensors/humidity-sensors-bme280/',
    kind: 'sensor',
    supplyMinV: 1.71,
    supplyMaxV: 3.6,
    currentTypMa: 1,
  },
  {
    id: 'invensense-mpu6050',
    family: 'MPU6050',
    manufacturer: 'InvenSense',
    kind: 'sensor',
    supplyMinV: 2.375,
    supplyMaxV: 3.46,
    currentTypMa: 4,
  },
];

const INDEX = new Map<string, PartSpec>();
for (const part of PARTS) {
  INDEX.set(part.family.toLowerCase(), part);
  INDEX.set(part.id.toLowerCase(), part);
}

/**
 * Resolve a declared part number to a spec.
 * Matches exact ids/families first, then falls back to substring matching so
 * loose strings like "18650 Li-ion" or "SG90 (metal gear)" still resolve.
 */
export function resolvePart(partNumber: string | null | undefined): PartSpec | undefined {
  if (!partNumber) return undefined;
  const key = partNumber.trim().toLowerCase();
  if (!key) return undefined;

  const exact = INDEX.get(key);
  if (exact) return exact;

  for (const part of PARTS) {
    const family = part.family.toLowerCase();
    if (key.includes(family) || family.includes(key)) return part;
  }
  return undefined;
}

/** True for anything that can source energy into the system. */
export function isPowerSource(spec: PartSpec | undefined, nodeType: string): boolean {
  if (spec?.kind === 'battery' || spec?.kind === 'charger') return true;
  return nodeType === 'power' && Boolean(spec?.outputMaxMa);
}

/** Rough usable continuous torque — stall torque / 3. */
export function usableTorque(spec: PartSpec | undefined): number | undefined {
  return spec?.torqueKgCm === undefined ? undefined : spec.torqueKgCm / 3;
}
