/**
 * True-scale spatial outlines for the planner (backend mirror of
 * frontend/src/three/dimensions.ts).
 *
 * The deterministic architect stamps every node with spatial.dimensions so
 * the 3D bench renders honest part-to-part ratios out of the box: an Uno at
 * 68.6 mm next to an OLED at 27 mm, never 10× apart. Keep the two tables in
 * sync — same nominals, same keys, metres.
 */

export interface SpatialDims {
  w: number;
  h: number;
  d: number;
}

export interface SpatialEntry {
  dimensions: SpatialDims;
  massGrams: number;
  modelRef: string;
}

const mm = (w: number, h: number, d: number, massGrams = 0, modelRef = ''): SpatialEntry => ({
  dimensions: { w: w / 1000, h: h / 1000, d: d / 1000 },
  massGrams,
  modelRef,
});

const TABLE: Record<string, SpatialEntry> = {
  'esp32-devkit': mm(52, 13, 28, 10, 'esp32-devkit-v1'),
  'esp32-devkit-v1': mm(52, 13, 28, 10, 'esp32-devkit-v1'),
  'esp32-s3': mm(48, 12, 25.5, 9, 'esp32-s3'),
  'arduino-uno': mm(68.6, 14, 53.4, 25, 'arduino-uno'),
  'arduino-nano': mm(45, 8, 18, 7, 'arduino-nano'),
  'arduino-mega': mm(101.6, 15, 53.4, 37, 'arduino-mega'),
  'pi-pico': mm(51, 11, 21, 6, 'pi-pico-w'),
  dht22: mm(27, 9, 15, 5, 'dht22'),
  dht11: mm(19, 8, 15, 4, 'dht11'),
  bme280: mm(15, 3, 12, 2, 'bme280'),
  bmp280: mm(15, 3, 12, 2, 'bmp280'),
  ds18b20: mm(30, 6, 6, 10, 'ds18b20'),
  'cap-soil': mm(98, 7, 23, 12, 'cap-soil'),
  'mq-2': mm(32, 22, 20, 12, 'gas-sensor'),
  'gas-sensor': mm(32, 22, 20, 12, 'gas-sensor'),
  'hc-sr04': mm(45, 15, 20, 9, 'hc-sr04'),
  pir: mm(32, 24, 24, 6, 'pir-motion-sensor'),
  'hc-sr501': mm(32, 24, 24, 6, 'pir-motion-sensor'),
  mpu6050: mm(21, 3, 16, 2, 'mpu6050'),
  ssd1306: mm(27, 5, 27, 4, 'ssd1306'),
  lcd1602: mm(80, 12, 36, 30, 'lcd1602-i2c'),
  lcd2004: mm(98, 14, 60, 55, 'lcd2004-i2c'),
  'wemos-d1-mini': mm(34.2, 8, 25.6, 10, 'wemos-d1-mini'),
  'wemos-d1-r32': mm(68.6, 14, 53.4, 25, 'wemos-d1-r32'),
  'arduino-leonardo': mm(68.6, 14, 53.4, 25, 'arduino-leonardo'),
  'pro-micro': mm(33, 7, 18, 3, 'pro-micro'),
  'rpi-4b': mm(85, 17, 56, 46, 'rpi-4b'),
  'pi-zero': mm(65, 8, 30, 9, 'pi-zero'),
  microbit: mm(52, 8, 42, 9, 'microbit'),
  rc522: mm(60, 4, 36, 8, 'rc522'),
  nrf24l01: mm(29, 4, 15.5, 2, 'nrf24l01'),
  'hc-05': mm(37, 5, 16, 4, 'hc-05'),
  pca9685: mm(62, 10, 26, 15, 'pca9685'),
  ads1115: mm(25.4, 4, 17.8, 3, 'ads1115'),
  tp4056: mm(25, 5, 19, 3, 'tp4056'),
  'buck-module': mm(43, 14, 21, 11, 'buck-module'),
  'hlk-pm01': mm(34, 15, 20, 20, 'hlk-pm01'),
  mg996r: mm(40.7, 42.9, 19.7, 55, 'mg996r'),
  'stepper-28byj': mm(28, 30, 28, 34, 'stepper-28byj'),
  'stepper-nema17': mm(42, 40, 42, 280, 'stepper-nema17'),
  'tt-motor': mm(70, 18, 23, 30, 'tt-motor'),
  'vibration-motor': mm(10, 4, 10, 2, 'vibration-motor'),
  'fan-30mm': mm(30, 7, 30, 8, 'fan-30mm'),
  'speaker-40mm': mm(40, 8, 40, 15, 'speaker-40mm'),
  peltier: mm(40, 4, 40, 22, 'peltier'),
  l298n: mm(43, 27, 43, 30, 'l298n'),
  ttp223: mm(24, 4, 24, 2, 'ttp223'),
  sw420: mm(32, 6, 14, 4, 'sw420'),
  'rain-plate': mm(50, 2, 40, 8, 'rain-plate'),
  'soil-resistive': mm(60, 2, 20, 6, 'soil-resistive'),
  'water-level': mm(65, 2, 20, 5, 'water-level'),
  'max7219-matrix': mm(50, 12, 32, 20, 'max7219-matrix'),
  tm1637: mm(42, 10, 24, 10, 'tm1637'),
  'nokia-5110': mm(45, 12, 45, 12, 'nokia-5110'),
  sg90: mm(23, 29, 12.2, 9, 'servo'),
  servo: mm(23, 29, 12.2, 9, 'servo'),
  led: mm(5, 8.6, 5, 0, 'led'),
  buzzer: mm(12, 9.5, 12, 3, 'buzzer'),
  relay: mm(50, 19, 26, 25, 'relay'),
  pushbutton: mm(12, 7.5, 12, 2, 'pushbutton'),
  potentiometer: mm(16, 25, 16, 12, 'potentiometer'),
  resistor: mm(12, 2.5, 2.5, 0, 'resistor'),
  'usb-5v-2a': mm(20, 50, 20, 40, 'power-supply'),
  'dip-8': mm(9.3, 3.6, 6.4, 1.5, 'ne555'),
  'dip-14': mm(19, 3.6, 6.4, 2, 'hc00'),
  'dip-16': mm(19.3, 5, 7.6, 2.5, 'hc595'),
  generic: mm(30, 8, 20, 5, 'generic'),
};

