/**
 * dimensions.ts — TRUE-SCALE physical dimensions for every part Wireup can draw.
 *
 * Units are METRES (three.js world units). Every entry is a nominal,
 * datasheet-sourced outline so part-to-part RATIOS are honest:
 *
 *   Arduino Uno R3            68.6 × 53.4 mm   (arduino.cc ABX00066)
 *   0.96" SSD1306 I2C module  27.0 × 27.0 mm   (generic 4-pin breakout)
 *   6 mm tactile button         6.0 ×  6.0 mm   (Omron B3F series)
 *   5 mm indicator LED          5.0 mm dia      (Kingbright L-53x)
 *   1/4 W axial resistor        6.3 ×  2.3 mm body (IEC 60115)
 *   SG90 micro servo           23.0 × 12.2 mm   (TowerPro SG90)
 *   HC-SR04 ultrasonic         45.0 × 20.0 mm   (generic breakout)
 *   Full breadboard           165.0 × 55.0 mm   (MB-102 style)
 *
 * So an Uno renders ~2.5× wider than an OLED — never 10× — and a 6 mm
 * button is genuinely tiny next to a 45 mm Nano. Boards stand on 2.54 mm
 * header height; modules sit on their PCB edge.
 *
 * `w` = X extent, `h` = Y extent (up), `d` = Z extent. `lift` is how far the
 * body origin floats above the bench (standoffs / header height).
 *
 * Parts not listed explicitly fall back to family defaults keyed by prefix
 * (resistor-*, cap-*, diode-*, …) so ALL 156 velxio metadata ids resolve to
 * a plausible true-scale box. Unknown keys degrade to `generic`.
 *
 * Backend mirror: backend/src/data/spatialDims.ts carries the same numbers
 * for the planner so emitted spatial.dimensions already match this table.
 */

/** Bounding box in metres (w/h/d). */
export interface BoxDimensions {
  w: number;
  h: number;
  d: number;
}

export interface DimEntry extends BoxDimensions {
  /** Rest height of the body origin above the bench, metres. */
  lift: number;
  /** Mass in grams (0 = unknown, omitted from UI). */
  mass: number;
  /** Short provenance note shown in the inspector. */
  source: string;
}

const mm = (w: number, h: number, d: number, lift = 0, mass = 0, source = ''): DimEntry => ({
  w: w / 1000,
  h: h / 1000,
  d: d / 1000,
  lift: lift / 1000,
  mass,
  source,
});

/**
 * Nominal outlines. Values are the dominant retail breakout / package for
 * each id — the thing a user actually holds — not the bare silicon.
 */
