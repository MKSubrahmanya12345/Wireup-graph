// ── Wireup validation harness: Adafruit DHT sensor library stub ─────────────
#pragma once
#include "Arduino.h"

#define DHT11 11
#define DHT22 22
#define DHT21 21
#define AM2301 21

class DHT {
public:
  DHT(uint8_t pin, uint8_t type, uint8_t count = 6) {
    (void)pin; (void)type; (void)count;
  }
  void begin() {}
  float readTemperature(bool S = false, bool force = false) {
    (void)S; (void)force; return 23.7f;
  }
  float readHumidity(bool force = false) { (void)force; return 44.0f; }
  float readTemperatureF() { return 74.7f; }
  float computeHeatIndex(float temperature, float percentHumidity, bool isFahrenheit = true) {
    (void)temperature; (void)percentHumidity; (void)isFahrenheit; return 0.0f;
  }
};
