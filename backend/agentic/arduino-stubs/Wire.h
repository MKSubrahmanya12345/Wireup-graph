// ── Wireup validation harness: Arduino Wire (I2C) stub ──────────────────────
#pragma once
#include "Arduino.h"

class TwoWire {
public:
  void begin() {}
  void begin(int sda, int scl) { (void)sda; (void)scl; }
  void setClock(uint32_t freq) { (void)freq; }
  void beginTransmission(uint8_t address) { (void)address; }
  uint8_t endTransmission(bool sendStop = true) { (void)sendStop; return 0; }
  size_t requestFrom(uint8_t address, size_t quantity) { (void)address; (void)quantity; return 0; }
  size_t write(uint8_t data) { (void)data; return 1; }
  size_t write(const uint8_t* data, size_t quantity) { (void)data; return quantity; }
  int available() { return 0; }
  int read() { return -1; }
};

extern TwoWire Wire;
