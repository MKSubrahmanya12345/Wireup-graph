// ── Wireup validation harness: Adafruit SSD1306 stub ────────────────────────
// Mirrors the Adafruit_SSD1306 API used by generated firmware.
#pragma once
#include "Adafruit_GFX.h"
#include "Wire.h"
#include <cstdint>

#define SSD1306_SWITCHCAPVCC 0x02
#define SSD1306_WHITE 1

class Adafruit_SSD1306 : public Adafruit_GFX {
public:
  Adafruit_SSD1306(uint8_t w, uint8_t h, TwoWire* wire, int8_t rstPin)
    : Adafruit_GFX(w, h) {
    (void)wire;
    (void)rstPin;
  }

  bool begin(uint8_t switchVcc = SSD1306_SWITCHCAPVCC, uint8_t i2cAddr = 0x3C,
             bool reset = true, bool periphBegin = true) {
    (void)switchVcc; (void)i2cAddr; (void)reset; (void)periphBegin;
    return true;
  }
  void clearDisplay() {}
  void display() {}
  void dim(bool dim) { (void)dim; }
};
