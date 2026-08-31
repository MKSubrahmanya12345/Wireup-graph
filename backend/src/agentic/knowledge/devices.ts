/**
 * Wireup device knowledge base — the retrieval corpus behind the agentic
 * builder. Each entry carries the engineering facts a firmware engineer would
 * look up: electrical windows, bus protocol, pin roles, the real Arduino
 * libraries that exist, the metric schema the dashboard can render, and
 * wiring notes. The pipeline retrieves from here; nothing is hallucinated.
 */

import type { BoardProfile } from '../types.js';

export interface KnowledgeMetric {
  id: string;
  label: string;
  unit: string;
  jsonField: string;
  min?: number;
  max?: number;
}

export interface KnowledgeControl {
  id: string;
  label: string;
  kind: 'toggle' | 'select' | 'button';
  jsonField: string;
  command: Record<string, unknown>;
}

export interface KnowledgePort {
  role: string; // 'vcc' | 'gnd' | 'data' | 'sda' | 'scl' | 'out' | 'sig'
  label: string;
  signal: 'power' | 'ground' | 'digital' | 'analog' | 'i2c' | 'spi' | 'uart' | 'pwm';
  direction: 'in' | 'out' | 'bidirectional';
}

export interface DeviceKnowledge {
  id: string;
  name: string;
  partNumber: string;
  manufacturer: string;
  datasheet: string;
  kind: 'sensor' | 'actuator' | 'display' | 'other';
  bus: 'single-wire' | 'i2c' | 'spi' | 'uart' | 'analog' | 'pwm' | 'gpio';
  /** Retrieval terms (lowercased). Matched against the brief + graph nodes. */
  aliases: string[];
  summary: string;
  supplyMinV: number;
  supplyMaxV: number;
  ports: KnowledgePort[];
  metrics: KnowledgeMetric[];
  controls: KnowledgeControl[];
  libraries: { name: string; source: string }[];
  firmwareNotes: string[];
  wiringNotes: string[];
}

