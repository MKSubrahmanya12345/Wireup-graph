/**
 * sensorDefs.ts — interactive control definitions for EVERY controllable part.
 *
 * Adapted from velxio's sensorControlConfig.ts (same ranges, defaults and
 * units — DHT22 −40..80 °C, HC-SR04 2..400 cm, LDR 0..1000 lux log-scale,
 * MPU6050 ±2 g / ±250 °/s, GPS lat/lng/alt/speed, …) plus the input parts
 * velxio drives through BasicParts/ComplexParts instead of the panel
 * (pushbutton press-and-hold, slide-switch, DIP-8, KY-040 steps, pot wiper,
 * servo angle, LED brightness/colour, relay coil, buzzer test, LCD rows,
 * keypad keys, joystick X/Y).
 *
 * One def drives BOTH the 3D inspector panel and the 2D bench tile controls,
 * so the two views never disagree about what a part can do.
 */

export interface SliderControl {
  kind: 'slider';
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  def: number;
  /** Log-scale position mapping for lux-style quantities. */
  log?: boolean;
  decimals?: number;
}

export interface PressControl {
  kind: 'press';
  key: string;
  label: string;
  hint?: string;
}

export interface ToggleControl {
  kind: 'toggle';
  key: string;
  label: string;
  def: boolean;
}

export interface KeysControl {
  kind: 'keys';
  key: string;
  label: string;
  keys: string[];
}

export interface TextControl {
  kind: 'text';
  key: string;
  label: string;
  def: string;
  rows?: number;
}

export type PartControl = SliderControl | PressControl | ToggleControl | KeysControl | TextControl;

export interface PartControlDef {
  title: string;
  blurb: string;
  controls: PartControl[];
}

const temp = (def = 25): SliderControl => ({
  kind: 'slider', key: 'temperature', label: 'Temperature',
  min: -40, max: 80, step: 0.5, unit: '°C', def, decimals: 1,
});

const hum = (def = 50): SliderControl => ({
  kind: 'slider', key: 'humidity', label: 'Humidity',
  min: 0, max: 100, step: 0.5, unit: '%RH', def, decimals: 1,
});

const pressBtn = (label: string, hint?: string): PressControl => ({ kind: 'press', key: 'press', label, hint });

