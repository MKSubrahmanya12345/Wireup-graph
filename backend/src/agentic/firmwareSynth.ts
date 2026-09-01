/**
 * Deterministic firmware synthesiser — the agentic engine's code generator.
 *
 * Consumes the validated DeviceBuildPlan (RAG-resolved modules bound to real
 * pins) and emits a complete, compilable PlatformIO/Arduino sketch for the
 * target board. Every line comes from curated templates keyed off the device
 * knowledge base — there is no hallucination surface — and the result is
 * compiled by the terminal validator before it is ever offered for download.
 */

import type { BuildFile, FirmwareResult } from '../schemas/build.js';
import type { DeviceBuildPlan, ResolvedModule } from './types.js';
import { generateWokwiConfig } from './wokwiConfig.js';
import { generateUniversalDiagram } from './universalDiagram.js';
import { generateVelxioProject } from './velxioProject.js';

// ── Per-module code generation ──────────────────────────────────────────────

interface ModuleCode {
  includes: string[];
  configDefines: string[];
  globals: string[];
  setup: string[];
  /** Statements run on every sampling pass. */
  sample: string[];
  /** Statements appending this module's fields to the JSON payload. */
  json: string[];
  /** server.on(...) registrations for actuator control. */
  routes: string[];
  needsWire: boolean;
  notes: string[];
}

function emptyCode(): ModuleCode {
  return {
    includes: [], configDefines: [], globals: [], setup: [], sample: [],
    json: [], routes: [], needsWire: false, notes: [],
  };
}

function gpioNumber(pin: string): string {
  return pin.replace(/[^0-9]/g, '') || '4';
}

function pinMacro(module: ResolvedModule): string {
  return `${module.deviceId.replace(/-/g, '_').toUpperCase()}_PIN`;
}