export const BOARD_PROFILES: BoardProfile[] = [
  {
    id: 'esp32-devkit',
    name: 'ESP32 DevKit',
    mcu: 'ESP32-WROOM-32',
    platformioEnv: 'esp32dev',
    pioBoard: 'esp32dev',
    voltage: 3.3,
    wifi: true,
    archDefine: 'ESP32',
    pinPreferences: {
      'single-wire': ['GPIO4', 'GPIO5', 'GPIO16', 'GPIO17', 'GPIO27'],
      analog: ['GPIO34', 'GPIO35', 'GPIO32', 'GPIO33'],
      pwm: ['GPIO18', 'GPIO19', 'GPIO25', 'GPIO26'],
      // Strapping pins (2, 12, 15) and flash pins (6–11) stay OUT of general
      // output pools — GPIO12/MTDI held high at boot selects a 1.8 V flash
      // rail and bricks the board. The old list led with GPIO2/15/12.
      gpio: ['GPIO13', 'GPIO14', 'GPIO27', 'GPIO33', 'GPIO25', 'GPIO26'],
      uart: ['GPIO16', 'GPIO17'],
      i2c: ['GPIO21', 'GPIO22'],
      onboard_led: ['GPIO2'],
    },
    gpioConstraints: {
      GPIO0: { restriction: 'strapping', note: 'Boot-mode strapping pin (must be HIGH to run firmware).' },
      GPIO2: { restriction: 'strapping', note: 'Strapping pin; must not be LOW at boot. Also the onboard LED on many devkits.' },
      GPIO5: { restriction: 'strapping', note: 'Strapping pin; must be HIGH at boot — a module that pulls it low prevents startup.' },
      GPIO12: { restriction: 'strapping', note: 'MTDI strapping pin: HIGH at boot selects a 1.8 V flash rail and bricks boot. Avoid for outputs.' },
      GPIO15: { restriction: 'strapping', note: 'Strapping pin; silences boot messages if held HIGH — avoid for modules that drive it.' },
      GPIO6: { restriction: 'flash', note: 'Bonded to the SPI flash — never usable.' },
      GPIO7: { restriction: 'flash', note: 'Bonded to the SPI flash — never usable.' },
      GPIO8: { restriction: 'flash', note: 'Bonded to the SPI flash — never usable.' },
      GPIO9: { restriction: 'flash', note: 'Bonded to the SPI flash — never usable.' },
      GPIO10: { restriction: 'flash', note: 'Bonded to the SPI flash — never usable.' },
      GPIO11: { restriction: 'flash', note: 'Bonded to the SPI flash — never usable.' },
      GPIO34: { restriction: 'input-only', note: 'ADC1 input-only pin; no output driver (digitalWrite/PWM/I2C-SDA cannot work).' },
      GPIO35: { restriction: 'input-only', note: 'ADC1 input-only pin; no output driver.' },
      GPIO36: { restriction: 'input-only', note: 'VP / ADC1 input-only pin; no output driver.' },
      GPIO37: { restriction: 'input-only', note: 'VN / ADC1 input-only pin; no output driver.' },
      GPIO38: { restriction: 'input-only', note: 'ADC1 input-only pin; no output driver.' },
      GPIO39: { restriction: 'input-only', note: 'ADC1 input-only pin; no output driver.' },
    },
  },
  {
    id: 'esp32-s3-devkit',
    name: 'ESP32-S3 DevKitC',
    mcu: 'ESP32-S3',
    platformioEnv: 'esp32-s3-devkitc-1',
    pioBoard: 'esp32-s3-devkitc-1',
    voltage: 3.3,
    wifi: true,
    archDefine: 'ESP32',
    pinPreferences: {
      'single-wire': ['GPIO4', 'GPIO5', 'GPIO6', 'GPIO7'],
      analog: ['GPIO1', 'GPIO2'],
      pwm: ['GPIO8', 'GPIO9', 'GPIO10'],
      gpio: ['GPIO11', 'GPIO12', 'GPIO13', 'GPIO14'],
      uart: ['GPIO43', 'GPIO44'],
      i2c: ['GPIO8', 'GPIO9'],
      onboard_led: ['GPIO48'],
    },
    gpioConstraints: {
      GPIO0: { restriction: 'strapping', note: 'Boot-mode strapping pin.' },
      GPIO3: { restriction: 'strapping', note: 'Strapping pin (JTAG signal source select).' },
      GPIO45: { restriction: 'strapping', note: 'VDD_SPI strapping pin; must be LOW at boot for 3.3 V flash.' },
      GPIO46: { restriction: 'strapping', note: 'Strapping pin — must be LOW for download mode; input-only too.' },
      GPIO19: { restriction: 'reserved', note: 'USB D- on the native USB/JTAG interface.' },
      GPIO20: { restriction: 'reserved', note: 'USB D+ on the native USB/JTAG interface.' },
      GPIO26: { restriction: 'flash', note: 'Bonded to SPI flash/PSRAM on WROOM modules — unavailable.' },
      GPIO27: { restriction: 'flash', note: 'Bonded to SPI flash/PSRAM on WROOM modules — unavailable.' },
      GPIO28: { restriction: 'flash', note: 'Bonded to SPI flash/PSRAM on WROOM modules — unavailable.' },
      GPIO29: { restriction: 'flash', note: 'Bonded to SPI flash/PSRAM on WROOM modules — unavailable.' },
      GPIO30: { restriction: 'flash', note: 'Bonded to SPI flash/PSRAM on WROOM modules — unavailable.' },
      GPIO31: { restriction: 'flash', note: 'Bonded to SPI flash/PSRAM on WROOM modules — unavailable.' },
      GPIO32: { restriction: 'flash', note: 'Bonded to SPI flash/PSRAM on WROOM modules — unavailable.' },
    },
  },
];

