// ── Wireup validation harness: Adafruit BME280 stub ─────────────────────────
#pragma once
#include "Arduino.h"
#include "Wire.h"

class Adafruit_BME280 {
public:
  bool begin(uint8_t addr = 0x77, TwoWire* theWire = &Wire) {
    (void)addr; (void)theWire; return true;
  }
  float readTemperature() { return 22.4f; }
  float readPressure() { return 101325.0f; }
  float readHumidity() { return 41.0f; }
  void setSampling() {}
};
