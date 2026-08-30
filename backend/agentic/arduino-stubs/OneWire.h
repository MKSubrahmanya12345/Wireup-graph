// ── Wireup validation harness: OneWire stub ─────────────────────────────────
#pragma once
#include "Arduino.h"

class OneWire {
public:
  explicit OneWire(uint8_t pin) { (void)pin; }
  uint8_t reset() { return 1; }
  void select(const uint8_t rom[8]) { (void)rom; }
  void skip() {}
  void write(uint8_t v, uint8_t power = 0) { (void)v; (void)power; }
  uint8_t read() { return 0; }
  bool search(uint8_t* newAddr, bool searchMode = true) {
    (void)newAddr; (void)searchMode; return false;
  }
};
