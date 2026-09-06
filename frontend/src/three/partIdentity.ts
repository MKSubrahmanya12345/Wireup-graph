/**
 * partIdentity.ts — ONE canonical mapping from "whatever the graph calls it"
 * to the 3D / sim / controls key.
 *
 * The planner writes free-form names ("ESP32 DevKit", "SSD1306 OLED",
 * "SG90"), the bench writes diagram types ("board-esp32-devkit-v1",
 * "wokwi-ssd1306"), preview detection writes catalog ids ("esp32",
 * "ssd1306"). All three must land on the same key or the 3D view, the
 * dimensions, the controls panel and the sim wiring disagree. This module
 * is that landing point.
 *
 * Returns both the fine key (for dims + mesh) and the family (for the
 * dispatcher + fallback controls).
 */

export type PartFamily =
  | 'board'
  | 'display'
  | 'sensor'
  | 'actuator'
  | 'input'
  | 'passive'
  | 'power'
  | 'logic'
  | 'bench'
  | 'generic';

export interface PartIdentity {
  /** Fine key into TRUE_DIMS / sensor defs / mesh switch, e.g. `arduino-uno`. */
  key: string;
  family: PartFamily;
  /** Short human label for badges and 3D tags. */
  label: string;
}

interface Rule {
  match: RegExp;
  key: string;
  family: PartFamily;
  label: string;
}