function codeFor(module: ResolvedModule): ModuleCode {
  switch (module.deviceId) {
    case 'dht22':
    case 'dht11': {
      const code = emptyCode();
      const pin = gpioNumber(module.pins.data ?? 'GPIO4');
      const type = module.deviceId === 'dht22' ? 'DHT22' : 'DHT11';
      code.includes.push('#include <DHT.h>');
      code.configDefines.push(`#define ${pinMacro(module)} ${pin}`, `#define ${pinMacro(module)}_TYPE ${type}`);
      code.globals.push(`DHT wireupDht(${pinMacro(module)}, ${pinMacro(module)}_TYPE);`);
      code.setup.push(
        'wireupDht.begin();',
        `Serial.println(F("[wireup] ${module.name} initialised on GPIO${pin}"));`,
      );
      code.sample.push(
        '  const float temperatureC = wireupDht.readTemperature();',
        '  const float humidityPct = wireupDht.readHumidity();',
        '  if (!isnan(temperatureC) && !isnan(humidityPct)) {',
        '    lastTemperatureC = temperatureC;',
        '    lastHumidityPct = humidityPct;',
        '    sensorOk = true;',
        '    lastSampleMs = millis();',
        '  } else {',
        '      sensorOk = false;',
        '    Serial.println(F("[wireup] DHT read failed (checksum/timeout) — reporting null"));',
        '  }',
      );
      code.json.push(
        '  json += "\\"temperature_c\\":" + (sensorOk ? String(lastTemperatureC, 1) : String(F("null")));',
        '  json += ",\\"humidity_pct\\":" + (sensorOk ? String(lastHumidityPct, 1) : String(F("null")));',
      );
      code.notes.push(...module.firmwareNotes);
      return code;
    }

    case 'bme280': {
      const code = emptyCode();
      code.includes.push('#include <Wire.h>', '#include <Adafruit_BME280.h>');
      code.globals.push('Adafruit_BME280 wireupBme;', 'bool bmePresent = false;');
      code.setup.push(
        'bmePresent = wireupBme.begin(0x76);',
        'if (!bmePresent) Serial.println(F("[wireup] BME280 not found at 0x76 — check SDA/SCL wiring"));',
      );
      code.sample.push(
        '  if (bmePresent) {',
        '    lastTemperatureC = wireupBme.readTemperature();',
        '    lastHumidityPct = wireupBme.readHumidity();',
        '    lastPressureHpa = wireupBme.readPressure() / 100.0f;',
        '    sensorOk = true;',
        '    lastSampleMs = millis();',
        '  } else { sensorOk = false; }',
      );
      code.json.push(
        '  json += "\\"temperature_c\\":" + (bmePresent ? String(lastTemperatureC, 1) : String(F("null")));',
        '  json += ",\\"humidity_pct\\":" + (bmePresent ? String(lastHumidityPct, 1) : String(F("null")));',
        '  json += ",\\"pressure_hpa\\":" + (bmePresent ? String(lastPressureHpa, 1) : String(F("null")));',
      );
      code.needsWire = true;
      code.notes.push(...module.firmwareNotes);
      return code;
    }

    case 'ds18b20': {
      const code = emptyCode();
      const macro = pinMacro(module);
      code.includes.push('#include <OneWire.h>', '#include <DallasTemperature.h>');
      code.configDefines.push(`#define ${macro} ${gpioNumber(module.pins.data ?? 'GPIO4')}`);
      code.globals.push(`OneWire wireupOneWire(${macro});`, 'DallasTemperature wireupProbes(&wireupOneWire);');
      code.setup.push('wireupProbes.begin();', 'wireupProbes.setResolution(12);');
      code.sample.push(
        '  wireupProbes.requestTemperatures();',
        '  const float probeC = wireupProbes.getTempCByIndex(0);',
        '  if (probeC > DEVICE_DISCONNECTED_C) {',
        '    lastTemperatureC = probeC;',
        '    sensorOk = true;',
        '    lastSampleMs = millis();',
        '  } else { sensorOk = false; }',
      );
      code.json.push(
        '  json += "\\"temperature_c\\":" + (sensorOk ? String(lastTemperatureC, 1) : String(F("null")));',
      );
      code.notes.push(...module.firmwareNotes);
      return code;
    }

    case 'soil-moisture':
    case 'mq2-gas': {
      const code = emptyCode();
      const macro = pinMacro(module);
      const pin = gpioNumber(module.pins.sig ?? 'GPIO34');
      const field = module.metrics[0]?.jsonField ?? 'level_pct';
      const state = module.deviceId === 'mq2-gas' ? 'lastGasPpm' : 'lastMoisturePct';
      const factor = module.deviceId === 'mq2-gas' ? '(rawMv / 3300.0f) * 10000.0f' : '100.0f * (1.0f - (rawMv / 3300.0f))';
      code.configDefines.push(`#define ${macro} ${pin}`);
      code.sample.push(
        `  const uint32_t rawMv = analogReadMilliVolts(${macro});`,
        `  ${state} = ${factor};`,
        `  ${module.deviceId === 'mq2-gas' ? 'sensorOk = true;' : 'if (rawMv > 0) sensorOk = true;'}`,
        '  lastSampleMs = millis();',
      );
      code.json.push(
        `  json += "\\"${field}\\":" + String(${state}, ${module.deviceId === 'mq2-gas' ? '0' : '1'});`,
      );
      code.notes.push(...module.firmwareNotes);
      return code;
    }

    case 'hcsr04': {
      const code = emptyCode();
      const trig = gpioNumber(module.pins.trig ?? 'GPIO5');
      const echo = gpioNumber(module.pins.echo ?? 'GPIO18');
      code.configDefines.push(`#define HCSR04_TRIG_PIN ${trig}`, `#define HCSR04_ECHO_PIN ${echo}`);
      code.setup.push(
        'pinMode(HCSR04_TRIG_PIN, OUTPUT);',
        'pinMode(HCSR04_ECHO_PIN, INPUT);',
        'digitalWrite(HCSR04_TRIG_PIN, LOW);',
      );
      code.sample.push(
        '  digitalWrite(HCSR04_TRIG_PIN, HIGH);',
        '  delayMicroseconds(10);',
        '  digitalWrite(HCSR04_TRIG_PIN, LOW);',
        '  const unsigned long echoUs = pulseIn(HCSR04_ECHO_PIN, HIGH, 30000UL);',
        '  if (echoUs > 0) {',
        '    lastDistanceCm = echoUs / 58.0f;',
        '    sensorOk = true;',
        '    lastSampleMs = millis();',
        '  } else { sensorOk = false; }',
      );
      code.json.push(
        '  json += "\\"distance_cm\\":" + (sensorOk ? String(lastDistanceCm, 1) : String(F("null")));',
      );
      code.notes.push(...module.firmwareNotes);
      return code;
    }

    case 'pir-hcsr501': {
      const code = emptyCode();
      const macro = pinMacro(module);
      code.configDefines.push(`#define ${macro} ${gpioNumber(module.pins.sig ?? 'GPIO27')}`);
      code.setup.push(`pinMode(${macro}, INPUT);`);
      code.sample.push(
        `  motionNow = digitalRead(${macro}) == HIGH;`,
        '  sensorOk = true;',
        '  lastSampleMs = millis();',
      );
      code.json.push('  json += "\\"motion\\":" + String(motionNow ? 1 : 0);');
      code.notes.push(...module.firmwareNotes);
      return code;
    }

    case 'relay-1ch': {
      const code = emptyCode();
      const macro = pinMacro(module);
      code.configDefines.push(`#define ${macro} ${gpioNumber(module.pins.in ?? module.pins.sig ?? 'GPIO26')}`);
      code.globals.push('bool relayOn = false;');
      code.setup.push(
        `pinMode(${macro}, OUTPUT);`,
        `digitalWrite(${macro}, HIGH); // active-LOW driver: HIGH = released at boot`,
      );
      code.routes.push(...toggleRoute('relay', macro, 'relayOn'));
      code.json.push('  json += ",\\"relay_state\\":\\"" + String(relayOn ? F("on") : F("off")) + "\\"";');
      code.notes.push(...module.firmwareNotes);
      return code;
    }

    case 'led-indicator': {
      const code = emptyCode();
      const macro = pinMacro(module);
      code.configDefines.push(`#define ${macro} ${gpioNumber(module.pins.sig ?? 'GPIO2')}`);
      code.globals.push('bool ledOn = false;');
      code.setup.push(`pinMode(${macro}, OUTPUT);`, `digitalWrite(${macro}, LOW);`);
      code.routes.push(...toggleRoute('led', macro, 'ledOn', false));
      code.json.push('  json += ",\\"led_state\\":\\"" + String(ledOn ? F("on") : F("off")) + "\\"";');
      code.notes.push(...module.firmwareNotes);
      return code;
    }

    case 'ssd1306': {
      // I2C OLED — displays the first two sensor metrics. The refresh lines
      // are rendered in sketchSource (they read the sensor-state globals).
      const code = emptyCode();
      code.includes.push('#include <Wire.h>', '#include <Adafruit_GFX.h>', '#include <Adafruit_SSD1306.h>');
      code.globals.push(
        'Adafruit_SSD1306 wireupDisplay(128, 64, &Wire, -1);',
        'bool displayOk = false;',
        'unsigned long lastDisplayMs = 0;',
      );
      code.setup.push(
        'displayOk = wireupDisplay.begin(SSD1306_SWITCHCAPVCC, 0x3C);',
        'if (displayOk) {',
        '  wireupDisplay.clearDisplay();',
        '  wireupDisplay.setTextSize(1);',
        '  wireupDisplay.setTextColor(SSD1306_WHITE);',
        '  wireupDisplay.setCursor(0, 0);',
        '  wireupDisplay.println(F("Wireup"));',
        '  wireupDisplay.display();',
        '}',
        'if (!displayOk) Serial.println(F("[wireup] OLED not found at 0x3C — check SDA/SCL wiring"));',
      );
      code.needsWire = true;
      code.notes.push(...module.firmwareNotes);
      return code;
    }

    case 'servo-sg90': {
      const code = emptyCode();
      const macro = pinMacro(module);
      code.includes.push('#include <ESP32Servo.h>');
      code.configDefines.push(`#define ${macro} ${gpioNumber(module.pins.sig ?? 'GPIO18')}`);
      code.globals.push('Servo wireupServo;', 'int servoDeg = 90;');
      code.setup.push(
        'wireupServo.setPeriodHertz(50);',
        `wireupServo.attach(${macro}, 500, 2400);`,
        'wireupServo.write(servoDeg);',
      );
      code.routes.push(
        '  server.on("/api/control/servo_angle", HTTP_POST, [] {',
        '    sendCorsHeaders();',
        '    const String angleStr = bodyOrArg("angle");',
        '    if (angleStr.length() == 0) { server.send(400, "application/json", F("{\\"error\\":\\"missing angle\\"}")); return; }',
        '    servoDeg = constrain(angleStr.toInt(), 0, 180);',
        '    wireupServo.write(servoDeg);',
        '    server.send(200, "application/json", String(F("{\\"servo_deg\\":")) + String(servoDeg) + F("}"));',
        '  });',
      );
      code.json.push('  json += ",\\"servo_deg\\":" + String(servoDeg);');
      code.notes.push(...module.firmwareNotes);
      return code;
    }

    default:
      return emptyCode();
  }
}