export const DEVICE_KNOWLEDGE: DeviceKnowledge[] = [
  {
    id: 'dht22',
    name: 'DHT22 (AM2302) Temperature & Humidity Sensor',
    partNumber: 'AM2302/DHT22',
    manufacturer: 'Aosong Electronics',
    datasheet: 'https://www.sparkfun.com/datasheets/Sensors/Temperature/DHT22.pdf',
    kind: 'sensor',
    bus: 'single-wire',
    aliases: [
      'dht22', 'am2302', 'dht-22', 'temp humidity', 'temperature and humidity',
      'temperature humidity sensor', 'humidity sensor', 'temperature sensor',
    ],
    summary:
      'Calibrated digital temperature (-40..80 °C, ±0.5 °C) and relative humidity (0–100 %RH, ±2–5 %) sensor on a proprietary single-wire bus. One reading every 2 s max.',
    supplyMinV: 3.3,
    supplyMaxV: 6.0,
    ports: [
      { role: 'vcc', label: 'VCC (3.3–6 V)', signal: 'power', direction: 'in' },
      { role: 'data', label: 'DATA (single-wire)', signal: 'digital', direction: 'bidirectional' },
      { role: 'gnd', label: 'GND', signal: 'ground', direction: 'in' },
    ],
    metrics: [
      { id: 'temperature', label: 'Temperature', unit: '°C', jsonField: 'temperature_c', min: -40, max: 80 },
      { id: 'humidity', label: 'Humidity', unit: '%', jsonField: 'humidity_pct', min: 0, max: 100 },
    ],
    controls: [],
    libraries: [
      { name: 'DHT sensor library', source: 'adafruit/DHT sensor library@^1.4.6' },
      { name: 'Adafruit Unified Sensor', source: 'adafruit/Adafruit Unified Sensor@^1.1.15' },
    ],
    firmwareNotes: [
      'DHT22 needs ≥2 s between reads; the sampler guards this.',
      'readTemperature()/readHumidity() return NaN on checksum failure — always isnan() guard before publishing.',
    ],
    wiringNotes: [
      '10 kΩ pull-up between DATA and 3V3 is required on bare modules (most PCBs include one).',
      'Pin 1 VCC → 3V3, Pin 2 DATA → MCU GPIO, Pin 4 GND. Pin 3 is not connected.',
      'Keep cable under 20 m; use 3.3 V (within the 3.3–6 V window) for direct GPIO compatibility.',
    ],
  },
  {
    id: 'dht11',
    name: 'DHT11 Temperature & Humidity Sensor',
    partNumber: 'DHT11',
    manufacturer: 'Aosong Electronics',
    datasheet: 'https://www.mouser.com/datasheet/2/758/DHT11-Technical-Data-Sheet-Translated-Version-1143054.pdf',
    kind: 'sensor',
    bus: 'single-wire',
    aliases: ['dht11', 'dht-11', 'cheap humidity sensor'],
    summary:
      'Budget digital temperature (0–50 °C, ±2 °C) and humidity (20–90 %RH, ±5 %) sensor, same single-wire protocol as the DHT22. One reading per second max.',
    supplyMinV: 3.3,
    supplyMaxV: 5.5,
    ports: [
      { role: 'vcc', label: 'VCC (3.3–5.5 V)', signal: 'power', direction: 'in' },
      { role: 'data', label: 'DATA (single-wire)', signal: 'digital', direction: 'bidirectional' },
      { role: 'gnd', label: 'GND', signal: 'ground', direction: 'in' },
    ],
    metrics: [
      { id: 'temperature', label: 'Temperature', unit: '°C', jsonField: 'temperature_c', min: 0, max: 50 },
      { id: 'humidity', label: 'Humidity', unit: '%', jsonField: 'humidity_pct', min: 20, max: 90 },
    ],
    controls: [],
    libraries: [
      { name: 'DHT sensor library', source: 'adafruit/DHT sensor library@^1.4.6' },
      { name: 'Adafruit Unified Sensor', source: 'adafruit/Adafruit Unified Sensor@^1.1.15' },
    ],
    firmwareNotes: ['Construct the driver as DHT dht(PIN, DHT11); same API as DHT22.'],
    wiringNotes: ['10 kΩ pull-up DATA → 3V3.', 'Pinout matches DHT22: VCC, DATA, NC, GND.'],
  },
  {
    id: 'bme280',
    name: 'BME280 Pressure, Temperature & Humidity Sensor',
    partNumber: 'BME280',
    manufacturer: 'Bosch Sensortec',
    datasheet: 'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme280-ds002.pdf',
    kind: 'sensor',
    bus: 'i2c',
    aliases: ['bme280', 'pressure sensor', 'barometer', 'barometric pressure', 'bmp280'],
    summary:
      'I2C/SPI environmental sensor: pressure 300–1100 hPa (±1 hPa), temperature -40..85 °C, humidity 0–100 %RH. Default I2C address 0x76 (0x77 with SDO high).',
    supplyMinV: 1.71,
    supplyMaxV: 3.6,
    ports: [
      { role: 'vcc', label: 'VCC (1.8–3.6 V)', signal: 'power', direction: 'in' },
      { role: 'gnd', label: 'GND', signal: 'ground', direction: 'in' },
      { role: 'sda', label: 'SDA', signal: 'i2c', direction: 'bidirectional' },
      { role: 'scl', label: 'SCL', signal: 'i2c', direction: 'in' },
    ],
    metrics: [
      { id: 'temperature', label: 'Temperature', unit: '°C', jsonField: 'temperature_c', min: -40, max: 85 },
      { id: 'humidity', label: 'Humidity', unit: '%', jsonField: 'humidity_pct', min: 0, max: 100 },
      { id: 'pressure', label: 'Pressure', unit: 'hPa', jsonField: 'pressure_hpa', min: 300, max: 1100 },
    ],
    controls: [],
    libraries: [{ name: 'Adafruit BME280 Library', source: 'adafruit/Adafruit BME280 Library@^2.2.4' }],
    firmwareNotes: ['Call bme.begin(0x76) and check the return value; many breakouts use 0x76, some 0x77.'],
    wiringNotes: [
      '3.3 V only — the BME280 is not 5 V tolerant without a level shifter.',
      'I2C pull-ups are usually on the breakout; ESP32 internal pull-ups suffice for short runs.',
    ],
  },
  {
    id: 'ds18b20',
    name: 'DS18B20 1-Wire Temperature Sensor',
    partNumber: 'DS18B20',
    manufacturer: 'Analog Devices / Maxim',
    datasheet: 'https://www.analog.com/media/en/technical-documentation/data-sheets/DS18B20.pdf',
    kind: 'sensor',
    bus: 'single-wire',
    aliases: ['ds18b20', '1-wire temperature', 'waterproof temperature', 'one wire temp'],
    summary: '1-Wire digital thermometer (-55..125 °C, ±0.5 °C in -10..85 °C), 9–12 bit, unique 64-bit ROM per probe, parasite-power capable.',
    supplyMinV: 3.0,
    supplyMaxV: 5.5,
    ports: [
      { role: 'vcc', label: 'VDD (3–5.5 V)', signal: 'power', direction: 'in' },
      { role: 'data', label: 'DQ (1-Wire)', signal: 'digital', direction: 'bidirectional' },
      { role: 'gnd', label: 'GND', signal: 'ground', direction: 'in' },
    ],
    metrics: [{ id: 'temperature', label: 'Temperature', unit: '°C', jsonField: 'temperature_c', min: -55, max: 125 }],
    controls: [],
    libraries: [
      { name: 'OneWire', source: 'paulstoffregen/OneWire@^2.3.8' },
      { name: 'DallasTemperature', source: 'milesburton/DallasTemperature@^3.11.0' },
    ],
    firmwareNotes: ['requestTemperatures() blocks up to 750 ms at 12-bit; keep the sampler period ≥1 s.'],
    wiringNotes: ['4.7 kΩ pull-up DQ → 3V3 is mandatory.', 'Waterproof probes: red VDD, black GND, yellow DQ.'],
  },
  {
    id: 'soil-moisture',
    name: 'Capacitive Soil Moisture Sensor (analog)',
    partNumber: 'CAP-SOIL-V1.2',
    manufacturer: 'Generic',
    datasheet: 'https://www.amazon.com/dp/B07GHXZQV6',
    kind: 'sensor',
    bus: 'analog',
    aliases: ['soil moisture', 'capacitive soil', 'plant moisture', 'soil sensor'],
    summary: 'Analog capacitive soil moisture probe, output 1.2–3.0 V inversely proportional to moisture. Calibrate dry/wet points per installation.',
    supplyMinV: 3.3,
    supplyMaxV: 5.5,
    ports: [
      { role: 'vcc', label: 'VCC (3.3 V)', signal: 'power', direction: 'in' },
      { role: 'sig', label: 'AOUT', signal: 'analog', direction: 'out' },
      { role: 'gnd', label: 'GND', signal: 'ground', direction: 'in' },
    ],
    metrics: [{ id: 'moisture', label: 'Soil moisture', unit: '%', jsonField: 'moisture_pct', min: 0, max: 100 }],
    controls: [],
    libraries: [],
    firmwareNotes: ['Use analogReadMilliVolts() on ESP32 and map between calibrated dry/wet millivolt points.'],
    wiringNotes: ['Use an ADC1 pin (GPIO32–39) — ADC2 conflicts with Wi-Fi.', 'Do not power above 3.3 V into a 3.3 V ADC.'],
  },
  {
    id: 'relay-1ch',
    name: 'Single-Channel Relay Module',
    partNumber: 'RELAY-1CH-5V',
    manufacturer: 'Generic',
    datasheet: 'https://components101.com/switches/5v-single-channel-relay-module-pinout-features-applications-working-datasheet',
    kind: 'actuator',
    bus: 'gpio',
    aliases: ['relay', 'relay module', 'switch relay', 'power switch', '1 channel relay'],
    summary:
      'Opto-isolated 5 V relay board switching up to 10 A 250 VAC / 10 A 30 VDC. IN pin is usually active-LOW on these modules.',
    supplyMinV: 5,
    supplyMaxV: 5,
    ports: [
      { role: 'vcc', label: 'VCC (5 V)', signal: 'power', direction: 'in' },
      { role: 'in', label: 'IN (active-LOW)', signal: 'digital', direction: 'in' },
      { role: 'gnd', label: 'GND', signal: 'ground', direction: 'in' },
    ],
    metrics: [],
    controls: [
      { id: 'relay', label: 'Relay', kind: 'toggle', jsonField: 'relay_state', command: { field: 'state', on: 'on', off: 'off' } },
    ],
    libraries: [],
    firmwareNotes: ['Most modules are active-LOW: digitalWrite LOW energises the coil. The generated driver inverts for an active-HIGH API.'],
    wiringNotes: [
      'Power the coil from 5 V (VIN on ESP32 devkits), control from a 3.3 V GPIO through the optocoupler.',
      'Switch only the load side through COM/NO; keep mains wiring fused and insulated.',
    ],
  },
  {
    id: 'servo-sg90',
    name: 'SG90 Micro Servo',
    partNumber: 'SG90',
    manufacturer: 'TowerPro',
    datasheet: 'http://www.ee.ic.ac.uk/pcheung/teaching/DE1_EE/stores/sg90_datasheet.pdf',
    kind: 'actuator',
    bus: 'pwm',
    aliases: ['servo', 'sg90', 'micro servo', 'servo motor'],
    summary: 'Hobby servo 0–180 ° driven by 50 Hz PWM (500–2400 µs pulses). Stall current ~650 mA — never power from the 3V3 rail.',
    supplyMinV: 4.8,
    supplyMaxV: 6,
    ports: [
      { role: 'vcc', label: 'VCC (4.8–6 V)', signal: 'power', direction: 'in' },
      { role: 'sig', label: 'PWM signal', signal: 'pwm', direction: 'in' },
      { role: 'gnd', label: 'GND', signal: 'ground', direction: 'in' },
    ],
    metrics: [],
    controls: [
      { id: 'servo_angle', label: 'Servo angle', kind: 'select', jsonField: 'servo_deg', command: { field: 'angle', options: ['0', '45', '90', '135', '180'] } },
    ],
    libraries: [{ name: 'ESP32Servo', source: 'madhephaestus/ESP32Servo@^3.0.6' }],
    firmwareNotes: ['Use ESP32Servo with setPeriodHertz(50) and attach(pin, 500, 2400).'],
    wiringNotes: ['Brown/orange wire = PWM to GPIO, red = 5 V, brown/black = GND. Common ground with the MCU.'],
  },
  {
    id: 'led-indicator',
    name: 'Status LED',
    partNumber: 'LED-5MM',
    manufacturer: 'Generic',
    datasheet: 'https://www.farnell.com/datasheets/1498852.pdf',
    kind: 'actuator',
    bus: 'gpio',
    aliases: ['led', 'status led', 'indicator led', 'light'],
    summary: '5 mm indicator LED with series resistor ~220 Ω at 3.3 V (≈10 mA).',
    supplyMinV: 2,
    supplyMaxV: 3.4,
    ports: [
      { role: 'sig', label: 'Anode via resistor', signal: 'digital', direction: 'in' },
      { role: 'gnd', label: 'Cathode (GND)', signal: 'ground', direction: 'in' },
    ],
    metrics: [],
    controls: [
      { id: 'led', label: 'LED', kind: 'toggle', jsonField: 'led_state', command: { field: 'state', on: 'on', off: 'off' } },
    ],
    libraries: [],
    firmwareNotes: ['Drive through a GPIO with a 220 Ω series resistor.'],
    wiringNotes: ['Long leg (anode) to GPIO through the resistor; short leg to GND.'],
  },
  {
    id: 'ssd1306',
    name: 'SSD1306 0.96" OLED Display (I2C)',
    partNumber: 'SSD1306-128X64-I2C',
    manufacturer: 'Solomon Systech',
    datasheet: 'https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf',
    kind: 'display',
    bus: 'i2c',
    aliases: ['oled', 'ssd1306', 'display', 'screen', 'oled display'],
    summary: 'Monochrome 128×64 OLED, I2C at 0x3C, 3.3–5 V logic.',
    supplyMinV: 3.3,
    supplyMaxV: 5,
    ports: [
      { role: 'vcc', label: 'VCC (3.3–5 V)', signal: 'power', direction: 'in' },
      { role: 'gnd', label: 'GND', signal: 'ground', direction: 'in' },
      { role: 'sda', label: 'SDA', signal: 'i2c', direction: 'bidirectional' },
      { role: 'scl', label: 'SCL', signal: 'i2c', direction: 'in' },
    ],
    metrics: [],
    controls: [],
    libraries: [{ name: 'Adafruit SSD1306', source: 'adafruit/Adafruit SSD1306@^2.5.13' }],
    firmwareNotes: ['Instantiate Adafruit_SSD1306 display(128, 64, &Wire, -1) and begin(SSD1306_SWITCHCAPVCC, 0x3C).'],
    wiringNotes: ['Shares the I2C bus with other I2C modules; addresses 0x3C (sometimes 0x3D).'],
  },
  {
    id: 'mq2-gas',
    name: 'MQ-2 Gas / Smoke Sensor',
    partNumber: 'MQ-2',
    manufacturer: 'Hanwei Electronics',
    datasheet: 'https://www.pololu.com/file/0J309/MQ2.pdf',
    kind: 'sensor',
    bus: 'analog',
    aliases: ['mq2', 'mq-2', 'gas sensor', 'smoke sensor', 'lpg sensor'],
    summary: 'MOS gas sensor for LPG, smoke and CO with analog output; heater needs 5 V ~150 mA and a 24 h burn-in for stability.',
    supplyMinV: 5,
    supplyMaxV: 5,
    ports: [
      { role: 'vcc', label: 'VCC (5 V)', signal: 'power', direction: 'in' },
      { role: 'sig', label: 'AO', signal: 'analog', direction: 'out' },
      { role: 'gnd', label: 'GND', signal: 'ground', direction: 'in' },
    ],
    metrics: [{ id: 'gas_ppm', label: 'Gas level', unit: 'ppm', jsonField: 'gas_ppm', min: 300, max: 10000 }],
    controls: [],
    libraries: [],
    firmwareNotes: ['AO drives up to 5 V — use a voltage divider into the 3.3 V ADC.', 'Calibrate R0 in clean air per the datasheet curve.'],
    wiringNotes: ['Voltage divider (e.g. 10 kΩ/20 kΩ) between AO and the ADC pin.', 'Heater must run from 5 V.'],
  },
  {
    id: 'hcsr04',
    name: 'HC-SR04 Ultrasonic Distance Sensor',
    partNumber: 'HC-SR04',
    manufacturer: 'Generic',
    datasheet: 'https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf',
    kind: 'sensor',
    bus: 'gpio',
    aliases: ['hc-sr04', 'hcsr04', 'ultrasonic', 'distance sensor'],
    summary: 'Ultrasonic ranger 2–400 cm. Trigger 10 µs pulse, measure echo high-time; cm = µs / 58. Echo is 5 V — divider into the ESP32 pin.',
    supplyMinV: 5,
    supplyMaxV: 5,
    ports: [
      { role: 'vcc', label: 'VCC (5 V)', signal: 'power', direction: 'in' },
      { role: 'trig', label: 'TRIG', signal: 'digital', direction: 'in' },
      { role: 'echo', label: 'ECHO (5 V!)', signal: 'digital', direction: 'out' },
      { role: 'gnd', label: 'GND', signal: 'ground', direction: 'in' },
    ],
    metrics: [{ id: 'distance', label: 'Distance', unit: 'cm', jsonField: 'distance_cm', min: 2, max: 400 }],
    controls: [],
    libraries: [],
    firmwareNotes: ['pulseIn(ECHO, HIGH, 30000) bounds the wait at 30 ms (~5 m).'],
    wiringNotes: ['Divide ECHO 5 V → 3.3 V (1 kΩ/2 kΩ).', 'TRIG is 3.3 V tolerant.'],
  },
  {
    id: 'pir-hcsr501',
    name: 'HC-SR501 PIR Motion Sensor',
    partNumber: 'HC-SR501',
    manufacturer: 'Generic',
    datasheet: 'https://www.mpja.com/download/31227sc.pdf',
    kind: 'sensor',
    bus: 'gpio',
    aliases: ['pir', 'motion sensor', 'hc-sr501', 'movement sensor'],
    summary: 'Passive infrared motion detector, digital output HIGH on motion, 5 V supply with 3.3 V-compatible output.',
    supplyMinV: 4.5,
    supplyMaxV: 12,
    ports: [
      { role: 'vcc', label: 'VCC (5 V)', signal: 'power', direction: 'in' },
      { role: 'sig', label: 'OUT', signal: 'digital', direction: 'out' },
      { role: 'gnd', label: 'GND', signal: 'ground', direction: 'in' },
    ],
    metrics: [{ id: 'motion', label: 'Motion', unit: '', jsonField: 'motion', min: 0, max: 1 }],
    controls: [],
    libraries: [],
    firmwareNotes: ['OUT idles LOW, goes 3.3 V HIGH on motion; treat as a plain digital input.'],
    wiringNotes: ['Allow ~60 s warm-up after power-on before trusting readings.'],
  },
];