/** Ordered: first match wins. Keep specific rules above generic ones. */
const RULES: Rule[] = [
  // Boards
  { match: /mega/, key: 'arduino-mega', family: 'board', label: 'Arduino Mega' },
  { match: /nano.*esp32|esp32.*nano/, key: 'arduino-nano', family: 'board', label: 'Arduino Nano ESP32' },
  { match: /nano|rp2040-connect/, key: 'arduino-nano', family: 'board', label: 'Arduino Nano' },
  { match: /uno/, key: 'arduino-uno', family: 'board', label: 'Arduino Uno' },
  { match: /esp32-s3/, key: 'esp32-s3', family: 'board', label: 'ESP32-S3 DevKit' },
  { match: /esp32-c3|supermini|c3-mini/, key: 'esp32c3-supermini', family: 'board', label: 'ESP32-C3 SuperMini' },
  { match: /esp32-cam|cam\b/, key: 'esp32-cam', family: 'board', label: 'ESP32-CAM' },
  { match: /xiao/, key: 'xiao-esp32-c3', family: 'board', label: 'XIAO ESP32' },
  { match: /d1.?r32/, key: 'wemos-d1-r32', family: 'board', label: 'Wemos D1 R32' },
  { match: /wemos|d1.?mini/, key: 'wemos-d1-mini', family: 'board', label: 'Wemos D1 mini' },
  { match: /leonardo/, key: 'arduino-leonardo', family: 'board', label: 'Arduino Leonardo' },
  { match: /pro.?micro|promicro/, key: 'pro-micro', family: 'board', label: 'Pro Micro' },
  { match: /raspberry.?pi.?4|rpi.?4|\bpi.?4b\b/, key: 'rpi-4b', family: 'board', label: 'Raspberry Pi 4B' },
  { match: /pi.?zero|raspberry.?pi.?zero/, key: 'pi-zero', family: 'board', label: 'Pi Zero / 2W' },
  { match: /micro.?bit|bbc.?micro/, key: 'microbit', family: 'board', label: 'micro:bit' },
  { match: /esp32|devkit|wroom|nodemcu|esp8266/, key: 'esp32-devkit-v1', family: 'board', label: 'ESP32 DevKit' },
  { match: /pico/, key: 'pi-pico-w', family: 'board', label: 'Pi Pico W' },
  { match: /blackpill|f401|f411/, key: 'stm32-blackpill', family: 'board', label: 'Black Pill' },
  { match: /bluepill|blue.?pill|stm32|f103/, key: 'stm32-bluepill', family: 'board', label: 'Blue Pill' },
  { match: /attiny/, key: 'attiny85', family: 'board', label: 'ATtiny85' },
  { match: /franzininho/, key: 'franzininho', family: 'board', label: 'Franzininho' },

  // Displays
  { match: /ssd1306|oled|0\.96/, key: 'ssd1306', family: 'display', label: 'SSD1306 OLED' },
  { match: /lcd2004|20x4|20×4/, key: 'lcd2004-i2c', family: 'display', label: 'LCD 20×4' },
  { match: /lcd1602|lcd.*16x2|lcd.*16×2|16x2.*lcd|character.*lcd/, key: 'lcd1602-i2c', family: 'display', label: 'LCD 16×2' },
  { match: /ili9341|tft.*2\.8|2\.8.*tft|tft display/, key: 'ili9341', family: 'display', label: 'ILI9341 TFT' },
  { match: /tm1637/, key: 'tm1637', family: 'display', label: 'TM1637 4-digit' },
  { match: /7.?seg|seven.?seg/, key: '7segment', family: 'display', label: '7-segment' },
  { match: /max7219|dot.?matrix|led.?matrix/, key: 'max7219-matrix', family: 'display', label: 'MAX7219 8×8' },
  { match: /nokia.?5110|5110.?lcd|pcd8544/, key: 'nokia-5110', family: 'display', label: 'Nokia 5110 LCD' },
  { match: /neopixel.*matrix|matrix.*neopixel|8x8.*matrix/, key: 'neopixel-matrix', family: 'display', label: 'NeoPixel matrix' },
  { match: /led.?ring|ring.*led|ws2812.*ring/, key: 'led-ring', family: 'display', label: 'NeoPixel ring' },
  { match: /bar.?graph/, key: 'led-bar-graph', family: 'display', label: 'LED bar graph' },
  { match: /epaper|e-paper|eink|e-ink/, key: 'epaper-2in9-bw', family: 'display', label: 'ePaper' },
  { match: /neopixel|ws2812/, key: 'neopixel', family: 'display', label: 'NeoPixel' },

  // Sensors
  { match: /dht22|am2302/, key: 'dht22', family: 'sensor', label: 'DHT22' },
  { match: /dht11/, key: 'dht11', family: 'sensor', label: 'DHT11' },
  { match: /bme280/, key: 'bme280', family: 'sensor', label: 'BME280' },
  { match: /bmp280/, key: 'bmp280', family: 'sensor', label: 'BMP280' },
  { match: /ds18b20|dallas/, key: 'ds18b20', family: 'sensor', label: 'DS18B20' },
  { match: /yl-?69|resistive.?soil|soil.?resistive/, key: 'soil-resistive', family: 'sensor', label: 'Soil probe YL-69' },
  { match: /soil|moisture/, key: 'cap-soil', family: 'sensor', label: 'Soil sensor' },
  { match: /rain.?sensor|rain.?detector|yl-?83|rain.?plate/, key: 'rain-plate', family: 'sensor', label: 'Rain plate' },
  { match: /water.?level|water.?sensor/, key: 'water-level', family: 'sensor', label: 'Water level' },
  { match: /ttp223|touch.?sensor|touch.?button|touch.?key/, key: 'ttp223', family: 'sensor', label: 'TTP223 touch' },
  { match: /sw-?420|vibration.?switch|vibration.?sensor|knock.?sensor/, key: 'sw420', family: 'sensor', label: 'SW-420 vibration' },
  { match: /rc522|mfrc522|rfid/, key: 'rc522', family: 'sensor', label: 'RC522 RFID' },
  { match: /nrf24|nrf24l01/, key: 'nrf24l01', family: 'sensor', label: 'nRF24L01+' },
  { match: /hc-?05|hc-?06|bluetooth.?(module|serial|uart)|bt.?module/, key: 'hc-05', family: 'sensor', label: 'HC-05 Bluetooth' },
  { match: /pca9685|16.?channel.?pwm|pwm.?servo.?driver/, key: 'pca9685', family: 'sensor', label: 'PCA9685 PWM' },
  { match: /ads1115|16.?bit.?adc/, key: 'ads1115', family: 'sensor', label: 'ADS1115 ADC' },
  { match: /mq-?2|gas sensor|gas-sensor|\bmq\b/, key: 'gas-sensor', family: 'sensor', label: 'MQ gas sensor' },
  { match: /hc-sr04|hcsr04|ultrasonic|distance/, key: 'hc-sr04', family: 'sensor', label: 'HC-SR04' },
  { match: /\bpir\b|sr501|motion/, key: 'pir-motion-sensor', family: 'sensor', label: 'PIR motion' },
  { match: /mpu6050|mpu-6050|imu|gyro|accelerometer/, key: 'mpu6050', family: 'sensor', label: 'MPU6050' },
  { match: /ntc|thermistor/, key: 'ntc-temperature-sensor', family: 'sensor', label: 'NTC sensor' },
  { match: /photoresistor|\bldr\b|light.*sensor|photocell/, key: 'photoresistor-sensor', family: 'sensor', label: 'LDR sensor' },
  { match: /photodiode/, key: 'photodiode', family: 'sensor', label: 'Photodiode' },
  { match: /flame/, key: 'flame-sensor', family: 'sensor', label: 'Flame sensor' },
  { match: /sound|mic.*sensor|ky-038|fc-04|microphone/, key: 'big-sound-sensor', family: 'sensor', label: 'Sound sensor' },
  { match: /pulse|heart.?beat/, key: 'heart-beat-sensor', family: 'sensor', label: 'Pulse sensor' },
  { match: /tilt/, key: 'tilt-switch', family: 'sensor', label: 'Tilt switch' },
  { match: /joystick/, key: 'analog-joystick', family: 'sensor', label: 'Joystick' },
  { match: /ky-040|rotary.?encoder|encoder/, key: 'ky-040', family: 'input', label: 'Rotary encoder' },
  { match: /gps|neo-?6m|neo6m|location/, key: 'gps-neo6m', family: 'sensor', label: 'GPS NEO-6M' },
  { match: /hx711|load.?cell|weight|strain/, key: 'hx711', family: 'sensor', label: 'HX711' },
  { match: /ds1307|ds3231|\brtc\b|real.?time.?clock/, key: 'ds3231', family: 'sensor', label: 'RTC DS3231' },
  { match: /ir.?receiver|vs1838/, key: 'ir-receiver', family: 'sensor', label: 'IR receiver' },
  { match: /ir.?remote|nec.?remote/, key: 'ir-remote', family: 'input', label: 'IR remote' },

  // Actuators / output
  { match: /mg996r|mg996/, key: 'mg996r', family: 'actuator', label: 'MG996R servo' },
  { match: /28byj/, key: 'stepper-28byj', family: 'actuator', label: '28BYJ-48 stepper' },
  { match: /nema.?17/, key: 'stepper-nema17', family: 'actuator', label: 'NEMA 17 stepper' },
  { match: /sg90|mg90|micro.?servo|servo/, key: 'servo', family: 'actuator', label: 'SG90 servo' },
  { match: /nema|28byj|stepper|biaxial/, key: 'stepper-motor', family: 'actuator', label: 'Stepper motor' },
  { match: /a4988|stepstick|stepper.?driver/, key: 'a4988', family: 'actuator', label: 'A4988 driver' },
  { match: /l298/, key: 'l298n', family: 'actuator', label: 'L298N driver' },
  { match: /vibration.?motor|1027|coin.?motor/, key: 'vibration-motor', family: 'actuator', label: 'Coin vibration motor' },
  { match: /tt.?motor|bo.?motor|dc.?gear.?motor/, key: 'tt-motor', family: 'actuator', label: 'TT gear motor' },
  { match: /cooling.?fan|\bfan\b|3010.?fan/, key: 'fan-30mm', family: 'actuator', label: '5 V fan 30 mm' },
  { match: /peltier|tec1|tec-?12706|thermoelectric/, key: 'peltier', family: 'actuator', label: 'Peltier TEC1-12706' },
  { match: /l293|l298|motor.?driver|h.?bridge/, key: 'motor-driver-l293d', family: 'actuator', label: 'L293D driver' },
  { match: /ks2e|2.?ch.*relay|relay.*2/, key: 'ks2e-m-dc5', family: 'actuator', label: '2-ch relay' },
  { match: /relay|srd-05/, key: 'relay', family: 'actuator', label: 'Relay module' },
  { match: /buzzer|piezo|beeper/, key: 'buzzer', family: 'actuator', label: 'Buzzer' },
  { match: /speaker|8.?ohm/, key: 'speaker-40mm', family: 'actuator', label: 'Speaker 8 Ω 40 mm' },
  { match: /rgb/, key: 'rgb-led', family: 'actuator', label: 'RGB LED' },
  { match: /\bled\b|indicator/, key: 'led', family: 'actuator', label: 'LED' },
  { match: /microsd|sd.?card/, key: 'microsd-card', family: 'actuator', label: 'microSD' },

  // Input
  { match: /6mm|b3f|tactile.*6|mini.*button/, key: 'pushbutton-6mm', family: 'input', label: '6 mm button' },
  { match: /pushbutton|push.?button|tactile|tact switch/, key: 'pushbutton', family: 'input', label: 'Pushbutton' },
  { match: /slide.?switch|ss-12/, key: 'slide-switch', family: 'input', label: 'Slide switch' },
  { match: /slide.?pot|slider.?pot/, key: 'slide-potentiometer', family: 'input', label: 'Slide pot' },
  { match: /potentiometer|\bpot\b|trimmer|trim.?pot|variable.?resistor/, key: 'potentiometer', family: 'input', label: 'Potentiometer' },
  { match: /dip.?switch/, key: 'dip-switch-8', family: 'input', label: 'DIP switch' },
  { match: /membrane|keypad|keyboard/, key: 'membrane-keypad', family: 'input', label: 'Keypad 4×4' },
  { match: /rotary.?dial/, key: 'rotary-dialer', family: 'input', label: 'Rotary dial' },

  // Passives
  { match: /resistor/, key: 'resistor', family: 'passive', label: 'Resistor' },
  { match: /cap-elec|electrolytic/, key: 'capacitor-electrolytic', family: 'passive', label: 'E-cap' },
  { match: /\bcap\b|capacitor/, key: 'capacitor', family: 'passive', label: 'Capacitor' },
  { match: /\bind\b|inductor|choke/, key: 'inductor', family: 'passive', label: 'Inductor' },
  { match: /diode|1n4|1n58|zener|rectifier|schottky/, key: 'diode', family: 'passive', label: 'Diode' },
  { match: /irf|fqp|mosfet/, key: 'transistor-power', family: 'passive', label: 'MOSFET' },
  { match: /\bbjt\b|2n2222|2n390|bc54|bc55|transistor|opto|pc817|4n25/, key: 'transistor', family: 'passive', label: 'Transistor' },
  { match: /7805|7812|7905|lm317|regulator|ams1117/, key: 'regulator', family: 'passive', label: 'Regulator' },
  { match: /lm358|lm324|lm741|tl072|op.?amp|opamp/, key: 'transistor', family: 'passive', label: 'Op-amp' },
  { match: /crystal|oscillator/, key: 'crystal', family: 'passive', label: 'Crystal' },

  // Logic
  { match: /74hc595|74ls595|595.?shift/, key: 'hc595', family: 'logic', label: '74HC595 shift register' },
  { match: /74hc165|74ls165|165.?shift/, key: 'hc165', family: 'logic', label: '74HC165 shift register' },
  { match: /cd4017|4017.?decade|4017.?counter/, key: 'cd4017', family: 'logic', label: 'CD4017 counter' },
  { match: /ne555|lm555|tlc555|se555|na555|555.?timer/, key: 'ne555', family: 'logic', label: 'NE555 timer' },
  { match: /74hc00|cd4011|4011/, key: 'hc00', family: 'logic', label: '74HC00 quad NAND' },
  { match: /74hc02/, key: 'hc02', family: 'logic', label: '74HC02 quad NOR' },
  { match: /74hc04|74hc14/, key: 'hc04', family: 'logic', label: '74HC04 hex inverter' },
  { match: /74hc08/, key: 'hc08', family: 'logic', label: '74HC08 quad AND' },
  { match: /74hc32/, key: 'hc32', family: 'logic', label: '74HC32 quad OR' },
  { match: /74hc86/, key: 'hc86', family: 'logic', label: '74HC86 quad XOR' },
  { match: /74hc|logic.?gate|flip.?flop|nand|nor|xor|74ls|cd40/, key: 'logic-ic', family: 'logic', label: 'Logic IC' },

  // Power
  { match: /9v|9.?volt/, key: 'battery-9v', family: 'power', label: '9 V battery' },
  { match: /\baa\b|1\.5v.*cell|alkaline/, key: 'battery-aa', family: 'power', label: 'AA cell' },
  { match: /coin|cr2032|button.?cell/, key: 'battery-coin-cell', family: 'power', label: 'CR2032' },
  { match: /tp4056|lipo.?charger|li-?ion.?charger/, key: 'tp4056', family: 'power', label: 'TP4056 charger' },
  { match: /lm2596|buck.?converter|step.?down.?module/, key: 'buck-module', family: 'power', label: 'LM2596 buck' },
  { match: /hlk-?pm01|mains.?module|ac.?dc.?converter/, key: 'hlk-pm01', family: 'power', label: 'HLK-PM01 mains' },
  { match: /power.?supply|mb-102|bench.?supply|usb.*supply|battery|supply/, key: 'power-supply', family: 'power', label: 'Power supply' },
  { match: /signal.?generator|function.?generator/, key: 'signal-generator', family: 'power', label: 'Signal gen' },

  // Bench
  { match: /breadboard.*mini|mini.*breadboard/, key: 'breadboard-mini', family: 'bench', label: 'Mini breadboard' },
  { match: /breadboard/, key: 'breadboard', family: 'bench', label: 'Breadboard' },
];