/** POST /api/control/<id>?state=on|off driving an output pin. */
function toggleRoute(id: string, pinMacroName: string, stateVar: string, activeLow = true): string[] {
  const onWrite = activeLow ? 'LOW' : 'HIGH';
  const offWrite = activeLow ? 'HIGH' : 'LOW';
  return [
    `  server.on("/api/control/${id}", HTTP_POST, [] {`,
    '    sendCorsHeaders();',
    // bodyOrArg reads query/form args first, then a JSON body — so both
    // the dashboard (form-encoded) and curl users (either) work.
    '    const String requested = bodyOrArg("state");',
    '    if (requested.length() == 0) { server.send(400, "application/json", F("{\\"error\\":\\"missing state\\"}")); return; }',
    `    ${stateVar} = requested == "on" || requested == "1" || requested == "true";`,
    `    digitalWrite(${pinMacroName}, ${stateVar} ? ${onWrite} : ${offWrite});`,
    `    server.send(200, "application/json", String(F("{\\"${id}\\":\\"")) + (${stateVar} ? "on" : "off") + "\\"}");`,
    '  });',
  ];
}

// ── Project assembly ────────────────────────────────────────────────────────

function hasJsonField(plan: DeviceBuildPlan, jsonField: string): boolean {
  return plan.modules.some((module) => module.metrics.some((metric) => metric.jsonField === jsonField));
}

/** Global sensor-state variables the sampler needs, based on used fields. */
function stateDeclarations(plan: DeviceBuildPlan): string[] {
  const decls: string[] = [];
  if (hasJsonField(plan, 'temperature_c')) decls.push('float lastTemperatureC = 0.0f;');
  if (hasJsonField(plan, 'humidity_pct')) decls.push('float lastHumidityPct = 0.0f;');
  if (hasJsonField(plan, 'pressure_hpa')) decls.push('float lastPressureHpa = 0.0f;');
  if (hasJsonField(plan, 'distance_cm')) decls.push('float lastDistanceCm = 0.0f;');
  if (hasJsonField(plan, 'moisture_pct')) decls.push('float lastMoisturePct = 0.0f;');
  if (hasJsonField(plan, 'gas_ppm')) decls.push('float lastGasPpm = 0.0f;');
  if (hasJsonField(plan, 'motion')) decls.push('bool motionNow = false;');
  return decls;
}

/** Periodic OLED refresh lines — the first two metrics of the build. */
function displayUpdateLines(plan: DeviceBuildPlan): string[] {
  const metrics = plan.modules.flatMap((m) => m.metrics).slice(0, 2);
  const VAR: Record<string, string> = {
    temperature_c: 'lastTemperatureC',
    humidity_pct: 'lastHumidityPct',
    pressure_hpa: 'lastPressureHpa',
    distance_cm: 'lastDistanceCm',
    moisture_pct: 'lastMoisturePct',
    gas_ppm: 'lastGasPpm',
    motion: 'motionNow',
  };
  const UNIT: Record<string, string> = {
    temperature_c: ' C',
    humidity_pct: ' %',
    pressure_hpa: ' hPa',
    distance_cm: ' cm',
    moisture_pct: ' %',
    gas_ppm: ' ppm',
    motion: '',
  };

  const lines = [
    'if (displayOk && millis() - lastDisplayMs >= 1000) {',
    '  lastDisplayMs = millis();',
    '  wireupDisplay.clearDisplay();',
    '  wireupDisplay.setCursor(0, 0);',
  ];
  if (metrics.length === 0) {
    lines.push(
      '  wireupDisplay.println(String(F("up ")) + String((millis() - bootMs) / 1000UL) + F(" s"));',
    );
  } else {
    for (const metric of metrics) {
      const label = metric.label.slice(0, 5);
      if (metric.jsonField === 'motion') {
        lines.push(`  wireupDisplay.println(String(F("${label} ")) + (motionNow ? F("on") : F("off")));`);
      } else {
        const stateVar = VAR[metric.jsonField] ?? 'lastTemperatureC';
        const unit = UNIT[metric.jsonField] ?? '';
        lines.push(
          `  wireupDisplay.println(String(F("${label} ")) + (sensorOk ? String(${stateVar}, 1) : F("--")) + F("${unit}"));`,
        );
      }
    }
  }
  lines.push('  wireupDisplay.display();', '}');
  return lines;
}