export const PART_CONTROLS: Record<string, PartControlDef> = {
  dht22: {
    title: 'DHT22 temperature & humidity',
    blurb: 'Single-wire 40-bit frame on DATA (min 2 s between reads). Needs a 4.7–10 kΩ pull-up.',
    controls: [temp(25), hum(50)],
  },
  dht11: {
    title: 'DHT11 temperature & humidity',
    blurb: 'Single-wire frame, ±2 °C / ±5 %RH. Same wiring as DHT22.',
    controls: [temp(25), hum(50)],
  },
  bmp280: {
    title: 'BMP280 pressure + temperature',
    blurb: 'I2C 0x76/0x77. Pressure slider covers weather range.',
    controls: [
      temp(24),
      { kind: 'slider', key: 'pressure', label: 'Pressure', min: 300, max: 1100, step: 0.25, unit: 'hPa', def: 1013.25, decimals: 2 },
    ],
  },
  bme280: {
    title: 'BME280 environment',
    blurb: 'I2C temp + pressure + humidity in one frame.',
    controls: [
      temp(24),
      { kind: 'slider', key: 'pressure', label: 'Pressure', min: 300, max: 1100, step: 0.25, unit: 'hPa', def: 1013.25, decimals: 2 },
      hum(50),
    ],
  },
  ds18b20: {
    title: 'DS18B20 probe',
    blurb: '1-Wire 12-bit temperature. −55..+125 °C, ±0.5 °C.',
    controls: [{ kind: 'slider', key: 'temperature', label: 'Temperature', min: -55, max: 125, step: 0.5, unit: '°C', def: 24, decimals: 1 }],
  },
  'cap-soil': {
    title: 'Capacitive soil sensor',
    blurb: 'Analog out: dry ≈ 520 counts, wet ≈ 260. No corrosion — no exposed copper.',
    controls: [{ kind: 'slider', key: 'moisture', label: 'Soil moisture', min: 0, max: 100, step: 1, unit: '%', def: 42 }],
  },
  'gas-sensor': {
    title: 'MQ gas sensor',
    blurb: 'Heater draws ~150 mA @ 5 V. Higher level → higher AO voltage.',
    controls: [{ kind: 'slider', key: 'gasLevel', label: 'Gas level', min: 0, max: 1023, step: 1, unit: '', def: 100 }],
  },
  'mq-2': {
    title: 'MQ-2 gas sensor',
    blurb: 'Heater draws ~150 mA @ 5 V. Higher level → higher AO voltage.',
    controls: [{ kind: 'slider', key: 'gasLevel', label: 'Gas level', min: 0, max: 1023, step: 1, unit: '', def: 100 }],
  },
  'hc-sr04': {
    title: 'HC-SR04 ultrasonic',
    blurb: '10 µs TRIG → ECHO pulse 58 µs/cm. ECHO is 5 V: divide to 3.3 V for ESP32.',
    controls: [{ kind: 'slider', key: 'distance', label: 'Distance', min: 2, max: 400, step: 1, unit: 'cm', def: 10 }],
  },
  'pir-motion-sensor': {
    title: 'PIR motion sensor',
    blurb: 'OUT goes HIGH ~2 s on motion, retriggerable. Warm-up ~30 s on real hardware.',
    controls: [pressBtn('Simulate motion', 'Hold to keep OUT HIGH')],
  },
  mpu6050: {
    title: 'MPU6050 6-axis IMU',
    blurb: 'I2C 0x68/0x69. Accel ±2 g, gyro ±250 °/s, die temp.',
    controls: [
      { kind: 'slider', key: 'accelX', label: 'Accel X', min: -2, max: 2, step: 0.01, unit: 'g', def: 0, decimals: 2 },
      { kind: 'slider', key: 'accelY', label: 'Accel Y', min: -2, max: 2, step: 0.01, unit: 'g', def: 0, decimals: 2 },
      { kind: 'slider', key: 'accelZ', label: 'Accel Z', min: -2, max: 2, step: 0.01, unit: 'g', def: 1, decimals: 2 },
      { kind: 'slider', key: 'gyroX', label: 'Gyro X', min: -250, max: 250, step: 1, unit: '°/s', def: 0 },
      { kind: 'slider', key: 'gyroY', label: 'Gyro Y', min: -250, max: 250, step: 1, unit: '°/s', def: 0 },
      { kind: 'slider', key: 'gyroZ', label: 'Gyro Z', min: -250, max: 250, step: 1, unit: '°/s', def: 0 },
      { kind: 'slider', key: 'temp', label: 'Die temp', min: -40, max: 85, step: 1, unit: '°C', def: 24, decimals: 1 },
    ],
  },
  'ntc-temperature-sensor': {
    title: 'NTC thermistor',
    blurb: 'β = 3950 divider: V = VCC·Rntc/(Rntc+10 k). Slider decodes back exactly.',
    controls: [{ kind: 'slider', key: 'temperature', label: 'Temperature', min: -40, max: 125, step: 1, unit: '°C', def: 25, decimals: 1 }],
  },
  'photoresistor-sensor': {
    title: 'Photoresistor (LDR)',
    blurb: 'Log slider — an LDR lives in the low decades; linear would cram it into 2% of travel.',
    controls: [{ kind: 'slider', key: 'lux', label: 'Illumination', min: 0, max: 1000, step: 1, unit: 'lux', def: 500, log: true }],
  },
  photodiode: {
    title: 'Photodiode',
    blurb: 'Reverse-biased current source ≈ 100 nA/lux in the SPICE netlist.',
    controls: [{ kind: 'slider', key: 'lux', label: 'Illumination', min: 0, max: 1000, step: 1, unit: 'lux', def: 500, log: true }],
  },
  'flame-sensor': {
    title: 'Flame sensor',
    blurb: 'Inverted: no flame ≈ 4.5 V, intense flame pulls AO low.',
    controls: [{ kind: 'slider', key: 'intensity', label: 'Flame intensity', min: 0, max: 1023, step: 1, unit: '', def: 0 }],
  },
  'big-sound-sensor': {
    title: 'Sound sensor (FC-04)',
    blurb: 'Electret + LM393. AO follows level, DO trips at the trimmer threshold.',
    controls: [
      { kind: 'slider', key: 'soundLevel', label: 'Sound level', min: 0, max: 1023, step: 1, unit: '', def: 512 },
      pressBtn('Clap', 'Spikes the level briefly'),
    ],
  },
  'small-sound-sensor': {
    title: 'Sound sensor (KY-038)',
    blurb: 'Electret + LM393. AO follows level, DO trips at the trimmer threshold.',
    controls: [
      { kind: 'slider', key: 'soundLevel', label: 'Sound level', min: 0, max: 1023, step: 1, unit: '', def: 512 },
      pressBtn('Clap', 'Spikes the level briefly'),
    ],
  },
  'heart-beat-sensor': {
    title: 'Pulse sensor',
    blurb: 'Amped PPG: ~60 BPM, OUT HIGH 100 ms per beat.',
    controls: [{ kind: 'slider', key: 'bpm', label: 'Heart rate', min: 40, max: 180, step: 1, unit: 'BPM', def: 60 }],
  },
  'tilt-switch': {
    title: 'Tilt switch',
    blurb: 'Ball-in-tube: tilted = OUT HIGH, upright = LOW. Click the part too.',
    controls: [pressBtn('Toggle tilt', 'Flips HIGH ⇄ LOW')],
  },
  'analog-joystick': {
    title: 'Analog joystick',
    blurb: 'VRX/VRY centre at VCC/2, SW is active-low. Drag the 3D stick too.',
    controls: [
      { kind: 'slider', key: 'xAxis', label: 'X axis', min: -512, max: 512, step: 1, unit: '', def: 0 },
      { kind: 'slider', key: 'yAxis', label: 'Y axis', min: -512, max: 512, step: 1, unit: '', def: 0 },
      pressBtn('Press stick (SW)'),
    ],
  },
  'ky-040': {
    title: 'KY-040 rotary encoder',
    blurb: 'Quadrature CLK/DT + push. Detents every step; 3D knob turns with it.',
    controls: [
      { kind: 'slider', key: 'steps', label: 'Detents', min: -100, max: 100, step: 1, unit: '', def: 0 },
      pressBtn('Push knob (SW)'),
    ],
  },
  'gps-neo6m': {
    title: 'GPS NEO-6M',
    blurb: 'Position is fed into the NMEA stream the firmware parses.',
    controls: [
      { kind: 'slider', key: 'lat', label: 'Latitude', min: -90, max: 90, step: 0.0001, unit: '°', def: 12.9716, decimals: 4 },
      { kind: 'slider', key: 'lng', label: 'Longitude', min: -180, max: 180, step: 0.0001, unit: '°', def: 77.5946, decimals: 4 },
      { kind: 'slider', key: 'altitude', label: 'Altitude', min: -100, max: 9000, step: 1, unit: 'm', def: 920 },
      { kind: 'slider', key: 'speed', label: 'Speed', min: 0, max: 200, step: 0.5, unit: 'kn', def: 0, decimals: 1 },
    ],
  },
  hx711: {
    title: 'HX711 load cell amp',
    blurb: '24-bit ADC, gain 128 on channel A.',
    controls: [{ kind: 'slider', key: 'weight', label: 'Load', min: 0, max: 5000, step: 1, unit: 'g', def: 0 }],
  },
  ds3231: {
    title: 'DS3231 RTC',
    blurb: 'I2C negocio + on-chip temperature sensor.',
    controls: [{ kind: 'slider', key: 'temperature', label: 'Chip temp', min: -40, max: 85, step: 0.25, unit: '°C', def: 25, decimals: 2 }],
  },
  ds1307: {
    title: 'DS1307 RTC',
    blurb: 'I2C real-time clock, battery-backed.',
    controls: [pressBtn('Tick +1 min', 'Advances the clock readout')],
  },
  'ir-receiver': {
    title: 'IR receiver (VS1838B)',
    blurb: 'NEC frames on OUT. Point the 3D remote and press a key.',
    controls: [pressBtn('Send NEC frame')],
  },
  'ir-remote': {
    title: 'IR remote',
    blurb: 'NEC handset. Keys emit address + command the receiver decodes.',
    controls: [{ kind: 'keys', key: 'key', label: 'Key', keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'OK', 'PWR'] }],
  },

  // ── Input parts ──
  pushbutton: {
    title: 'Pushbutton',
    blurb: 'INPUT_PULLUP idle HIGH, press pulls LOW (active-low). Click-and-hold the 3D cap.',
    controls: [pressBtn('Hold to press', 'Drives the wired net LOW while held')],
  },
  'pushbutton-6mm': {
    title: '6 mm tactile button',
    blurb: 'INPUT_PULLUP idle HIGH, press pulls LOW. Same behaviour, B3F outline.',
    controls: [pressBtn('Hold to press', 'Drives the wired net LOW while held')],
  },
  'slide-switch': {
    title: 'Slide switch',
    blurb: 'SPDT: common follows the knob. The 3D knob slides on click.',
    controls: [{ kind: 'toggle', key: 'on', label: 'Switch ON', def: false }],
  },
  'dip-switch-8': {
    title: 'DIP switch ×8',
    blurb: 'Eight independent throws. Each closed switch drives its net.',
    controls: [{ kind: 'keys', key: 'dip', label: 'Throws (click to flip)', keys: ['1', '2', '3', '4', '5', '6', '7', '8'] }],
  },
  potentiometer: {
    title: 'Potentiometer',
    blurb: 'Wiper 0..1023 → V = frac × Vref (5 V AVR, 3.3 V otherwise). Drag the 3D knob.',
    controls: [{ kind: 'slider', key: 'value', label: 'Wiper', min: 0, max: 1023, step: 1, unit: '', def: 512 }],
  },
  'slide-potentiometer': {
    title: 'Slide potentiometer',
    blurb: '60 mm travel fader. Wiper 0..1023 → V = frac × Vref.',
    controls: [{ kind: 'slider', key: 'value', label: 'Fader', min: 0, max: 1023, step: 1, unit: '', def: 512 }],
  },
  'membrane-keypad': {
    title: 'Membrane keypad 4×4',
    blurb: 'Matrix scan: the model owns the COL lines, firmware scans ROWs.',
    controls: [{ kind: 'keys', key: 'key', label: 'Key', keys: ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'] }],
  },
  'rotary-dialer': {
    title: 'Rotary dial',
    blurb: 'Pulse dialling: N pulses per digit on the loop line.',
    controls: [{ kind: 'keys', key: 'key', label: 'Dial', keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] }],
  },

  // ── Actuators / output ──
  servo: {
    title: 'SG90 servo',
    blurb: '50 Hz PWM, 544–2400 µs → 0–180°. Never from the 3.3 V rail (stall 650 mA).',
    controls: [{ kind: 'slider', key: 'angle', label: 'Angle', min: 0, max: 180, step: 1, unit: '°', def: 90 }],
  },
  'stepper-motor': {
    title: 'Stepper motor',
    blurb: 'Full-step sequence on the driver nets. Shaft angle accumulates.',
    controls: [{ kind: 'slider', key: 'angle', label: 'Shaft angle', min: 0, max: 360, step: 1, unit: '°', def: 0 }],
  },
  'biaxial-stepper': {
    title: 'Pan-tilt pair',
    blurb: 'Two servo channels: pan + tilt.',
    controls: [
      { kind: 'slider', key: 'angle', label: 'Pan', min: 0, max: 180, step: 1, unit: '°', def: 90 },
      { kind: 'slider', key: 'tilt', label: 'Tilt', min: 0, max: 180, step: 1, unit: '°', def: 90 },
    ],
  },
  a4988: {
    title: 'A4988 stepper driver',
    blurb: 'STEP/DIR + MS1–3 microstepping. Set Vref for the motor current.',
    controls: [
      { kind: 'slider', key: 'microsteps', label: 'Microstepping', min: 1, max: 16, step: 1, unit: '', def: 16 },
      pressBtn('STEP pulse', 'Advances one (micro)step'),
    ],
  },
  'motor-driver-l293d': {
    title: 'L293D H-bridge',
    blurb: 'Dual bridge, 600 mA/ch. EN + IN1/IN2 truth table per channel.',
    controls: [
      { kind: 'toggle', key: 'en', label: 'Enable', def: true },
      { kind: 'slider', key: 'speed', label: 'PWM duty', min: 0, max: 100, step: 1, unit: '%', def: 70 },
    ],
  },
  relay: {
    title: 'Relay module (1-ch)',
    blurb: '5 V coil ≈ 70 Ω + flyback diode. COM → NO when energised.',
    controls: [{ kind: 'toggle', key: 'on', label: 'Energise coil', def: false }],
  },
  'ks2e-m-dc5': {
    title: 'Relay module (2-ch)',
    blurb: 'Two independent 5 V coils, opto-isolated inputs (active-low).',
    controls: [
      { kind: 'toggle', key: 'on', label: 'Energise CH1', def: false },
      { kind: 'toggle', key: 'ch2', label: 'Energise CH2', def: false },
    ],
  },
  buzzer: {
    title: 'Buzzer',
    blurb: 'Active 5 V: HIGH sings ~2.3 kHz. Passive needs a PWM tone.',
    controls: [pressBtn('Beep', 'Drives the signal net HIGH while held')],
  },
  led: {
    title: 'Indicator LED',
    blurb:
      'On/off follows the circuit (anode HIGH + cathode to GND) — a real LED has no software ' +
      'switch, so there is no Light toggle. Unwired LEDs mirror the heartbeat. >100 mA sustained burns it out.',
    controls: [
      { kind: 'slider', key: 'brightness', label: 'Brightness', min: 0, max: 100, step: 1, unit: '%', def: 100 },
    ],
  },
  'rgb-led': {
    title: 'RGB LED',
    blurb: 'Common-cathode R/G/B dice. Mix channels for any colour.',
    controls: [
      { kind: 'slider', key: 'r', label: 'Red', min: 0, max: 255, step: 1, unit: '', def: 255 },
      { kind: 'slider', key: 'g', label: 'Green', min: 0, max: 255, step: 1, unit: '', def: 64 },
      { kind: 'slider', key: 'b', label: 'Blue', min: 0, max: 255, step: 1, unit: '', def: 0 },
    ],
  },
  neopixel: {
    title: 'NeoPixel (WS2812B)',
    blurb: 'Single-wire GRB @ 800 kHz. Chainable DOUT.',
    controls: [
      { kind: 'slider', key: 'r', label: 'Red', min: 0, max: 255, step: 1, unit: '', def: 255 },
      { kind: 'slider', key: 'g', label: 'Green', min: 0, max: 255, step: 1, unit: '', def: 64 },
      { kind: 'slider', key: 'b', label: 'Blue', min: 0, max: 255, step: 1, unit: '', def: 0 },
    ],
  },
  'microsd-card': {
    title: 'microSD module',
    blurb: 'SPI @ 3.3 V (level-shifted). FAT16/32 CSV logging.',
    controls: [pressBtn('Flush buffer', 'Commits the log window')],
  },

  // ── Displays ──
  ssd1306: {
    title: 'SSD1306 OLED 128×64',
    blurb: 'I2C 0x3C. Framebuffer renders live on the 3D glass.',
    controls: [{ kind: 'text', key: 'lines', label: 'Screen lines', def: 'Hello!\nI2C 0x3C OK', rows: 2 }],
  },
  'lcd1602-i2c': {
    title: 'LCD 16×2 (I2C)',
    blurb: 'HD44780 + PCF8574 @ 0x27. Backlight included.',
    controls: [
      { kind: 'text', key: 'lines', label: 'Rows', def: 'Hello World!\nI2C 16x2 OK', rows: 2 },
      { kind: 'toggle', key: 'backlight', label: 'Backlight', def: true },
    ],
  },
  lcd1602: {
    title: 'LCD 16×2',
    blurb: 'HD44780 parallel 4-bit. Backlight included.',
    controls: [
      { kind: 'text', key: 'lines', label: 'Rows', def: 'Hello World!\nParallel OK', rows: 2 },
      { kind: 'toggle', key: 'backlight', label: 'Backlight', def: true },
    ],
  },
  'lcd2004-i2c': {
    title: 'LCD 20×4 (I2C)',
    blurb: 'HD44780 + PCF8574 @ 0x27, four rows.',
    controls: [
      { kind: 'text', key: 'lines', label: 'Rows', def: 'Row 1\nRow 2\nRow 3\nRow 4', rows: 4 },
      { kind: 'toggle', key: 'backlight', label: 'Backlight', def: true },
    ],
  },
  lcd2004: {
    title: 'LCD 20×4',
    blurb: 'HD44780 parallel, four rows.',
    controls: [
      { kind: 'text', key: 'lines', label: 'Rows', def: 'Row 1\nRow 2\nRow 3\nRow 4', rows: 4 },
      { kind: 'toggle', key: 'backlight', label: 'Backlight', def: true },
    ],
  },
  ili9341: {
    title: 'ILI9341 TFT 240×320',
    blurb: 'SPI + DC/CS/RST. Demo pattern renders until firmware draws.',
    controls: [{ kind: 'toggle', key: 'on', label: 'Display ON', def: true }],
  },
  '7segment': {
    title: '7-segment digit',
    blurb: 'Common-cathode, 220 Ω per segment.',
    controls: [{ kind: 'slider', key: 'digit', label: 'Digit', min: 0, max: 9, step: 1, unit: '', def: 8 }],
  },
  'neopixel-matrix': {
    title: 'NeoPixel matrix 8×8',
    blurb: '64 WS2812B in row-major order from DIN.',
    controls: [
      { kind: 'slider', key: 'brightness', label: 'Brightness', min: 0, max: 100, step: 1, unit: '%', def: 40 },
      pressBtn('Rainbow test', 'Runs the strand test pattern'),
    ],
  },
  'led-ring': {
    title: 'NeoPixel ring ×16',
    blurb: '16 WS2812B in a circle from DIN.',
    controls: [{ kind: 'slider', key: 'brightness', label: 'Brightness', min: 0, max: 100, step: 1, unit: '%', def: 40 }],
  },
  'led-bar-graph': {
    title: 'LED bar graph',
    blurb: '10 segments, common cathode. Level lights N segments.',
    controls: [{ kind: 'slider', key: 'level', label: 'Level', min: 0, max: 10, step: 1, unit: '', def: 5 }],
  },

  // ── Logic ──
  'logic-ic': {
    title: 'Logic IC',
    blurb: '74HC truth table evaluated from the input nets every frame.',
    controls: [pressBtn('Pulse inputs', 'Wiggles A/B for a gate check')],
  },
  ne555: {
    title: 'NE555 timer (astable)',
    blurb:
      'Free-runs at f = 1.44/((R1+2·R2)·C) from wall-clock phase — wire OUT (pin 3) ' +
      'to a 4017/595 clock and watch the chase. Sampling resolves clocks near or below ' +
      'half the bench rate: raise C to slow it down. RESET (pin 4) holds OUT low only when driven low.',
    controls: [
      { kind: 'slider', key: 'r1', label: 'R1', min: 0.1, max: 1000, step: 0.1, unit: 'kΩ', def: 1, decimals: 1, log: true },
      { kind: 'slider', key: 'r2', label: 'R2', min: 0.1, max: 1000, step: 0.1, unit: 'kΩ', def: 100, decimals: 1, log: true },
      { kind: 'slider', key: 'c', label: 'C', min: 0.1, max: 1000, step: 0.1, unit: 'µF', def: 10, decimals: 1, log: true },
    ],
  },
  cd4017: {
    title: 'CD4017 decade counter',
    blurb:
      'Each clock ↑ advances Q0→Q9 (pins 3,2,4,7,10,1,5,6,9,11); CO (pin 12) stays HIGH ' +
      'for counts 0–4. RESET high, INHIBIT high, or hold-to-reset returns to Q0. The classic 555 chase partner.',
    controls: [pressBtn('Hold to reset', 'Returns the count to Q0 while held')],
  },
  hc595: {
    title: '74HC595 shift register',
    blurb:
      'SER (pin 14) shifts in on SRCLK ↑, RCLK ↑ latches the byte to Q0–Q7, QH′ (pin 9) ' +
      'chains to the next chip. MR clears the shift register only — the latch keeps its byte ' +
      'until the next RCLK, exactly like silicon.',
    controls: [pressBtn('Hold to clear', 'Clears the shift register (MR)')],
  },
  hc165: {
    title: '74HC165 shift register',
    blurb:
      'Parallel-in companion to the 595: SH/LD low (or hold-to-load) samples D0–D7, CLK ↑ shifts ' +
      'SER in, QH (pin 9) reads out, QH′ (pin 7, inverted) chains. Read 8 switches on 3 MCU pins.',
    controls: [pressBtn('Hold to load', 'Samples the parallel inputs while held')],
  },
  hc00: {
    title: '74HC00 quad NAND',
    blurb: 'Four 2-input NAND gates, DIP-14 (Y = 3,4,10,11). Floating inputs read LOW; wire VCC/GND for the honest version.',
    controls: [],
  },
  hc02: {
    title: '74HC02 quad NOR',
    blurb: 'Four 2-input NOR gates, DIP-14 (Y = 1,4,10,11). Floating inputs read LOW; wire VCC/GND for the honest version.',
    controls: [],
  },
  hc04: {
    title: '74HC04 hex inverter',
    blurb: 'Six NOT gates, DIP-14 (Y = 2,4,6,8,10,12). Covers the 74HC14 Schmitt variant pinout too.',
    controls: [],
  },
  hc08: {
    title: '74HC08 quad AND',
    blurb: 'Four 2-input AND gates, DIP-14 (Y = 3,4,10,11). Floating inputs read LOW; wire VCC/GND for the honest version.',
    controls: [],
  },
  hc32: {
    title: '74HC32 quad OR',
    blurb: 'Four 2-input OR gates, DIP-14 (Y = 3,4,10,11). Floating inputs read LOW; wire VCC/GND for the honest version.',
    controls: [],
  },
  hc86: {
    title: '74HC86 quad XOR',
    blurb: 'Four 2-input XOR gates, DIP-14 (Y = 3,4,10,11). Floating inputs read LOW; wire VCC/GND for the honest version.',
    controls: [],
  },

  // ── Power / bench ──
  'power-supply': {
    title: 'Power supply',
    blurb: 'Drives the 5 V / 3.3 V / GND rails every part shares.',
    controls: [
      { kind: 'toggle', key: 'on', label: 'Output ON', def: true },
      { kind: 'slider', key: 'volts', label: 'Rail', min: 3.3, max: 12, step: 0.1, unit: 'V', def: 5, decimals: 1 },
    ],
  },
  breadboard: {
    title: 'Breadboard',
    blurb: 'Tie strips: 5-hole terminals, split centre, full-length rails.',
    controls: [],
  },
  ttp223: {
    title: 'TTP223 touch key',
    blurb: 'Capacitive touch: OUT goes HIGH while a finger is on the pad. Red LED follows.',
    controls: [pressBtn('Touch pad', 'OUT goes HIGH while touched')],
  },
  sw420: {
    title: 'SW-420 vibration',
    blurb: 'Roller-ball switch + LM393: DO pulses HIGH on knock or shake. Trimpot sets threshold.',
    controls: [pressBtn('Knock it', 'DO pulses HIGH on shock')],
  },
  'rain-plate': {
    title: 'Rain plate',
    blurb: 'Bare nickel comb: rain shorts the fingers and the output falls. Wetness slider wets it.',
    controls: [{ kind: 'slider', key: 'wetness', label: 'Wetness', min: 0, max: 100, step: 1, unit: '%', def: 20 }],
  },
  'soil-resistive': {
    title: 'YL-69 soil probe',
    blurb: 'Resistive fork + comparator: AO sits high when dry, falls as the soil wets. Probe corrodes — capacitive lasts longer.',
    controls: [{ kind: 'slider', key: 'moisture', label: 'Soil moisture', min: 0, max: 100, step: 1, unit: '%', def: 40 }],
  },
  'water-level': {
    title: 'Water level strip',
    blurb: 'Exposed parallel traces: more submerged = higher AO. Keep it clean — it corrodes too.',
    controls: [{ kind: 'slider', key: 'level', label: 'Water level', min: 0, max: 100, step: 1, unit: '%', def: 30 }],
  },
  'max7219-matrix': {
    title: 'MAX7219 8×8 matrix',
    blurb: 'One MAX7219 drives 64 red LEDs over SPI. Rows use # or 1 for lit, . for dark.',
    controls: [
      { kind: 'text', key: 'lines', label: 'Bitmap (8 rows of 8)', def: '..####..\n.#....#.\n#......#\n#......#\n#......#\n.#....#.\n..####..\n........', rows: 8 },
      { kind: 'slider', key: 'brightness', label: 'Brightness', min: 0, max: 15, step: 1, unit: '', def: 8 },
    ],
  },
  tm1637: {
    title: 'TM1637 4-digit',
    blurb: 'Two-wire clock display: 0–9 A–F plus -. Include : for the centre colon.',
    controls: [
      { kind: 'text', key: 'lines', label: 'Digits', def: '12:34', rows: 1 },
      { kind: 'slider', key: 'brightness', label: 'Brightness', min: 0, max: 15, step: 1, unit: '', def: 8 },
    ],
  },
  'nokia-5110': {
    title: 'Nokia 5110 LCD',
    blurb: 'PCD8544 84×48 over SPI. Blue-white backlight, 3.3 V logic.',
    controls: [{ kind: 'text', key: 'lines', label: 'Rows', def: 'Nokia 5110\nPCD8544\n84x48 OK', rows: 3 }],
  },
  'stepper-28byj': {
    title: '28BYJ-48 stepper',
    blurb: '5 V unipolar + ULN2003: 2048 half-steps per rev through the 1:64 gearbox. Shaft angle accumulates.',
    controls: [{ kind: 'slider', key: 'angle', label: 'Shaft angle', min: 0, max: 360, step: 1, unit: '°', def: 0 }],
  },
  'stepper-nema17': {
    title: 'NEMA 17 stepper',
    blurb: '200 full steps per rev, 4-wire bipolar — needs a real driver (A4988/DRV8825), never logic pins.',
    controls: [{ kind: 'slider', key: 'angle', label: 'Shaft angle', min: 0, max: 360, step: 1, unit: '°', def: 0 }],
  },
  mg996r: {
    title: 'MG996R servo',
    blurb: 'Metal-gear 10 kg·cm: same 0–180° PWM as the SG90 but budget a 2.5 A stall on its own 5–6 V rail.',
    controls: [{ kind: 'slider', key: 'angle', label: 'Horn angle', min: 0, max: 180, step: 1, unit: '°', def: 90 }],
  },
  generic: {
    title: 'Module',
    blurb: 'Generic breakout — footprint from the 30×20 mm module class.',
    controls: [],
  },
};

/** Resolve controls for a fine key with family fallbacks. */
export function defForKey(key: string): PartControlDef {
  const direct = PART_CONTROLS[key];
  if (direct) return direct;
  if (key === 'lcd1602') return PART_CONTROLS['lcd1602'];
  if (key === 'lcd2004') return PART_CONTROLS['lcd2004'];
  if (key.startsWith('epaper')) return PART_CONTROLS['ili9341'];
  if (key.startsWith('cap-soil')) return PART_CONTROLS['cap-soil'];
  return PART_CONTROLS.generic;
}
