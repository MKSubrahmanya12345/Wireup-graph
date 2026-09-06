import type { ArchitectureNode, NodeType } from '../types/architecture';
import { dimForKey } from '../three/dimensions';

/**
 * Live component detection for page 01.
 *
 * Before the planner has run there is no graph yet — but the human is already
 * typing, and answering questions. This mirrors the backend knowledge base's
 * alias matching closely enough to put a shape on the bench for every part
 * Wireup can already see, and it re-runs on every keystroke/answer so the 3D
 * view resolves in step with the Q&A.
 *
 * Once the real graph exists, page 01 renders THAT instead — this is only the
 * pre-graph preview.
 */

interface DetectableComponent {
  id: string;
  name: string;
  partNumber: string;
  type: NodeType;
  aliases: string[];
  supply: string;
  /** Fine 3D key into the true-scale dimensions table. */
  dimKey: string;
}

const CATALOG: DetectableComponent[] = [
  {
    id: 'esp32',
    name: 'ESP32 DevKit',
    partNumber: 'ESP32-WROOM-32',
    type: 'controller',
    aliases: ['esp32', 'esp-32', 'esp 32', 'wroom', 'devkit'],
    supply: '3.3 V',
    dimKey: 'esp32-devkit-v1',
  },
  {
    id: 'esp8266',
    name: 'ESP8266 NodeMCU',
    partNumber: 'ESP8266',
    type: 'controller',
    aliases: ['esp8266', 'nodemcu'],
    supply: '3.3 V',
    dimKey: 'esp8266',
  },
  { id: 'dht22', name: 'DHT22 temp/humidity', partNumber: 'AM2302', type: 'sensor', aliases: ['dht22', 'am2302', 'dht-22'], supply: '3.3–6 V', dimKey: 'dht22' },
  { id: 'dht11', name: 'DHT11 temp/humidity', partNumber: 'DHT11', type: 'sensor', aliases: ['dht11', 'dht-11'], supply: '3.3–5 V', dimKey: 'dht11' },
  { id: 'bme280', name: 'BME280 environment', partNumber: 'BME280', type: 'sensor', aliases: ['bme280', 'bmp280', 'pressure sensor'], supply: '3.3 V', dimKey: 'bme280' },
  { id: 'ds18b20', name: 'DS18B20 probe', partNumber: 'DS18B20', type: 'sensor', aliases: ['ds18b20', 'dallas', 'waterproof temperature'], supply: '3.3–5 V', dimKey: 'ds18b20' },
  { id: 'yl69', name: 'YL-69 soil probe', partNumber: 'YL-69', type: 'sensor', aliases: ['yl-69', 'yl69', 'resistive soil'], supply: '5 V', dimKey: 'soil-resistive' },
  { id: 'soil', name: 'Soil moisture sensor', partNumber: 'SOIL-CAP-1.2', type: 'sensor', aliases: ['soil', 'moisture'], supply: '3.3 V', dimKey: 'cap-soil' },
  { id: 'mq2', name: 'MQ-2 gas sensor', partNumber: 'MQ-2', type: 'sensor', aliases: ['mq2', 'mq-2', 'gas sensor', 'smoke'], supply: '5 V', dimKey: 'mq-2' },
  { id: 'hcsr04', name: 'HC-SR04 ultrasonic', partNumber: 'HC-SR04', type: 'sensor', aliases: ['hc-sr04', 'hcsr04', 'ultrasonic', 'distance sensor'], supply: '5 V', dimKey: 'hc-sr04' },
  { id: 'pir', name: 'PIR motion sensor', partNumber: 'HC-SR501', type: 'sensor', aliases: ['pir', 'hc-sr501', 'motion sensor'], supply: '5 V', dimKey: 'pir-motion-sensor' },
  { id: 'relay', name: 'Relay module', partNumber: 'SRD-05VDC-SL-C', type: 'actuator', aliases: ['relay'], supply: '5 V', dimKey: 'relay' },
  { id: 'servo', name: 'SG90 servo', partNumber: 'SG90', type: 'actuator', aliases: ['servo', 'sg90'], supply: '5 V', dimKey: 'servo' },
  { id: 'led', name: 'Indicator LED', partNumber: 'LED-5MM', type: 'actuator', aliases: ['led', 'indicator light'], supply: '3.3 V', dimKey: 'led' },
  { id: 'buzzer', name: 'Buzzer', partNumber: 'BUZZER-5V', type: 'actuator', aliases: ['buzzer', 'piezo'], supply: '5 V', dimKey: 'buzzer' },
  { id: 'ssd1306', name: 'SSD1306 OLED', partNumber: 'SSD1306', type: 'interface', aliases: ['oled', 'ssd1306', 'display'], supply: '3.3 V', dimKey: 'ssd1306' },
  { id: 'ne555', name: 'NE555 timer', partNumber: 'NE555', type: 'passive', aliases: ['ne555', 'lm555', 'tlc555', ' 555', '555 timer'], supply: '5 V', dimKey: 'ne555' },
  { id: 'cd4017', name: 'CD4017 counter', partNumber: 'CD4017', type: 'passive', aliases: ['cd4017', ' 4017', 'decade counter'], supply: '5 V', dimKey: 'cd4017' },
  { id: 'hc595', name: '74HC595 shift register', partNumber: '74HC595', type: 'passive', aliases: ['74hc595', '74ls595', ' 595', 'serial to parallel'], supply: '5 V', dimKey: 'hc595' },
  { id: 'hc165', name: '74HC165 shift register', partNumber: '74HC165', type: 'passive', aliases: ['74hc165', '74ls165', ' 165', 'parallel to serial'], supply: '5 V', dimKey: 'hc165' },
  { id: 'hcgates', name: '74HC logic gates', partNumber: '74HC00', type: 'passive', aliases: ['74hc00', '74hc04', '74hc08', '74hc32', '74hc86', 'quad nand', 'hex inverter'], supply: '5 V', dimKey: 'hc00' },
  { id: 'wemos-mini', name: 'Wemos D1 mini', partNumber: 'D1-MINI', type: 'controller', aliases: ['wemos', 'd1 mini', 'd1-mini'], supply: '5 V USB', dimKey: 'wemos-d1-mini' },
  { id: 'wemos-r32', name: 'Wemos D1 R32', partNumber: 'D1-R32', type: 'controller', aliases: ['d1 r32', 'd1-r32'], supply: '5 V USB', dimKey: 'wemos-d1-r32' },
  { id: 'leonardo', name: 'Arduino Leonardo', partNumber: 'A000057', type: 'controller', aliases: ['leonardo'], supply: '5 V USB', dimKey: 'arduino-leonardo' },
  { id: 'promicro', name: 'Pro Micro', partNumber: 'PRO-MICRO-5V', type: 'controller', aliases: ['pro micro', 'pro-micro', 'promicro', '32u4'], supply: '5 V USB', dimKey: 'pro-micro' },
  { id: 'rpi4b', name: 'Raspberry Pi 4B', partNumber: 'RPI4-MODBP', type: 'controller', aliases: ['raspberry pi 4', 'rpi 4', 'pi 4b'], supply: '5 V 3 A USB-C', dimKey: 'rpi-4b' },
  { id: 'pizero', name: 'Pi Zero / 2W', partNumber: 'RPI-ZERO2W', type: 'controller', aliases: ['pi zero', 'raspberry pi zero'], supply: '5 V USB', dimKey: 'pi-zero' },
  { id: 'microbit', name: 'micro:bit', partNumber: 'MICROBIT-V2', type: 'controller', aliases: ['micro:bit', 'microbit', 'micro bit', 'bbc micro'], supply: '3.3 V / USB', dimKey: 'microbit' },
  { id: 'rc522', name: 'RC522 RFID reader', partNumber: 'RC522', type: 'sensor', aliases: ['rc522', 'mfrc522', 'rfid'], supply: '3.3 V', dimKey: 'rc522' },
  { id: 'nrf24', name: 'nRF24L01+ radio', partNumber: 'NRF24L01P', type: 'sensor', aliases: ['nrf24l01', 'nrf24'], supply: '3.3 V', dimKey: 'nrf24l01' },
  { id: 'hc05', name: 'HC-05 Bluetooth', partNumber: 'HC-05', type: 'sensor', aliases: ['hc-05', 'hc-06', 'hc05', 'bluetooth module'], supply: '5 V in / 3.3 V logic', dimKey: 'hc-05' },
  { id: 'ttp223', name: 'TTP223 touch key', partNumber: 'TTP223', type: 'sensor', aliases: ['ttp223', 'touch sensor'], supply: '3.3–5 V', dimKey: 'ttp223' },
  { id: 'sw420', name: 'SW-420 vibration', partNumber: 'SW-420', type: 'sensor', aliases: ['sw-420', 'sw420'], supply: '5 V', dimKey: 'sw420' },
  { id: 'rain', name: 'Rain sensor plate', partNumber: 'YL-83', type: 'sensor', aliases: ['rain sensor', 'yl-83'], supply: '5 V', dimKey: 'rain-plate' },
  { id: 'waterlevel', name: 'Water level strip', partNumber: 'WATER-LVL', type: 'sensor', aliases: ['water level'], supply: '5 V', dimKey: 'water-level' },
  { id: 'pca9685', name: 'PCA9685 16-ch PWM', partNumber: 'PCA9685', type: 'sensor', aliases: ['pca9685'], supply: '3.3–5 V', dimKey: 'pca9685' },
  { id: 'ads1115', name: 'ADS1115 16-bit ADC', partNumber: 'ADS1115', type: 'sensor', aliases: ['ads1115'], supply: '3.3–5 V', dimKey: 'ads1115' },
  { id: 'tm1637', name: 'TM1637 4-digit display', partNumber: 'TM1637', type: 'interface', aliases: ['tm1637'], supply: '5 V', dimKey: 'tm1637' },
  { id: 'max7219', name: 'MAX7219 8×8 matrix', partNumber: 'MAX7219', type: 'interface', aliases: ['max7219'], supply: '5 V', dimKey: 'max7219-matrix' },
  { id: 'nokia5110', name: 'Nokia 5110 LCD', partNumber: 'PCD8544', type: 'interface', aliases: ['nokia 5110', ' 5110', 'pcd8544'], supply: '3.3 V', dimKey: 'nokia-5110' },
  { id: 'tp4056', name: 'TP4056 charger', partNumber: 'TP4056', type: 'interface', aliases: ['tp4056'], supply: '5 V USB', dimKey: 'tp4056' },
  { id: 'buck', name: 'LM2596 buck module', partNumber: 'LM2596', type: 'interface', aliases: ['lm2596', 'buck converter'], supply: '4–40 V in', dimKey: 'buck-module' },
  { id: 'hlkpm01', name: 'HLK-PM01 mains module', partNumber: 'HLK-PM01', type: 'interface', aliases: ['hlk-pm01', 'hlk'], supply: '230 VAC in', dimKey: 'hlk-pm01' },
  { id: 'mg996r', name: 'MG996R servo', partNumber: 'MG996R', type: 'actuator', aliases: ['mg996r', 'mg996'], supply: '5–6 V 2.5 A', dimKey: 'mg996r' },
  { id: 'byj28', name: '28BYJ-48 stepper', partNumber: '28BYJ-48-5V', type: 'actuator', aliases: ['28byj-48', '28byj'], supply: '5 V + ULN2003', dimKey: 'stepper-28byj' },
  { id: 'nema17', name: 'NEMA 17 stepper', partNumber: 'NEMA17-42', type: 'actuator', aliases: ['nema 17', 'nema17'], supply: '12 V + driver', dimKey: 'stepper-nema17' },
  { id: 'l298n', name: 'L298N driver', partNumber: 'L298N', type: 'actuator', aliases: ['l298n', 'l298'], supply: '5–35 V motor', dimKey: 'l298n' },
  { id: 'ttmotor', name: 'TT gear motor', partNumber: 'TT-130', type: 'actuator', aliases: ['tt motor', 'bo motor'], supply: '3–6 V', dimKey: 'tt-motor' },
  { id: 'fan30', name: '3010 cooling fan', partNumber: 'FAN-3010-5V', type: 'actuator', aliases: ['3010', 'cooling fan'], supply: '5 V', dimKey: 'fan-30mm' },
  { id: 'speaker40', name: '40 mm speaker', partNumber: 'SPK-40-8R', type: 'actuator', aliases: ['8 ohm', 'speaker'], supply: '—', dimKey: 'speaker-40mm' },
  { id: 'peltier', name: 'Peltier TEC1-12706', partNumber: 'TEC1-12706', type: 'actuator', aliases: ['peltier', 'tec1-12706', 'tec1'], supply: '12 V 6 A', dimKey: 'peltier' },
  { id: 'vibro', name: 'Coin vibration motor', partNumber: 'VIB-1027', type: 'actuator', aliases: ['1027', 'vibration motor'], supply: '3 V', dimKey: 'vibration-motor' },
];

