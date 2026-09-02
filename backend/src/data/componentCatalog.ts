/**
 * Seed dataset of real, purchasable parts with published electrical facts.
 *
 * This is reference evidence for the planner and the verifier — it is NOT an
 * electrical rules engine. The independent verifier stays authoritative.
 */
export type OfficialComponentRecord = {
  id: string;
  manufacturer: string;
  family: string;
  partNumbers: string[];
  officialUrl: string;
  facts: Record<string, string>;
  interfaceNotes: string[];
};

export const officialComponentCatalog: OfficialComponentRecord[] = [
  {
    id: 'nordic-nrf52840',
    manufacturer: 'Nordic Semiconductor',
    family: 'nRF52840',
    partNumbers: ['nRF52840-QIAA', 'nRF52840-CAAA'],
    officialUrl: 'https://www.nordicsemi.com/Products/nRF52840',
    facts: {
      supply: '1.7–5.5 V',
      interfaces: 'USB, SPI, I2C, UART, PWM, BLE 5.4',
      memory: '1 MB flash, 256 KB RAM',
      package: 'QFN-73 or WLCSP',
    },
    interfaceNotes: [
      'Use the Nordic product specification for pin multiplexing and RF layout.',
      'The radio is integrated; do not model it as a separate external radio unless the selected part changes.',
    ],
  },
  {
    id: 'bosch-bme280',
    manufacturer: 'Bosch Sensortec',
    family: 'BME280',
    partNumbers: ['BME280'],
    officialUrl:
      'https://www.bosch-sensortec.com/products/environmental-sensors/humidity-sensors-bme280/',
    facts: {
      supply: '1.71–3.6 V',
      interfaces: 'I2C or SPI',
      address: '0x76 or 0x77',
      measures: 'humidity, pressure, temperature',
    },
    interfaceNotes: [
      'I2C requires pull-up resistors sized for the bus capacitance and selected rail.',
      "Confirm the breakout board's regulator and level shifting before connecting to a host rail.",
    ],
  },
  {
    id: 'texas-instruments-bq24074',
    manufacturer: 'Texas Instruments',
    family: 'BQ24074',
    partNumbers: ['BQ24074'],
    officialUrl: 'https://www.ti.com/product/BQ24074',
    facts: {
      input: '4.35–10.2 V',
      battery: 'single-cell Li-ion/Li-polymer',
      chargeCurrent: 'programmable up to 1.5 A',
      features: 'power-path management, thermal regulation',
    },
    interfaceNotes: [
      'Follow the TI layout and USB input protection guidance.',
      'Battery chemistry, charge current, thermistor behaviour, and termination settings need explicit review.',
    ],
  },
  {
    id: 'texas-instruments-tps63031',
    manufacturer: 'Texas Instruments',
    family: 'TPS63031',
    partNumbers: ['TPS63031'],
    officialUrl: 'https://www.ti.com/product/TPS63031',
    facts: {
      input: '1.8–5.5 V',
      output: 'adjustable buck-boost',
      current: 'up to 500 mA',
      control: 'power-save mode',
    },
    interfaceNotes: [
      'Inductor, output capacitors, feedback resistors, and layout must follow the data sheet.',
      'Check peak current and efficiency at the actual battery and load profile.',
    ],
  },
  {
    id: 'winbond-w25q128jv',
    manufacturer: 'Winbond',
    family: 'W25Q128JV',
    partNumbers: ['W25Q128JVSIQ', 'W25Q128JVSIM'],
    officialUrl:
      'https://www.winbond.com/hq/product/code-storage-flash-memory/serial-nor-flash/?__locale=en&partNo=W25Q128JV',
    facts: {
      density: '128 Mbit',
      interfaces: 'SPI, Dual SPI, Quad SPI',
      supply: '2.7–3.6 V',
      package: 'SOIC-8, WSON-8 and others',
    },
    interfaceNotes: [
      'Unused input pins need defined levels and the device requires a decoupling capacitor.',
      'Quad-SPI timing and IO voltage must match the host controller.',
    ],
  },
  {
    id: 'espressif-esp32-devkit',
    manufacturer: 'Espressif Systems',
    family: 'ESP32-DEVKIT',
    partNumbers: ['ESP32-WROOM-32', 'ESP32-DevKitC'],
    officialUrl: 'https://www.espressif.com/en/products/devkits/esp32-devkitc',
    facts: {
      supply: '3.3–5.0 V',
      interfaces: 'Wi-Fi 802.11 b/g/n, Bluetooth v4.2 BR/EDR & BLE, I2C, SPI, UART, PWM, ADC, DAC',
      cpu: 'Xtensa Dual-Core 32-bit LX6 @ up to 240 MHz',
      flash: '4 MB SPI Flash',
    },
    interfaceNotes: [
      'Strapping pins (GPIO 0, 2, 5, 12, 15) have boot-time level constraints.',
      'GPIO 34-39 are input-only pins with no internal pull-up/pull-down or output drivers.',
    ],
  },
  {
    id: 'aosong-dht22',
    manufacturer: 'Aosong Electronics',
    family: 'DHT22',
    partNumbers: ['AM2302', 'DHT22'],
    officialUrl: 'https://www.sparkfun.com/datasheets/Sensors/Temperature/DHT22.pdf',
    facts: {
      supply: '3.3–6.0 V',
      interfaces: 'Single-wire digital bus',
      measures: 'Temperature (-40..80 °C), Humidity (0..100 %RH)',
      accuracy: '±0.5 °C temp, ±2-5 %RH humidity',
    },
    interfaceNotes: [
      'Requires a 4.7kΩ–10kΩ pull-up resistor on the DATA line to 3.3V.',
      'Sampling period should not be faster than 2 seconds between readings.',
    ],
  },
  {
    id: 'generic-hcsr04',
    manufacturer: 'Generic',
    family: 'HC-SR04',
    partNumbers: ['HC-SR04'],
    officialUrl: 'https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf',
    facts: {
      supply: '5.0 V',
      interfaces: 'Digital pulse trigger and echo',
      range: '2 cm to 400 cm',
      resolution: '0.3 cm',
    },
    interfaceNotes: [
      'ECHO output is 5V logic. When connecting to 3.3V ESP32 GPIO, use a voltage divider (e.g. 1kΩ/2kΩ).',
      'Trigger with a 10 µs pulse on TRIG pin.',
    ],
  },
  {
    id: 'solomon-ssd1306',
    manufacturer: 'Solomon Systech',
    family: 'SSD1306',
    partNumbers: ['SSD1306', 'SSD1306-128X64-I2C'],
    officialUrl: 'https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf',
    facts: {
      supply: '3.3–5.0 V',
      interfaces: 'I2C (default address 0x3C or 0x3D) or SPI',
      resolution: '128x64 monochrome OLED',
    },
    interfaceNotes: [
      'Requires I2C pull-up resistors on SDA/SCL lines.',
      'Shares the I2C bus with other sensor nodes without collision.',
    ],
  },
  {
    id: 'invensense-mpu6050',
    manufacturer: 'InvenSense / TDK',
    family: 'MPU6050',
    partNumbers: ['MPU-6050'],
    officialUrl: 'https://invensense.tdk.com/products/motion-tracking/6-axis/mpu-6050/',
    facts: {
      supply: '2.375–3.46 V (breakouts include 3.3V LDO for 5V input)',
      interfaces: 'I2C (address 0x68 or 0x69 with AD0 pin)',
      measures: '3-axis accelerometer (±2g..±16g) + 3-axis gyroscope (±250°/s..±2000°/s)',
    },
    interfaceNotes: [
      'Standard I2C bus device. Includes Digital Motion Processor (DMP) capability.',
    ],
  },
  {
    id: 'hanwei-mq2',
    manufacturer: 'Hanwei Electronics',
    family: 'MQ-2',
    partNumbers: ['MQ-2'],
    officialUrl: 'https://www.pololu.com/file/0J309/MQ2.pdf',
    facts: {
      supply: '5.0 V (internal heater coil)',
      interfaces: 'Analog voltage output (AO) + Digital threshold output (DO)',
      detects: 'LPG, Propane, Methane, Hydrogen, Alcohol, Smoke',
      heaterPower: 'approx 150-180 mA @ 5V',
    },
    interfaceNotes: [
      'Heater coil requires 5V supply and pre-heating burn-in time.',
      'Analog AO output (0-5V) requires voltage division before feeding ESP32 3.3V ADC inputs.',
    ],
  },
  {
    id: 'towerpro-sg90',
    manufacturer: 'TowerPro',
    family: 'SG90',
    partNumbers: ['SG90', 'MG90S'],
    officialUrl: 'http://www.ee.ic.ac.uk/pcheung/teaching/DE1_EE/stores/sg90_datasheet.pdf',
    facts: {
      supply: '4.8–6.0 V',
      interfaces: '50 Hz PWM (500–2400 µs pulse width for 0–180° rotation)',
      torque: '1.8 kg·cm @ 4.8V',
      stallCurrent: 'up to 650 mA',
    },
    interfaceNotes: [
      'Never drive servo motor VCC directly from the MCU 3.3V rail. Use 5V VIN or external supply.',
      'PWM control pin is compatible with 3.3V logic signals.',
    ],
  },
];

/** Serialised into the planner prompt as the evidence bank. */
export function catalogAsPrompt(): string {
  return JSON.stringify(officialComponentCatalog);
}

/** Records referenced by the current graph — used for citations. */
export function catalogMatches(graph: Record<string, unknown>): OfficialComponentRecord[] {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const searchable = nodes
    .flatMap((node) => {
      if (!node || typeof node !== 'object') return [];
      const item = node as Record<string, unknown>;
      return [item.partNumber, item.part, item.name, item.label].filter(Boolean).map(String);
    })
    .join(' ')
    .toLowerCase();

  return officialComponentCatalog.filter((record) =>
    [record.family, ...record.partNumbers].some((term) =>
      searchable.includes(term.toLowerCase()),
    ),
  );
}

export function catalogSources(records: OfficialComponentRecord[]): {
  title: string;
  url: string;
  usedFor: string;
}[] {
  return records.map((record) => ({
    title: `${record.manufacturer} ${record.family} official product page`,
    url: record.officialUrl,
    usedFor: record.facts.interfaces ?? record.facts.supply ?? 'component identity',
  }));
}