const TYPE_FALLBACK: Record<string, PartIdentity> = {
  controller: { key: 'esp32-devkit-v1', family: 'board', label: 'Controller' },
  sensor: { key: 'dht22', family: 'sensor', label: 'Sensor' },
  actuator: { key: 'led', family: 'actuator', label: 'Actuator' },
  power: { key: 'power-supply', family: 'power', label: 'Power' },
  interface: { key: 'ssd1306', family: 'display', label: 'Display' },
  passive: { key: 'resistor', family: 'passive', label: 'Passive' },
  communication: { key: 'esp32-devkit-v1', family: 'board', label: 'Radio' },
  software: { key: 'generic', family: 'generic', label: 'Software' },
  mechanical: { key: 'servo', family: 'actuator', label: 'Mechanism' },
  other: { key: 'generic', family: 'generic', label: 'Module' },
};

export interface IdentityInput {
  name?: string;
  partNumber?: string | null;
  type?: string;
}

/**
 * Normalise any naming of a part to one identity. Never throws, never
 * returns an empty key — worst case is the node-type fallback.
 */
export function identifyPart(input: IdentityInput): PartIdentity {
  const hay = `${input.name ?? ''} ${input.partNumber ?? ''}`.toLowerCase();
  for (const rule of RULES) {
    if (rule.match.test(hay)) {
      // Preserve value suffixes for passives/LEDs so bands + cans stay honest:
      // "resistor-10k", "cap-elec-470u", "led-green".
      if (rule.key === 'resistor' || rule.key === 'capacitor' || rule.key === 'diode') {
        const suffixed = hay.match(/(resistor[-_ ]?[0-9a-z.]+|cap[-_ ]?(?:elec[-_ ]?)?[0-9a-z.]+|led[-_ ]?(?:red|green|blue|yellow|white|orange))/);
        if (suffixed) {
          const norm = suffixed[1].replace(/[ _]/g, '-');
          return { key: norm, family: rule.family, label: rule.label };
        }
      }
      return { key: rule.key, family: rule.family, label: rule.label };
    }
  }
  // Raw diagram ids (`wokwi-hc-sr04`, `board-arduino-uno`) already ARE keys.
  const cleaned = hay.replace(/^wokwi-|^board-/g, '').split(/\s+/)[0];
  if (cleaned && /^[a-z0-9][a-z0-9-]*$/.test(cleaned) && cleaned.length > 2) {
    return { key: cleaned, family: 'generic', label: input.name || cleaned };
  }
  return TYPE_FALLBACK[input.type ?? 'other'] ?? TYPE_FALLBACK.other;
}

/** True when the mesh cap/knob/slider itself is directly manipulable in 3D. */
export function isPressable(key: string): boolean {
  return (
    key === 'pushbutton' ||
    key === 'pushbutton-6mm' ||
    key === 'slide-switch' ||
    key === 'tilt-switch' ||
    key === 'membrane-keypad' ||
    key === 'analog-joystick' ||
    key === 'ky-040' ||
    key === 'dip-switch-8' ||
    key === 'potentiometer' ||
    key === 'slide-potentiometer'
  );
}

/** True when the part shows a live sensor readout worth surfacing. */
export function hasSensorReadout(key: string): boolean {
  return !(
    key.startsWith('resistor') ||
    key.startsWith('cap') ||
    key.startsWith('ind-') ||
    key === 'breadboard' ||
    key === 'breadboard-mini'
  );
}