/** Detected parts, in catalog order (controller first). */
export function detectComponents(text: string): DetectableComponent[] {
  const haystack = ` ${text.toLowerCase()} `;
  return CATALOG.filter((component) =>
    component.aliases.some((alias) => haystack.includes(alias.toLowerCase())),
  );
}

/**
 * Turn detected parts into graph-shaped nodes so the SAME 3D scene component
 * page 02 uses can render them — no second renderer, no drift.
 */
export function previewNodes(text: string): ArchitectureNode[] {
  const detected = detectComponents(text);
  const columns = Math.max(1, Math.ceil(Math.sqrt(detected.length)));
  return detected.map((component, index) => {
    const dims = dimForKey(component.dimKey);
    return {
      id: `preview-${component.id}`,
      type: component.type,
      name: component.name,
      partNumber: component.partNumber,
      x: 220 + (index % columns) * 220,
      y: 180 + Math.floor(index / columns) * 200,
      description: `Detected in your brief — ${component.partNumber}`,
      properties: [{ label: 'Supply', value: component.supply }],
      ports: [],
      details: [],
      // True-scale from the first keystroke: the preview bench already
      // shows an Uno 2.5× wider than an OLED, not same-size boxes.
      spatial: {
        dimensions: { w: dims.w, h: dims.h, d: dims.d },
        massGrams: dims.mass,
        modelRef: component.dimKey,
      },
    };
  });
}
