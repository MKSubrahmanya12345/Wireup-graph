// ── Wireup validation harness: DallasTemperature stub ───────────────────────
#pragma once
#include "Arduino.h"
#include "OneWire.h"

#define DEVICE_DISCONNECTED_C -127.0f

class DallasTemperature {
public:
  explicit DallasTemperature(OneWire* oneWire) { (void)oneWire; }
  void begin() {}
  void requestTemperatures() {}
  float getTempCByIndex(uint8_t deviceIndex) { (void)deviceIndex; return 21.5f; }
  void setResolution(uint8_t resolution) { (void)resolution; }
};