function sketchSource(plan: DeviceBuildPlan, codes: ModuleCode[]): string {
  const sensorModules = plan.modules.filter((m) => m.kind === 'sensor');
  const includes = new Set<string>();
  for (const code of codes) code.includes.forEach((line) => includes.add(line));

  const configDefines = codes.flatMap((code) => code.configDefines);
  const globals = codes.flatMap((code) => code.globals);
  const setupLines = codes.flatMap((code) => code.setup);
  const sampleLines = codes.flatMap((code) => code.sample);
  const jsonLines = codes.flatMap((code) => code.json);
  const routeLines = codes.flatMap((code) => code.routes);
  const needsWire = codes.some((code) => code.needsWire);
  const hasDisplay = plan.modules.some((m) => m.deviceId === 'ssd1306');
  const displayLines = hasDisplay ? displayUpdateLines(plan) : [];

  const pinsBlock = plan.modules
    .flatMap((module) =>
      Object.entries(module.pins).map(
        ([role, pin]) => `//   ${module.name} · ${role.toUpperCase()} → ${pin}`,
      ),
    )
    .join('\n');

  const sampleBody = sensorModules.length
    ? [
        '  // never attempt reads more often than the slowest sensor supports',
        '  if (millis() - lastAttemptMs < SAMPLE_INTERVAL_MS) return;',
        '  lastAttemptMs = millis();',
        ...sampleLines.filter((line) => !line.startsWith('  if (millis')),
        '',
      ]
    : ['  // no sensors configured'];

  // History ring buffer: copy each metric the plan declares into the sample
  // struct, with a validity bit so the JSON only emits real values.
  const HISTORY_FIELD_BITS = [
    { field: 'temperature_c', structField: 'temperatureC', stateVar: 'lastTemperatureC', mask: '0x01' },
    { field: 'humidity_pct', structField: 'humidityPct', stateVar: 'lastHumidityPct', mask: '0x02' },
    { field: 'pressure_hpa', structField: 'pressureHpa', stateVar: 'lastPressureHpa', mask: '0x04' },
    { field: 'distance_cm', structField: 'distanceCm', stateVar: 'lastDistanceCm', mask: '0x08' },
    { field: 'moisture_pct', structField: 'moisturePct', stateVar: 'lastMoisturePct', mask: '0x10' },
    { field: 'gas_ppm', structField: 'gasPpm', stateVar: 'lastGasPpm', mask: '0x20' },
    { field: 'motion', structField: 'motion', stateVar: 'motionNow', mask: '0x40' },
  ] as const;
  const historySampleLines = HISTORY_FIELD_BITS.filter((entry) =>
    hasJsonField(plan, entry.field),
  ).map((entry) => `    sample.${entry.structField} = ${entry.stateVar}; mask |= ${entry.mask};`);

  const jsonBody = jsonLines.length
    ? jsonLines.map((line, index) => (index === 0 ? line : `${line}`))
    : ['  json += "\\"status\\":\\"ok\\"";'];

  return `// ── ${plan.projectName} — generated by Wireup ─────────────────────────────
// Board: ${plan.board.name} (${plan.board.mcu}) · Logic ${plan.board.voltage} V
// Modules:${plan.modules.map((m) => `\n//   • ${m.name} — ${m.partNumber}`).join('')}
//
// Pin map (see firmware/config.h):
${pinsBlock || '//   (none)'}

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <ArduinoOTA.h>
${[...includes].join('\n')}

#include "config.h"

// ── Network ─────────────────────────────────────────────────────────────────
WebServer server(WEB_SERVER_PORT);

// ── Sensor state (filled by the guarded sampler) ────────────────────────────
${stateDeclarations(plan).join('\n')}
bool sensorOk = false;
unsigned long lastSampleMs = 0;
unsigned long lastAttemptMs = 0;
unsigned long bootMs = 0;

${globals.join('\n')}

// ── Wi-Fi credentials at runtime ────────────────────────────────────────────
// Defaults come from config.h; the dashboard's Wi-Fi settings can overwrite
// them at runtime (stored in NVS, surviving re-flash — no USB needed to move
// the device to a new network).
String wifiSsid = WIFI_SSID;
String wifiPassword = WIFI_PASSWORD;
Preferences wireupPrefs;

// ── On-device history ring buffer (served at /api/history) ─────────────────
struct HistorySample {
  unsigned long ts;
  float temperatureC, humidityPct, pressureHpa, distanceCm, moisturePct, gasPpm;
  bool motion;
  uint8_t validMask;
};
HistorySample history[HISTORY_DEPTH];
int historyCount = 0;
int historyHead = 0;
unsigned long lastHistoryMs = 0;

void sendCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

/** Reads a command argument: query/form first, then a JSON body key. */
String bodyOrArg(const char* key) {
  if (server.hasArg(key)) return server.arg(key);
  const String body = server.arg("plain");
  if (body.length() == 0) return String();
  const String needle = String("\\\"") + key + "\\\":";
  int start = body.indexOf(needle.c_str());
  if (start < 0) return String();
  start += needle.length();
  while (start < (int)body.length() && body[start] == ' ') start++;
  String value;
  if (start < (int)body.length() && body[start] == '"') {
    start++;
    while (start < (int)body.length() && body[start] != '"') value += body[start++];
  } else {
    while (start < (int)body.length() &&
           ((body[start] >= '0' && body[start] <= '9') || body[start] == '.' ||
            body[start] == '-' || body[start] == '+' || body[start] == 'e' ||
            body[start] == 'E')) {
      value += body[start++];
    }
  }
  return value;
}

/** NVS-stored Wi-Fi overrides config.h — written by POST /api/wifi. */
void loadWifiConfig() {
  wireupPrefs.begin("wireup", false);
  const String savedSsid = wireupPrefs.getString("ssid", "");
  if (savedSsid.length() > 0) {
    wifiSsid = savedSsid;
    wifiPassword = wireupPrefs.getString("pass", "");
    Serial.println(F("[wireup] Using Wi-Fi credentials saved on the device (NVS)."));
  }
  wireupPrefs.end();
}

/** One history entry per HISTORY_INTERVAL_MS, ring-buffered in RAM. */
void recordHistory() {
  if (millis() - lastHistoryMs < HISTORY_INTERVAL_MS) return;
  lastHistoryMs = millis();
  HistorySample sample;
  memset(&sample, 0, sizeof(sample));
  sample.ts = millis();
  uint8_t mask = 0;
  if (sensorOk) {
${historySampleLines.join('\n')}
  }
  sample.validMask = mask;
  history[historyHead] = sample;
  historyHead = (historyHead + 1) % HISTORY_DEPTH;
  if (historyCount < HISTORY_DEPTH) historyCount++;
}

String historyJson() {
  String json = "[";
  for (int i = 0; i < historyCount; i++) {
    const HistorySample& s = history[(historyHead - historyCount + i + HISTORY_DEPTH) % HISTORY_DEPTH];
    if (i > 0) json += ",";
    json += "{\\"ts\\":" + String(s.ts);
    if (s.validMask & 0x01) json += ",\\"temperature_c\\":" + String(s.temperatureC, 1);
    if (s.validMask & 0x02) json += ",\\"humidity_pct\\":" + String(s.humidityPct, 1);
    if (s.validMask & 0x04) json += ",\\"pressure_hpa\\":" + String(s.pressureHpa, 1);
    if (s.validMask & 0x08) json += ",\\"distance_cm\\":" + String(s.distanceCm, 1);
    if (s.validMask & 0x10) json += ",\\"moisture_pct\\":" + String(s.moisturePct, 1);
    if (s.validMask & 0x20) json += ",\\"gas_ppm\\":" + String(s.gasPpm, 1);
    if (s.validMask & 0x40) json += ",\\"motion\\":" + String(s.motion ? 1 : 0);
    json += "}";
  }
  json += "]";
  return json;
}

void handleHistory() {
  sendCorsHeaders();
  server.send(200, "application/json", historyJson());
}

/** GET: current SSID/IP. POST ssid+password: save to NVS and reconnect. */
void handleWifi() {
  sendCorsHeaders();
  if (server.method() == HTTP_GET) {
    String json = "{\\"ssid\\":\\"" + wifiSsid + "\\"";
    json += ",\\"ip\\":\\"" + WiFi.localIP().toString() + "\\"";
    json += "}";
    server.send(200, "application/json", json);
    return;
  }
  const String ssid = bodyOrArg("ssid");
  const String pass = bodyOrArg("password");
  if (ssid.length() == 0) {
    server.send(400, "application/json", F("{\\"error\\":\\"missing ssid\\"}"));
    return;
  }
  wireupPrefs.begin("wireup", false);
  wireupPrefs.putString("ssid", ssid);
  wireupPrefs.putString("pass", pass);
  wireupPrefs.end();
  server.send(200, "application/json", F("{\\"saved\\":true,\\"restarting\\":true}"));
  delay(250);
  ESP.restart();
}

/** Read every sensor once, guarded by the per-sensor minimum interval. */
void sampleSensors() {
${sampleBody.join('\n')}
}

String sensorsJson() {
  String json = "{";
${jsonBody.join('\n')}
  json += ",\\"uptime_s\\":" + String((millis() - bootMs) / 1000UL);
  json += ",\\"sample_ts_ms\\":" + String(lastSampleMs);
  json += "}";
  return json;
}

void handleSensors() {
  sendCorsHeaders();
  sampleSensors();
  server.send(200, "application/json", sensorsJson());
}

void handleStatus() {
  sendCorsHeaders();
  String json = "{\\"state\\":\\"online\\"";
  json += ",\\"device\\":\\"" DEVICE_NAME "\\"";
  json += ",\\"ip\\":\\"" + WiFi.localIP().toString() + "\\"";
  json += ",\\"ssid\\":\\"" + WiFi.SSID() + "\\"";
  json += ",\\"rssi_dbm\\":" + String(WiFi.RSSI());
  json += ",\\"uptime_s\\":" + String((millis() - bootMs) / 1000UL);
  json += "}";
  server.send(200, "application/json", json);
}

// ── Embedded dashboard ──────────────────────────────────────────────────────
// The device IS the website: open http://<device-ip>/ and this page renders
// live readings + a temperature chart straight from the firmware. The MERN
// dashboard (software zip) adds long-term history on top — it is optional
// for day-to-day use. Served from flash; nothing else to install.
static const char DASHBOARD_HTML[] PROGMEM = R"WIREUP_HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${plan.projectName}</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#0b1220;color:#e8edf5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}
.card{background:#131c2e;border:1px solid #24314d;border-radius:14px;padding:18px 20px;box-shadow:0 10px 30px rgba(0,0,0,.35);max-width:720px;width:100%}
h1{font-size:1.05rem;margin:0 0 2px;color:#9fb3d9;font-weight:600}
.meta{font-size:.75rem;color:#5f7195;margin-bottom:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.tile{background:#0e1726;border:1px solid #24314d;border-radius:10px;padding:12px 14px}
.tile .label{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:#7d90b8}
.tile .value{font-size:1.9rem;font-weight:700;margin-top:4px;color:#eaf1ff}
.tile .unit{font-size:.85rem;color:#7d90b8;font-weight:400}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.72rem;background:#0e3a2a;color:#5fe3a1;border:1px solid #175c42}
canvas{width:100%;height:110px;margin-top:14px;background:#0e1726;border:1px solid #24314d;border-radius:10px}
details{margin-top:12px;font-size:.8rem;color:#8fa2c8}
summary{cursor:pointer;color:#9fb3d9}
input{width:100%;background:#0e1726;border:1px solid #24314d;color:#e8edf5;border-radius:8px;padding:8px 10px;margin-top:6px;font-size:.85rem}
button{margin-top:10px;width:100%;background:#2563eb;color:#fff;border:0;border-radius:8px;padding:9px;font-size:.85rem;cursor:pointer}
.err{color:#ff8d8d;font-size:.75rem;margin-top:8px}
a{color:#7fb0ff}
</style>
</head>
<body>
<div class="card">
  <h1>${plan.projectName}</h1>
  <div class="meta"><span id="status" class="badge">connecting…</span> <span id="ip" style="color:#5f7195"></span> · up <span id="uptime">–</span> s</div>
  <div class="grid" id="grid"></div>
  <canvas id="chart" height="110"></canvas>
  <details>
    <summary>Wi-Fi settings — change network without re-flashing</summary>
    <input id="ssid" placeholder="Wi-Fi name (SSID)" autocomplete="off">
    <input id="pass" type="password" placeholder="Wi-Fi password">
    <button id="save">Save on device &amp; reconnect</button>
    <div id="err" class="err"></div>
  </details>
  <div class="meta" style="margin-top:10px">Generated by Wireup · live JSON at <a href="/api/sensors">/api/sensors</a> · history at <a href="/api/history">/api/history</a></div>
</div>
<script>
var grid = document.getElementById('grid');
var chart = document.getElementById('chart');
var ctx = chart.getContext('2d');
var history = [];
function el(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderSensors(payload) {
  grid.innerHTML = '';
  var fields = [['temperature_c', 'Temperature', '°C'], ['humidity_pct', 'Humidity', '%'], ['pressure_hpa', 'Pressure', 'hPa'], ['distance_cm', 'Distance', 'cm'], ['moisture_pct', 'Moisture', '%'], ['gas_ppm', 'Gas', 'ppm'], ['motion', 'Motion', '']];
  var any = false;
  for (var i = 0; i < fields.length; i++) {
    var key = fields[i][0];
    if (payload[key] === undefined || payload[key] === null) continue;
    any = true;
    var tile = el('div', 'tile');
    tile.appendChild(el('div', 'label', fields[i][1]));
    var raw = payload[key];
    var shown = key === 'motion' ? (Number(raw) === 1 ? 'Motion' : 'Still') : Number(raw).toFixed(1);
    var value = el('div', 'value', shown);
    if (key !== 'motion') value.appendChild(el('span', 'unit', ' ' + fields[i][2]));
    tile.appendChild(value);
    grid.appendChild(tile);
  }
  if (!any) grid.appendChild(el('div', 'tile', 'No readings yet — check the sensor wiring.'));
}
function drawChart() {
  var w = chart.clientWidth, h = 110;
  ctx.clearRect(0, 0, w, h);
  if (history.length < 2) return;
  var min = Infinity, max = -Infinity;
  for (var i = 0; i < history.length; i++) {
    if (history[i].temperature_c === undefined) continue;
    if (history[i].temperature_c < min) min = history[i].temperature_c;
    if (history[i].temperature_c > max) max = history[i].temperature_c;
  }
  if (min === Infinity) return;
  if (max - min < 0.5) { max += 0.25; min -= 0.25; }
  ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.6; ctx.beginPath();
  var started = false;
  for (var i = 0; i < history.length; i++) {
    var t = history[i].temperature_c;
    if (t === undefined) continue;
    var x = (i / (history.length - 1)) * w;
    var y = h - 8 - ((t - min) / (max - min)) * (h - 16);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
function refresh() {
  fetch('/api/sensors').then(function (r) { return r.json(); }).then(function (p) {
    renderSensors(p);
    document.getElementById('uptime').textContent = p.uptime_s;
    document.getElementById('status').textContent = 'online';
  }).catch(function () {
    document.getElementById('status').textContent = 'offline';
  });
  fetch('/api/status').then(function (r) { return r.json(); }).then(function (p) {
    document.getElementById('ip').textContent = p.ip;
  }).catch(function () {});
  fetch('/api/history').then(function (r) { return r.json(); }).then(function (p) {
    history = p; drawChart();
  }).catch(function () {});
}
document.getElementById('save').addEventListener('click', function () {
  var ssid = document.getElementById('ssid').value;
  var pass = document.getElementById('pass').value;
  if (!ssid) { document.getElementById('err').textContent = 'SSID required.'; return; }
  var body = 'ssid=' + encodeURIComponent(ssid) + '&password=' + encodeURIComponent(pass);
  fetch('/api/wifi', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body }).then(function (r) {
    return r.json();
  }).then(function () {
    document.getElementById('err').textContent = 'Saved — the device is reconnecting…';
  }).catch(function () {
    document.getElementById('err').textContent = 'Could not reach the device.';
  });
});
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>)WIREUP_HTML";

void handleRoot() {
  sendCorsHeaders();
#if ENABLE_EMBEDDED_DASHBOARD
  server.send_P(200, "text/html", DASHBOARD_HTML);
#else
  String html = F("<!doctype html><html><head><meta charset=\\"utf-8\\"><title>${plan.projectName}</title></head><body>");
  html += F("<h1>${plan.projectName}</h1>");
  html += F("<p>Generated by Wireup. JSON endpoints:</p><ul>");
  html += F("<li><a href=\\"/api/sensors\\">/api/sensors</a> — live readings</li>");
  html += F("<li><a href=\\"/api/status\\">/api/status</a> — device status</li>");
  html += F("</ul></body></html>");
  server.send(200, "text/html", html);
#endif
}

void handleNotFound() {
  sendCorsHeaders();
  server.send(404, "application/json", F("{\\"error\\":\\"not found\\"}"));
}

/** Join the configured network; fall back to our own AP so the dashboard is always reachable. */
void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  Serial.print(F("[wireup] Joining Wi-Fi "));
  Serial.println(wifiSsid);

  const unsigned long deadline = millis() + WIFI_CONNECT_TIMEOUT_MS;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(F("[wireup] Online at http://"));
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(F("[wireup] Station join failed — starting fallback AP"));
    WiFi.mode(WIFI_AP);
    WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASSWORD);
    Serial.print(F("[wireup] AP ")); Serial.print(WIFI_AP_SSID);
    Serial.print(F(" at http://")); Serial.println(WiFi.softAPIP());
  }

  if (MDNS.begin(MDNS_HOSTNAME)) {
    MDNS.addService("http", "tcp", WEB_SERVER_PORT);
    Serial.print(F("[wireup] mDNS: http://")); Serial.print(MDNS_HOSTNAME);
    Serial.println(F(".local"));
  }
}

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println();
  Serial.println(F("── ${plan.projectName} · Wireup firmware v1.0.0 ──"));
  bootMs = millis();

  loadWifiConfig();

${setupLines.map((line) => `  ${line}`).join('\n')}

${needsWire ? '  Wire.begin();\n  Serial.println(F("[wireup] I2C (Wire) up on SDA/SCL"));' : ''}
#if ENABLE_OTA
  ArduinoOTA.setHostname(DEVICE_NAME);
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    (void)progress; (void)total;
  });
  ArduinoOTA.begin();
  Serial.println(F("[wireup] OTA enabled — upload new firmware over Wi-Fi"));
#endif
  connectWifi();

  server.on("/", HTTP_GET, handleRoot);
  server.on("/api/sensors", HTTP_GET, handleSensors);
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/history", HTTP_GET, handleHistory);
  server.on("/api/wifi", HTTP_GET, handleWifi);
  server.on("/api/wifi", HTTP_POST, handleWifi);
${routeLines.join('\n')}
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.print(F("[wireup] HTTP API + dashboard listening on port "));
  Serial.println(WEB_SERVER_PORT);

  sampleSensors();
}

void loop() {
  server.handleClient();
  sampleSensors();
  recordHistory();
${displayLines.map((line) => `  ${line}`).join('\n')}
#if ENABLE_OTA
  ArduinoOTA.handle();
#endif
}
`;
}

function configSource(plan: DeviceBuildPlan, codes: ModuleCode[]): string {
  const defines = codes.flatMap((code) => code.configDefines).filter(Boolean);
  return `// ── ${plan.projectName} — build-time configuration (edit me) ─────────────
#pragma once

#define DEVICE_NAME "${plan.slug}"
#define VERSION "1.0.0"

// Wi-Fi credentials — station mode first, fallback AP if join fails.
// You can also change the network WITHOUT re-flashing: open the device page
// in a browser, expand "Wi-Fi settings", and save. (Stored in NVS.)
#define WIFI_SSID "${plan.wifi.ssid || 'YOUR_WIFI_SSID'}"
#define WIFI_PASSWORD "${plan.wifi.password || 'YOUR_WIFI_PASSWORD'}"
#define WIFI_CONNECT_TIMEOUT_MS 15000

// Fallback access point (used when the device cannot join your network).
#define WIFI_AP_SSID "${plan.slug}"
#define WIFI_AP_PASSWORD "wireup123"
#define MDNS_HOSTNAME "${plan.slug}"

// HTTP API the Wireup dashboard talks to.
#define WEB_SERVER_PORT 80

// Sampling cadence — the DHT family needs >= 2000 ms between reads.
#define SAMPLE_INTERVAL_MS ${plan.sampleIntervalMs}

// ── On-device extras ────────────────────────────────────────────────────────
// The device itself serves a full dashboard (live tiles, temperature chart,
// Wi-Fi setup) at http://<device-ip>/ — the MERN app is optional on top.
#define ENABLE_EMBEDDED_DASHBOARD 1
// Over-the-air firmware updates over Wi-Fi (Arduino IDE / PlatformIO).
#define ENABLE_OTA 1
// History ring buffer kept in RAM and served at /api/history.
#define HISTORY_DEPTH 720        // entries
#define HISTORY_INTERVAL_MS 60000 // one entry per minute (~12 h at 720)

// ── Pin map ─────────────────────────────────────────────────────────────────
${defines.join('\n')}
`;
}

function platformioIni(plan: DeviceBuildPlan): string {
  const libs = new Set<string>();
  for (const module of plan.modules) {
    module.libraries.forEach((lib) => libs.add(`    ${lib.source}`));
  }
  const libDeps = libs.size ? [...libs].join('\n') : '    ; no external libraries required';

  return `; ── ${plan.projectName} · generated by Wireup ────────────────────────────
; Build with:  pio run            (needs https://platformio.org)
; Upload with: pio run -t upload  (board over USB)
; Monitor:     pio device monitor

[platformio]
src_dir = firmware

[env:${plan.board.platformioEnv}]
platform = espressif32
board = ${plan.board.pioBoard}
framework = arduino
monitor_speed = 115200
lib_deps =
${libDeps}
`;
}

function readme(plan: DeviceBuildPlan): string {
  const wiringRows = plan.modules.flatMap((module) =>
    Object.entries(module.pins).map(
      ([role, pin]) => `| ${module.name} (${module.partNumber}) | ${role.toUpperCase()} | ${pin} |`,
    ),
  );
  const notes = plan.modules.flatMap((module) =>
    module.wiringNotes.map((note) => `- **${module.name}** — ${note}`),
  );

  return `# ${plan.projectName} — firmware

Generated by **Wireup**. Target: **${plan.board.name}** (${plan.board.mcu}, ${plan.board.voltage} V logic).

## What this does

- Samples the connected sensors every \`${plan.sampleIntervalMs} ms\` (interval-safe per sensor).
- Joins your Wi-Fi — or starts its own hotspot (\`${plan.slug}\`, password \`wireup123\`) if it cannot.
- **Serves a complete dashboard at \`http://<device-ip>/\`** — live tiles, a temperature chart, and Wi-Fi settings. No Node, no laptop app needed.
- Serves a JSON API on port 80 that the Wireup dashboard (the software zip) talks to — optional on top.
- Keeps a history ring buffer in RAM (one sample/minute, ~12 h) at \`/api/history\`.
- Accepts OTA firmware updates over Wi-Fi (Arduino IDE / PlatformIO).

## Endpoints

| Route | Method | Returns |
| --- | --- | --- |
| \`/\` | GET | Full embedded dashboard (HTML + charts) |
| \`/api/sensors\` | GET | All live readings as JSON |
| \`/api/status\` | GET | Device health: IP, SSID, RSSI, uptime |
| \`/api/history\` | GET | Ring-buffered samples (one per minute) |
| \`/api/wifi\` | GET/POST | Current SSID / save new credentials (NVS) |
${plan.modules
  .filter((m) => m.controls.length > 0)
  .flatMap((m) => m.controls.map((c) => `| \`/api/control/${c.id}\` | POST | Actuate ${c.label.toLowerCase()} (form or JSON \`state\`/field arg) |`))
  .join('\n')}

## Wiring

| Module | Pin role | ${plan.board.name} pin |
| --- | --- | --- |
${wiringRows.join('\n') || '| — | — | — |'}

## Wiring notes

${notes.join('\n') || '- Nothing special — direct GPIO connections.'}

## Flash it (Arduino IDE)

1. Install the **esp32** board package (Espressif) in the Boards Manager.
2. Open \`firmware/${plan.slug}.ino\`. Install these libraries via Library Manager:
${[...new Set(plan.modules.flatMap((m) => m.libraries.map((l) => `   - ${l.name}`)))].join('\n') || '   - (none)'}
   - Preferences, ArduinoOTA, WiFi, WebServer, ESPmDNS (bundled with the esp32 core)
3. Edit \`firmware/config.h\`: set \`WIFI_SSID\` / \`WIFI_PASSWORD\`.
4. Select board **${plan.board.name}**, pick the port, upload.
5. Open Serial Monitor at **115200 baud** — it prints the device IP.
6. Open \`http://<device-ip>/\` in any browser on the same network — that is the dashboard.

## Flash it (PlatformIO)

\`\`\`bash
pio run -t upload && pio device monitor
\`\`\`

## Change Wi-Fi without re-flashing

Open \`http://<device-ip>/\`, expand **Wi-Fi settings**, save the new network.
The credentials are stored in NVS and survive re-flashes.

## OTA updates

With \`ENABLE_OTA 1\` the device appears as a network port in Arduino IDE
("ESP32 at <ip>") and accepts \`pio run -t upload --upload-port <ip>\`.
No USB cable needed after the first flash.

## Test the API from your computer

\`\`\`bash
curl http://<device-ip>/api/status
curl http://<device-ip>/api/sensors
curl http://<device-ip>/api/history
curl -X POST http://<device-ip>/api/wifi -d 'ssid=MyNet&password=secret'
\`\`\`
`;
}

/** Assemble the full firmware project for the resolved plan. */
export function synthesizeFirmware(plan: DeviceBuildPlan): FirmwareResult {
  const codes = plan.modules.map((module) => codeFor(module));
  const libraries = new Set<string>();
  plan.modules.forEach((module) => module.libraries.forEach((lib) => libraries.add(lib.name)));

  // Ship the Wokwi simulation config in the firmware zip so a user can boot
  // the firmware in a virtual circuit (after `pio run` produces the ELF) with
  // a free token — same files the validation gate uses.
  const wokwi = generateWokwiConfig(plan);

  const universal = generateUniversalDiagram(plan, { version: 1, author: 'Wireup', parts: JSON.parse(wokwi.diagramJson).parts ?? [], connections: JSON.parse(wokwi.diagramJson).connections ?? [] });
  // Native Velxio project: the same circuit, openable in the emulator with the
  // generated sketch already loaded (external/velxio, AGPL-3.0).
  const sketch = { name: `${plan.slug}.ino`, content: sketchSource(plan, codes) };
  const velxio = generateVelxioProject(plan, sketch);

  const files: BuildFile[] = [
    { path: 'platformio.ini', content: platformioIni(plan) },
    { path: `firmware/${plan.slug}.ino`, content: sketch.content },
    { path: 'firmware/config.h', content: configSource(plan, codes) },
    { path: 'wokwi.toml', content: wokwi.wokwiToml },
    { path: 'diagram.json', content: JSON.stringify(universal, null, 2) },
    { path: 'hardware/universal-diagram.json', content: JSON.stringify(universal, null, 2) },
    { path: `simulation/${plan.slug}.vlx`, content: velxio.json },
    { path: 'README.md', content: readme(plan) },
  ];

  return {
    platform: 'esp32-arduino',
    board: plan.board.name,
    language: 'C++',
    framework: 'Arduino · PlatformIO',
    files,
    buildSteps: [
      'Edit firmware/config.h — set WIFI_SSID and WIFI_PASSWORD.',
      `Flash with Arduino IDE (open firmware/${plan.slug}.ino) or PlatformIO (pio run -t upload).`,
      'Watch Serial at 115200 baud for the assigned IP address.',
      "Run 'npm install && npm run dev' in the software project; set DEVICE_IP to that address.",
    ],
    notes: [
      ...plan.modules.flatMap((module) => module.firmwareNotes),
      'If Wi-Fi join fails the device starts its own network — connect to it and visit http://192.168.4.1/api/status.',
      `Libraries: ${libraries.size ? [...libraries].join(', ') : 'none (Arduino core only)'}.`,
    ],
  };
}