export const TRUE_DIMS: Record<string, DimEntry> = {
  // ── Boards ──────────────────────────────────────────────────────────────
  'arduino-uno': mm(68.6, 14, 53.4, 2, 25, 'Arduino Uno R3 outline 68.6×53.4 mm'),
  'arduino-nano': mm(45, 8, 18, 2.5, 7, 'Arduino Nano Classic 45×18 mm'),
  'nano-rp2040-connect': mm(45, 8, 18, 2.5, 7, 'Nano form-factor 45×18 mm'),
  'arduino-mega': mm(101.6, 15, 53.4, 2, 37, 'Arduino Mega 2560 101.6×53.4 mm'),
  'esp32-devkit-v1': mm(52, 13, 28, 2.5, 10, 'ESP32 DevKitC V1 30-pin 52×28 mm'),
  esp8266: mm(58, 13, 31, 12, 'NodeMCU ESP8266 58×31 mm'),
  'esp32-s3': mm(48, 12, 25.5, 2.5, 9, 'ESP32-S3 DevKitC-1 48×25.5 mm'),
  'esp32-c3': mm(52, 13, 28, 2.5, 9, 'ESP32-C3 DevKit 52×28 mm class'),
  'esp32c3-supermini': mm(22.5, 8, 18, 2.5, 3, 'ESP32-C3 SuperMini 22.5×18 mm'),
  'esp32-cam': mm(40.5, 8, 27, 2.5, 8, 'ESP32-CAM 40.5×27 mm'),
  'xiao-esp32-c3': mm(21, 7, 17.5, 1.5, 2.5, 'Seeed XIAO 21×17.5 mm'),
  'xiao-esp32-s3': mm(21, 7, 17.5, 1.5, 2.5, 'Seeed XIAO 21×17.5 mm'),
  'pi-pico': mm(51, 11, 21, 2.5, 6, 'Raspberry Pi Pico 51×21 mm'),
  'pi-pico-w': mm(51, 11, 21, 2.5, 6, 'Raspberry Pi Pico W 51×21 mm'),
  'stm32-bluepill': mm(53, 9, 22.3, 2.5, 8, 'Blue Pill 53×22 mm class'),
  'stm32-blackpill': mm(53, 9, 24, 2.5, 8, 'Black Pill 53×24 mm class'),
  'franzininho': mm(52, 10, 28, 2.5, 9, 'Franzininho DIY board, DevKit class'),
  'attiny85': mm(9.3, 3.6, 6.4, 0.5, 1, 'ATtiny85 DIP-8 9.3×6.4 mm'),

  // ── Displays ────────────────────────────────────────────────────────────
  ssd1306: mm(27, 5, 27, 1, 4, '0.96" SSD1306 4-pin module 27×27 mm'),
  'ssd1306-i2c-4pin': mm(27, 5, 27, 1, 4, '0.96" SSD1306 4-pin module 27×27 mm'),
  'lcd1602': mm(80, 12, 36, 2, 30, 'LCD1602 80×36 mm'),
  'lcd1602-i2c': mm(80, 14, 36, 2, 32, 'LCD1602 + PCF8574 backpack'),
  'lcd2004': mm(98, 14, 60, 2, 55, 'LCD2004 98×60 mm'),
  'lcd2004-i2c': mm(98, 16, 60, 2, 58, 'LCD2004 + PCF8574 backpack'),
  'lcd2002': mm(80, 12, 36, 2, 30, 'LCD 20×2 class'),
  ili9341: mm(50, 9, 69, 2, 25, '2.8" ILI9341 TFT 50×69 mm'),
  'ili9341-cap-touch': mm(50, 10, 69, 2, 27, '2.8" ILI9341 + touch'),
  '7segment': mm(19, 8, 12.7, 1, 3, '0.56" single digit 19×12.7 mm'),
  'neopixel-matrix': mm(60, 4, 60, 1, 20, '8×8 WS2812B panel 60×60 mm'),
  'led-ring': mm(44, 3, 44, 1, 8, '16-LED NeoPixel ring Ø44 mm'),
  'led-bar-graph': mm(25.4, 8, 10.2, 1, 3, '10-seg bar 25.4×10.2 mm'),
  'epaper-1in54-bw': mm(48, 2, 33, 1, 8, '1.54" ePaper 48×33 mm'),
  'epaper-2in13-bw': mm(59, 2, 30, 1, 10, '2.13" ePaper panel class'),
  'epaper-2in13-bwr': mm(59, 2, 30, 1, 10, '2.13" ePaper panel class'),
  'epaper-2in9-bw': mm(89, 2, 38, 1, 16, '2.9" ePaper panel class'),
  'epaper-2in9-bwr': mm(89, 2, 38, 1, 16, '2.9" ePaper panel class'),
  'epaper-4in2-bw': mm(103, 2, 78, 1, 40, '4.2" ePaper panel class'),
  'epaper-5in65-7c': mm(112, 2, 86, 1, 55, '5.65" ACeP panel class'),
  'epaper-7in5-bw': mm(170, 2, 111, 1, 90, '7.5" ePaper panel class'),

  // ── Sensors: environment / motion ───────────────────────────────────────
  dht22: mm(27, 9, 15, 1, 5, 'AM2302/DHT22 module 27×15 mm'),
  dht11: mm(19, 8, 15, 1, 4, 'DHT11 module 19×15 mm'),
  bmp280: mm(15, 3, 12, 1, 2, 'BMP280 breakout 15×12 mm'),
  bme280: mm(15, 3, 12, 1, 2, 'BME280 breakout 15×12 mm'),
  ds18b20: mm(30, 6, 6, 1, 10, 'DS18B20 waterproof probe head Ø6×30 mm'),
  'cap-soil': mm(98, 7, 23, 1, 12, 'Capacitive soil sensor v1.2 98×23 mm'),
  'gas-sensor': mm(32, 22, 20, 1, 12, 'MQ-series module 32×20 mm, can tall'),
  'mq-2': mm(32, 22, 20, 1, 12, 'MQ-2 module, heater can tall'),
  'hc-sr04': mm(45, 15, 20, 2, 9, 'HC-SR04 45×20 mm'),
  'pir-motion-sensor': mm(32, 24, 24, 1, 6, 'HC-SR501 32×24 mm, dome tall'),
  mpu6050: mm(21, 3, 16, 1, 2, 'GY-521 MPU6050 21×16 mm'),
  'ntc-temperature-sensor': mm(30, 8, 14, 1, 4, 'NTC module w/ trimmer 30×14 mm'),
  'photoresistor-sensor': mm(32, 9, 14, 1, 4, 'LDR LM393 module 32×14 mm'),
  photodiode: mm(7.5, 3, 5.4, 0.5, 1, 'BPW34 PIN photodiode 7.5×5.4 mm'),
  'flame-sensor': mm(32, 8, 14, 1, 4, 'IR flame module 32×14 mm'),
  'big-sound-sensor': mm(40, 13, 15, 1, 6, 'FC-04 sound module 40×15 mm'),
  'small-sound-sensor': mm(36, 12, 16, 1, 5, 'KY-038 sound module 36×16 mm'),
  'heart-beat-sensor': mm(16, 3, 16, 1, 2, 'PulseSensor amped Ø16 mm'),
  'tilt-switch': mm(28, 8, 15, 1, 4, 'SW-520D tilt module 28×15 mm'),
  'analog-joystick': mm(34, 32, 26, 1, 12, 'PS2 joystick module, stick tall'),
  'ky-040': mm(32, 27, 19, 1, 10, 'KY-040 encoder + knob'),
  'gps-neo6m': mm(45, 10, 25, 1, 16, 'GY-GPS6MV2 45×25 mm'),
  hx711: mm(38, 5, 21, 1, 8, 'HX711 load-cell amp 38×21 mm'),
  ds1307: mm(38, 14, 22, 1, 10, 'ZS-042 RTC, battery holder tall'),
  ds3231: mm(38, 14, 22, 1, 10, 'ZS-042 RTC, battery holder tall'),
  'ir-receiver': mm(8, 9, 7, 0.5, 1, 'VS1838B receiver 8×7 mm'),
  'ir-remote': mm(86, 7, 40, 0, 30, 'NEC handset 86×40 mm'),
  'rotary-dialer': mm(32, 27, 19, 1, 10, 'Rotary encoder class'),

  // ── Actuators / output ──────────────────────────────────────────────────
  servo: mm(23, 29, 12.2, 0, 9, 'TowerPro SG90 23×12.2×29 mm'),
  'micro-servo': mm(23, 29, 12.2, 0, 9, 'TowerPro SG90 class'),
  'stepper-motor': mm(42, 40, 42, 0, 280, 'NEMA-17 42×42 mm'),
  'biaxial-stepper': mm(45, 35, 25, 0, 60, 'Pan-tilt servo pair class'),
  a4988: mm(20, 10, 15, 2, 3, 'StepStick A4988 20×15 mm'),
  'motor-driver-l293d': mm(60, 18, 25, 1, 15, 'L293D mini module 60×25 mm'),
  relay: mm(50, 19, 26, 1, 25, '1-ch Songle relay module 50×26 mm'),
  'ks2e-m-dc5': mm(58, 19, 50, 1, 40, '2-ch relay module 58×50 mm'),
  buzzer: mm(12, 9.5, 12, 0.5, 3, 'Active buzzer Ø12×9.5 mm'),
  led: mm(5, 8.6, 5, 3, 0.3, '5 mm round LED Ø5 mm'),
  'rgb-led': mm(5, 8.6, 5, 3, 0.3, '5 mm RGB LED, common cathode'),
  neopixel: mm(5, 1.6, 5, 0.5, 0.2, 'WS2812B 5050 5×5 mm'),
  'microsd-card': mm(30, 10, 20, 1, 5, 'SPI microSD module 30×20 mm'),

  // ── Input ───────────────────────────────────────────────────────────────
  pushbutton: mm(12, 7.5, 12, 0.5, 2, '12 mm tactile button 12×12 mm'),
  'pushbutton-6mm': mm(6, 4.3, 6, 0.5, 0.5, 'Omron B3F 6×6 mm tactile'),
  'slide-switch': mm(11.5, 5, 5.5, 0.5, 1, 'SS-12D00 slide switch'),
  'slide-potentiometer': mm(60, 12, 12, 1, 8, '60 mm travel slide pot'),
  potentiometer: mm(16, 25, 16, 1, 12, 'WH148 pot + knob, knob tall'),
  'dip-switch-8': mm(23, 5, 9.5, 0.5, 2, '8-pos DIP 22.9×9.4 mm'),
  'membrane-keypad': mm(70, 1.2, 77, 0.3, 8, '4×4 membrane keypad 70×77 mm'),

  // ── Passives (family nominals; value-specific overrides below) ──────────
  resistor: mm(12, 2.5, 2.5, 1.2, 0.3, '1/4 W axial, 6.3 mm body + leads'),
  capacitor: mm(5, 5, 3, 1, 0.3, 'Ceramic disc Ø5 mm'),
  'capacitor-electrolytic': mm(5, 11, 5, 0.5, 1, 'E-cap 5 mm can'),
  inductor: mm(6, 5, 6, 0.5, 1, 'Radial drum inductor Ø6 mm'),
  diode: mm(5.2, 2.7, 2.7, 1.2, 0.3, 'DO-41 axial 5.2 mm body'),
  transistor: mm(4.8, 4.8, 3.7, 1.5, 0.4, 'TO-92 4.8×3.7 mm'),
  'transistor-power': mm(10, 16, 4.5, 1, 2, 'TO-220 10×4.5 mm'),
  regulator: mm(10, 16, 4.5, 1, 2, 'TO-220 regulator 10×4.5 mm'),
  'logic-ic': mm(19, 3.6, 6.4, 0.5, 2, 'DIP-14 19×6.4 mm'),
  'logic-ic-wide': mm(19.3, 5, 7.6, 0.5, 2.5, 'DIP-16 19.3×7.6 mm'),
  'dip-8': mm(9.3, 3.6, 6.4, 0.5, 1.5, 'DIP-8 9.3×6.4 mm'),
  crystal: mm(11, 4, 4.6, 0.5, 1, 'HC-49S crystal 11×4.6 mm'),

  // ── Power ───────────────────────────────────────────────────────────────
  'battery-9v': mm(48.5, 17.5, 26.5, 0, 45, '9 V block 48.5×26.5 mm'),
  'battery-aa': mm(50.5, 14.5, 14.5, 0, 23, 'AA cell Ø14.5×50.5 mm'),
  'battery-coin-cell': mm(20, 3.2, 20, 0.5, 3, 'CR2032 Ø20×3.2 mm'),
  'power-supply': mm(53, 22, 32, 1, 25, 'MB-102 breadboard PSU class'),
  'signal-generator': mm(70, 15, 50, 1, 40, 'DDS module class'),

  // ── Bench ───────────────────────────────────────────────────────────────
  breadboard: mm(165, 9, 55, 0, 80, 'Full breadboard 165×55 mm'),
  'breadboard-mini': mm(55, 9, 35, 0, 20, 'Mini breadboard 55×35 mm'),
  // ── Boards: popular footprints ─────────────────────────────────────────
  'wemos-d1-mini': mm(34.2, 8, 25.6, 2.5, 10, 'Wemos D1 mini 34.2×25.6 mm'),
  'wemos-d1-r32': mm(68.6, 14, 53.4, 2, 25, 'Wemos D1 R32 Uno footprint'),
  'arduino-leonardo': mm(68.6, 14, 53.4, 2, 25, 'Arduino Leonardo 68.6×53.4 mm'),
  'pro-micro': mm(33, 7, 18, 2.5, 3, 'Pro Micro 33×18 mm'),
  'rpi-4b': mm(85, 17, 56, 3, 46, 'Raspberry Pi 4B 85×56 mm'),
  'pi-zero': mm(65, 8, 30, 2, 9, 'Pi Zero 65×30 mm'),
  microbit: mm(52, 8, 42, 1, 9, 'micro:bit 52×42 mm'),
  // ── Wireless / RFID ────────────────────────────────────────────────────
  rc522: mm(60, 4, 36, 1, 8, 'RC522 60×36 mm'),
  nrf24l01: mm(29, 4, 15.5, 2, 2, 'nRF24L01+ 29×15.5 mm'),
  'hc-05': mm(37, 5, 16, 2, 4, 'HC-05 37×16 mm'),
  // ── Interface / power modules ──────────────────────────────────────────
  pca9685: mm(62, 10, 26, 2.5, 15, 'PCA9685 62×26 mm'),
  ads1115: mm(25.4, 4, 17.8, 2.5, 3, 'ADS1115 25.4×17.8 mm'),
  tp4056: mm(25, 5, 19, 1, 3, 'TP4056 charger 25×19 mm'),
  'buck-module': mm(43, 14, 21, 1.5, 11, 'LM2596 buck 43×21 mm'),
  'hlk-pm01': mm(34, 15, 20, 1, 20, 'HLK-PM01 34×20 mm'),
  dfplayer: mm(21, 7, 21, 1.5, 3, 'DFPlayer Mini 21×21 mm'),
  // ── Motors / motion ────────────────────────────────────────────────────
  mg996r: mm(40.7, 42.9, 19.7, 0, 55, 'MG996R 40.7×19.7×42.9 mm'),
  'stepper-28byj': mm(28, 30, 28, 0, 34, '28BYJ-48 Ø28 mm'),
  'stepper-nema17': mm(42, 40, 42, 0, 280, 'NEMA 17 42×42×40 mm'),
  'tt-motor': mm(70, 18, 23, 0, 30, 'TT gear motor nominal'),
  'vibration-motor': mm(10, 4, 10, 0, 2, 'Coin motor Ø10 mm'),
  'fan-30mm': mm(30, 7, 30, 0, 8, '3010 fan 30×30×7 mm'),
  'speaker-40mm': mm(40, 8, 40, 0, 15, 'Speaker Ø40 mm'),
  peltier: mm(40, 4, 40, 0, 22, 'TEC1-12706 40×40 mm'),
  l298n: mm(43, 27, 43, 2, 30, 'L298N module 43×43 mm'),
  // ── Sensor breakouts ───────────────────────────────────────────────────
  ttp223: mm(24, 4, 24, 1, 2, 'TTP223 24×24 mm'),
  sw420: mm(32, 6, 14, 1, 4, 'SW-420 32×14 mm'),
  'rain-plate': mm(50, 2, 40, 0, 8, 'Rain plate 50×40 mm'),
  'soil-resistive': mm(60, 2, 20, 0, 6, 'YL-69 probe 60×20 mm'),
  'water-level': mm(65, 2, 20, 0, 5, 'Water level 65×20 mm'),
  // ── Display modules ────────────────────────────────────────────────────
  'max7219-matrix': mm(50, 12, 32, 2, 20, 'MAX7219 8×8 50×32 mm'),
  tm1637: mm(42, 10, 24, 2, 10, 'TM1637 42×24 mm'),
  'nokia-5110': mm(45, 12, 45, 2, 12, 'Nokia 5110 45×45 mm'),

  generic: mm(30, 8, 20, 1, 5, 'Generic module fallback'),
  'custom-chip': mm(19, 3.6, 6.4, 0.5, 2, 'Custom chip, DIP class'),
};

