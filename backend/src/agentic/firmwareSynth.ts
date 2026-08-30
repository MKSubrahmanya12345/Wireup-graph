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
        '    if (!server.hasArg("angle")) { server.send(400, "application/json", F("{\\"error\\":\\"missing angle\\"}")); return; }',
        '    servoDeg = constrain(server.arg("angle").toInt(), 0, 180);',
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
    '    if (!server.hasArg("state")) { server.send(400, "application/json", F("{\\"error\\":\\"missing state\\"}")); return; }',
    '    const String requested = server.arg("state");',
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

void sendCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
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

void handleRoot() {
  sendCorsHeaders();
  String html = F("<!doctype html><html><head><meta charset=\\"utf-8\\"><title>${plan.projectName}</title></head><body>");
  html += F("<h1>${plan.projectName}</h1>");
  html += F("<p>Generated by Wireup. JSON endpoints:</p><ul>");
  html += F("<li><a href=\\"/api/sensors\\">/api/sensors</a> — live readings</li>");
  html += F("<li><a href=\\"/api/status\\">/api/status</a> — device status</li>");
  html += F("</ul></body></html>");
  server.send(200, "text/html", html);
}

void handleNotFound() {
  sendCorsHeaders();
  server.send(404, "application/json", F("{\\"error\\":\\"not found\\"}"));
}

/** Join the configured network; fall back to our own AP so the dashboard is always reachable. */
void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print(F("[wireup] Joining Wi-Fi "));
  Serial.println(WIFI_SSID);

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

${setupLines.map((line) => `  ${line}`).join('\n')}

${needsWire ? '  Serial.println(F("[wireup] I2C (Wire) up on SDA/SCL"));' : ''}
  connectWifi();

  server.on("/", HTTP_GET, handleRoot);
  server.on("/api/sensors", HTTP_GET, handleSensors);
  server.on("/api/status", HTTP_GET, handleStatus);
${routeLines.join('\n')}
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.print(F("[wireup] HTTP API listening on port "));
  Serial.println(WEB_SERVER_PORT);

  sampleSensors();
}

void loop() {
  server.handleClient();
  sampleSensors();
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
- Serves a JSON API on port 80 that the Wireup dashboard (the software zip) talks to.

## Endpoints

| Route | Method | Returns |
| --- | --- | --- |
| \`/api/sensors\` | GET | All live readings as JSON |
| \`/api/status\` | GET | Device health: IP, SSID, RSSI, uptime |
${plan.modules
  .filter((m) => m.controls.length > 0)
  .flatMap((m) => m.controls.map((c) => `| \`/api/control/${c.id}\` | POST | Actuate ${c.label.toLowerCase()} (arg \`state\`) |`))
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
3. Edit \`firmware/config.h\`: set \`WIFI_SSID\` / \`WIFI_PASSWORD\`.
4. Select board **${plan.board.name}**, pick the port, upload.
5. Open Serial Monitor at **115200 baud** — it prints the device IP.

## Flash it (PlatformIO)

\`\`\`bash
pio run -t upload && pio device monitor
\`\`\`

## Test the API from your computer

\`\`\`bash
curl http://<device-ip>/api/status
curl http://<device-ip>/api/sensors
\`\`\`
`;
}

/** Assemble the full firmware project for the resolved plan. */
export function synthesizeFirmware(plan: DeviceBuildPlan): FirmwareResult {
  const codes = plan.modules.map((module) => codeFor(module));
  const libraries = new Set<string>();
  plan.modules.forEach((module) => module.libraries.forEach((lib) => libraries.add(lib.name)));

  const files: BuildFile[] = [
    { path: 'platformio.ini', content: platformioIni(plan) },
    { path: `firmware/${plan.slug}.ino`, content: sketchSource(plan, codes) },
    { path: 'firmware/config.h', content: configSource(plan, codes) },
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
