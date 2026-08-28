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