// ── Wireup validation harness: Adafruit GFX stub ────────────────────────────
// Mirrors the Adafruit_GFX surface used by generated firmware so
// `g++ -fsyntax-only` acts as a real compiler gate.
#pragma once
#include "Arduino.h"
#include <cstdint>

class Adafruit_GFX {
public:
  Adafruit_GFX(int16_t w, int16_t h) { (void)w; (void)h; }
  virtual ~Adafruit_GFX() = default;

  void setTextSize(uint8_t s) { (void)s; }
  void setTextColor(uint16_t c) { (void)c; }
  void setCursor(int16_t x, int16_t y) { (void)x; (void)y; }
  size_t print(const char* s) { (void)s; return 0; }
  size_t print(const String& s) { (void)s; return 0; }
  size_t println(const char* s) { (void)s; return 0; }
  size_t println(const String& s) { (void)s; return 0; }
};