/** Electrolytic can sizes grow with capacitance — the honest touch. */
const ECAP_BY_VALUE: Record<string, [d: number, h: number]> = {
  '1u': [5, 11],
  '10u': [5, 11],
  '47u': [6.3, 11],
  '100u': [6.3, 11],
  '470u': [8, 12],
  '1000u': [10, 20],
};

/** Ceramic disc sizes grow slightly with capacitance. */
const CER_BY_VALUE: Record<string, number> = {
  '10p': 3,
  '22p': 3,
  '100p': 4,
  '1n': 4,
  '10n': 5,
  '100n': 5,
  '1u': 6,
  '10u': 8,
};

/**
 * Resolve dimensions for any part key. Handles value-suffixed ids
 * (`resistor-10k`, `cap-100n`, `cap-elec-470u`, `led-green`, …) and every
 * id in the velxio metadata registry via family-prefix rules.
 */
export function dimForKey(rawKey: string): DimEntry {
  const key = rawKey.trim().toLowerCase();
  const direct = TRUE_DIMS[key];
  if (direct) return direct;

  // Value-suffixed passives keep the family outline, cans grow honestly.
  if (key.startsWith('resistor')) return TRUE_DIMS.resistor;
  if (key.startsWith('cap-elec-')) {
    const suffix = key.slice('cap-elec-'.length);
    const size = ECAP_BY_VALUE[suffix];
    if (size) return mm(size[0], size[1], size[0], 0.5, 1, `E-cap ${suffix}, Ø${size[0]}×${size[1]} mm`);
    return TRUE_DIMS['capacitor-electrolytic'];
  }
  if (key.startsWith('cap-') || key === 'capacitor') {
    const suffix = key.startsWith('cap-') ? key.slice(4) : '';
    const dia = CER_BY_VALUE[suffix];
    if (dia) return mm(dia, dia, 2.5, 1, 0.3, `Ceramic ${suffix} Ø${dia} mm`);
    return TRUE_DIMS.capacitor;
  }
  if (key.startsWith('ind-') || key === 'inductor') return TRUE_DIMS.inductor;
  if (key.startsWith('diode') || key.startsWith('zener') || key === 'diode') return TRUE_DIMS.diode;
  if (key.startsWith('bjt-') || key.startsWith('mosfet-2n7000') || key === 'opto-4n25' || key === 'opto-pc817') {
    return TRUE_DIMS.transistor;
  }
  if (key.startsWith('mosfet-irf') || key.startsWith('mosfet-fqp') || key.startsWith('bjt-2n3055')) {
    return TRUE_DIMS['transistor-power'];
  }
  if (key.startsWith('reg-') || key === 'reg-lm317') return TRUE_DIMS.regulator;
  if (key.startsWith('opamp-')) {
    return key === 'opamp-lm324' ? TRUE_DIMS['logic-ic-wide'] : TRUE_DIMS['logic-ic'];
  }
  if (key === 'ne555') return TRUE_DIMS['dip-8'];
  if (key === 'cd4017' || key === 'hc595' || key === 'hc165') return TRUE_DIMS['logic-ic-wide'];
  if (/^hc(00|02|04|08|14|32|86)$/.test(key) || key === 'cd4011') return TRUE_DIMS['logic-ic'];
  if (key.startsWith('ic-74hc') || key.startsWith('logic-gate-') || key.startsWith('flip-flop-')) {
    // 3/4-input and wide packages sit in the DIP-16 outline.
    return /-3$|-4$|74hc00|74hc02|74hc04|74hc08|74hc14|74hc32|74hc86/.test(key) &&
      !key.startsWith('logic-gate-and-3') &&
      !key.startsWith('logic-gate-and-4')
      ? TRUE_DIMS['logic-ic']
      : TRUE_DIMS['logic-ic'];
  }
  if (key.startsWith('led') || key === 'led-bar-graph') return TRUE_DIMS.led;
  if (key.startsWith('battery')) return TRUE_DIMS['battery-aa'];
  if (key.startsWith('epaper')) return TRUE_DIMS['epaper-2in9-bw'];
  if (key.startsWith('esp32')) return TRUE_DIMS['esp32-devkit-v1'];
  if (key.startsWith('xiao')) return TRUE_DIMS['xiao-esp32-c3'];
  if (key.startsWith('stm32')) return TRUE_DIMS['stm32-bluepill'];
  if (key.startsWith('arduino')) return TRUE_DIMS['arduino-uno'];
  if (key.startsWith('pi-pico') || key.startsWith('pico')) return TRUE_DIMS['pi-pico'];
  if (key.includes('servo') || key.includes('stepper') || key.includes('motor')) return TRUE_DIMS.servo;
  if (key.includes('keypad') || key.includes('keyboard')) return TRUE_DIMS['membrane-keypad'];
  if (key.includes('joystick')) return TRUE_DIMS['analog-joystick'];

  return TRUE_DIMS.generic;
}

/** Human-readable footprint label, e.g. `68.6 × 53.4 × 14 mm · 25 g`. */
export function footprintLabel(key: string): string {
  const d = dimForKey(key);
  const w = (d.w * 1000).toFixed(d.w * 1000 < 10 ? 1 : 0);
  const h = (d.h * 1000).toFixed(d.h * 1000 < 10 ? 1 : 0);
  const dep = (d.d * 1000).toFixed(d.d * 1000 < 10 ? 1 : 0);
  const mass = d.mass > 0 ? ` · ${d.mass} g` : '';
  return `${w} × ${dep} × ${h} mm${mass}`;
}
