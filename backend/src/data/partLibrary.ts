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
    id: 'espressif-esp32-devkit',
    family: 'ESP32-DEVKIT',
    manufacturer: 'Espressif',
    officialUrl: 'https://www.espressif.com/en/products/devkits',
    kind: 'mcu',
    // Devkits tolerate 5 V into VIN (onboard regulator makes the 3.3 V rail).
    supplyMinV: 3.3,
    supplyMaxV: 5.5,
    currentTypMa: 120,
    currentMaxMa: 500,
    notes: ['3V3 pin budget is ~250 mA total — never feed 5 V loads from it.'],
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
    id: 'aosong-dht22',
    family: 'DHT22',
    manufacturer: 'Aosong Electronics',
    officialUrl: 'https://www.sparkfun.com/datasheets/Sensors/Temperature/DHT22.pdf',
    kind: 'sensor',
    supplyMinV: 3.3,
    supplyMaxV: 6.0,
    currentTypMa: 1.5,
    currentMaxMa: 2.5,
    notes: ['Max one reading per 2 s.', '10 kΩ pull-up on DATA.'],
  },
  {
    id: 'aosong-dht11',
    family: 'DHT11',
    manufacturer: 'Aosong Electronics',
    officialUrl: 'https://www.mouser.com/datasheet/2/758/DHT11-Technical-Data-Sheet-Translated-Version-1143054.pdf',
    kind: 'sensor',
    supplyMinV: 3.3,
    supplyMaxV: 5.5,
    currentTypMa: 1.0,
    currentMaxMa: 2.5,
  },
  {
    id: 'maxim-ds18b20',
    family: 'DS18B20',
    manufacturer: 'Analog Devices / Maxim',
    officialUrl: 'https://www.analog.com/media/en/technical-documentation/data-sheets/DS18B20.pdf',
    kind: 'sensor',
    supplyMinV: 3.0,
    supplyMaxV: 5.5,
    currentTypMa: 1.0,
    currentMaxMa: 1.5,
  },
  {
    id: 'generic-cap-soil',
    family: 'CAP-SOIL',
    manufacturer: 'Generic',
    kind: 'sensor',
    supplyMinV: 3.3,
    supplyMaxV: 5.5,
    currentTypMa: 5,
    currentMaxMa: 10,
  },
  {
    id: 'hanwei-mq2',
    family: 'MQ-2',
    manufacturer: 'Hanwei Electronics',
    officialUrl: 'https://www.pololu.com/file/0J309/MQ2.pdf',
    kind: 'sensor',
    supplyMinV: 5.0,
    supplyMaxV: 5.0,
    currentTypMa: 150,
    currentMaxMa: 200,
    notes: ['Heater coil dominates draw — must be fed 5 V.'],
  },
  {
    id: 'generic-hcsr04',
    family: 'HC-SR04',
    manufacturer: 'Generic',
    officialUrl: 'https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf',
    kind: 'sensor',
    supplyMinV: 5.0,
    supplyMaxV: 5.0,
    currentTypMa: 15,
    currentMaxMa: 30,
  },
  {
    id: 'generic-hcsr501',
    family: 'HC-SR501',
    manufacturer: 'Generic',
    kind: 'sensor',
    supplyMinV: 4.5,
    supplyMaxV: 12,
    currentTypMa: 0.065,
    currentMaxMa: 1,
  },
  {
    id: 'generic-relay-1ch',
    family: 'RELAY-1CH-5V',
    manufacturer: 'Generic',
    officialUrl: 'https://components101.com/switches/5v-single-channel-relay-module-pinout-features-applications-working-datasheet',
    kind: 'other',
    supplyMinV: 5.0,
    supplyMaxV: 5.0,
    currentTypMa: 90,
    currentMaxMa: 120,
    notes: ['IN pin is active-LOW on most boards.'],
  },
  {
    id: 'generic-led-5mm',
    family: 'LED-5MM',
    manufacturer: 'Generic',
    kind: 'other',
    supplyMinV: 2.0,
    supplyMaxV: 3.4,
    currentTypMa: 10,
    currentMaxMa: 20,
  },
  {
    id: 'solomon-ssd1306',
    family: 'SSD1306',
    manufacturer: 'Solomon Systech',
    officialUrl: 'https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf',
    kind: 'other',
    supplyMinV: 3.3,
    supplyMaxV: 5.0,
    currentTypMa: 20,
    currentMaxMa: 30,
  },
  {
    id: 'generic-usb-5v',
    family: 'USB-5V',
    manufacturer: 'Generic',
    kind: 'other',
    outputV: [5],
    outputMaxMa: 2000,
    notes: ['Standard 5 V USB wall adapter / port supply.'],
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
