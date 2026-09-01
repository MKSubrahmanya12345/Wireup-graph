import type { ArchitectureNode, NodeType } from '../types/architecture';

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
}

const CATALOG: DetectableComponent[] = [
  {
    id: 'esp32',
    name: 'ESP32 DevKit',
    partNumber: 'ESP32-WROOM-32',
    type: 'controller',
    aliases: ['esp32', 'esp-32', 'esp 32', 'wroom', 'devkit'],
    supply: '3.3 V',
  },
  {
    id: 'esp8266',
    name: 'ESP8266 NodeMCU',
    partNumber: 'ESP8266',
    type: 'controller',
    aliases: ['esp8266', 'nodemcu'],
    supply: '3.3 V',
  },
  { id: 'dht22', name: 'DHT22 temp/humidity', partNumber: 'AM2302', type: 'sensor', aliases: ['dht22', 'am2302', 'dht-22'], supply: '3.3–6 V' },
  { id: 'dht11', name: 'DHT11 temp/humidity', partNumber: 'DHT11', type: 'sensor', aliases: ['dht11', 'dht-11'], supply: '3.3–5 V' },
  { id: 'bme280', name: 'BME280 environment', partNumber: 'BME280', type: 'sensor', aliases: ['bme280', 'bmp280', 'pressure sensor'], supply: '3.3 V' },
  { id: 'ds18b20', name: 'DS18B20 probe', partNumber: 'DS18B20', type: 'sensor', aliases: ['ds18b20', 'dallas', 'waterproof temperature'], supply: '3.3–5 V' },
  { id: 'soil', name: 'Soil moisture sensor', partNumber: 'SOIL-CAP-1.2', type: 'sensor', aliases: ['soil', 'moisture'], supply: '3.3 V' },
  { id: 'mq2', name: 'MQ-2 gas sensor', partNumber: 'MQ-2', type: 'sensor', aliases: ['mq2', 'mq-2', 'gas sensor', 'smoke'], supply: '5 V' },
  { id: 'hcsr04', name: 'HC-SR04 ultrasonic', partNumber: 'HC-SR04', type: 'sensor', aliases: ['hc-sr04', 'hcsr04', 'ultrasonic', 'distance sensor'], supply: '5 V' },
  { id: 'pir', name: 'PIR motion sensor', partNumber: 'HC-SR501', type: 'sensor', aliases: ['pir', 'hc-sr501', 'motion sensor'], supply: '5 V' },
  { id: 'relay', name: 'Relay module', partNumber: 'SRD-05VDC-SL-C', type: 'actuator', aliases: ['relay'], supply: '5 V' },
  { id: 'servo', name: 'SG90 servo', partNumber: 'SG90', type: 'actuator', aliases: ['servo', 'sg90'], supply: '5 V' },
  { id: 'led', name: 'Indicator LED', partNumber: 'LED-5MM', type: 'actuator', aliases: ['led', 'indicator light'], supply: '3.3 V' },
  { id: 'buzzer', name: 'Buzzer', partNumber: 'BUZZER-5V', type: 'actuator', aliases: ['buzzer', 'piezo'], supply: '5 V' },
  { id: 'ssd1306', name: 'SSD1306 OLED', partNumber: 'SSD1306', type: 'interface', aliases: ['oled', 'ssd1306', 'display'], supply: '3.3 V' },
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
  return detected.map((component, index) => ({
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
  }));
}