const FALLBACK: SpatialEntry = TABLE.generic;

/**
 * Resolve true-scale spatial for any part number / name. Matches the
 * frontend identifyPart priority closely enough that planner output lands
 * on the same mesh the 3D view would pick client-side.
 */
export function spatialForPart(partNumber?: string | null, name?: string | null): SpatialEntry {
  const hay = `${partNumber ?? ''} ${name ?? ''}`.toLowerCase();
  // Direct id hits first (device ids like 'aosong-dht22' contain 'dht22').
  for (const [key, entry] of Object.entries(TABLE)) {
    if (key !== 'generic' && hay.includes(key)) return entry;
  }
  if (/mega/.test(hay)) return TABLE['arduino-mega'];
  if (/nano/.test(hay)) return TABLE['arduino-nano'];
  if (/uno/.test(hay)) return TABLE['arduino-uno'];
  if (/d1.?r32/.test(hay)) return TABLE['wemos-d1-r32'];
  if (/wemos|d1.?mini/.test(hay)) return TABLE['wemos-d1-mini'];
  if (/leonardo/.test(hay)) return TABLE['arduino-leonardo'];
  if (/pro.?micro/.test(hay)) return TABLE['pro-micro'];
  if (/raspberry.?pi.?4|rpi.?4|pi.?4b/.test(hay)) return TABLE['rpi-4b'];
  if (/pi.?zero/.test(hay)) return TABLE['pi-zero'];
  if (/micro.?bit/.test(hay)) return TABLE.microbit;
  if (/esp32|esp8266|devkit|wroom|nodemcu/.test(hay)) return TABLE['esp32-devkit'];
  if (/pico/.test(hay)) return TABLE['pi-pico'];
  if (/tm1637/.test(hay)) return TABLE.tm1637;
  if (/max7219|dot.?matrix|led.?matrix/.test(hay)) return TABLE['max7219-matrix'];
  if (/nokia.?5110|5110|pcd8544/.test(hay)) return TABLE['nokia-5110'];
  if (/oled|ssd1306|display/.test(hay)) return TABLE.ssd1306;
  if (/ne555|lm555|tlc555|555.?timer/.test(hay)) return TABLE['dip-8'];
  if (/cd4017|74hc595|74ls595|74hc165|74ls165/.test(hay)) return TABLE['dip-16'];
  if (/74hc00|74hc02|74hc04|74hc08|74hc14|74hc32|74hc86|cd4011|logic.?ic|logic.?gate/.test(hay)) {
    return TABLE['dip-14'];
  }
  if (/mg996/.test(hay)) return TABLE.mg996r;
  if (/28byj/.test(hay)) return TABLE['stepper-28byj'];
  if (/nema.?17/.test(hay)) return TABLE['stepper-nema17'];
  if (/l298/.test(hay)) return TABLE.l298n;
  if (/vibration.?motor|coin.?motor/.test(hay)) return TABLE['vibration-motor'];
  if (/tt.?motor|bo.?motor|dc.?gear.?motor/.test(hay)) return TABLE['tt-motor'];
  if (/cooling.?fan|3010.?fan/.test(hay)) return TABLE['fan-30mm'];
  if (/peltier|tec1|thermoelectric/.test(hay)) return TABLE.peltier;
  if (/speaker|8.?ohm/.test(hay)) return TABLE['speaker-40mm'];
  if (/rc522|mfrc522|rfid/.test(hay)) return TABLE.rc522;
  if (/nrf24/.test(hay)) return TABLE.nrf24l01;
  if (/hc.?05|hc.?06|bluetooth/.test(hay)) return TABLE['hc-05'];
  if (/pca9685/.test(hay)) return TABLE.pca9685;
  if (/ads1115/.test(hay)) return TABLE.ads1115;
  if (/tp4056|li.?ion.?charger/.test(hay)) return TABLE.tp4056;
  if (/lm2596|buck/.test(hay)) return TABLE['buck-module'];
  if (/hlk.?pm01|ac.?dc.?module/.test(hay)) return TABLE['hlk-pm01'];
  if (/yl.?69|resistive.?soil/.test(hay)) return TABLE['soil-resistive'];
  if (/soil|moisture/.test(hay)) return TABLE['cap-soil'];
  if (/rain/.test(hay)) return TABLE['rain-plate'];
  if (/water.?level/.test(hay)) return TABLE['water-level'];
  if (/ttp223|touch/.test(hay)) return TABLE.ttp223;
  if (/sw.?420|vibration.?switch|knock/.test(hay)) return TABLE.sw420;
  if (/servo|sg90/.test(hay)) return TABLE.sg90;
  if (/relay/.test(hay)) return TABLE.relay;
  if (/buzzer|piezo/.test(hay)) return TABLE.buzzer;
  if (/button|tactile/.test(hay)) return TABLE.pushbutton;
  if (/potentiometer|\bpot\b/.test(hay)) return TABLE.potentiometer;
  if (/resistor/.test(hay)) return TABLE.resistor;
  if (/controller|mcu/.test(hay)) return TABLE['esp32-devkit'];
  if (/sensor/.test(hay)) return TABLE.dht22;
  return FALLBACK;
}
