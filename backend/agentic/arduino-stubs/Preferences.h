// ── Wireup validation harness: ESP32 Preferences (NVS) stub ─────────────────
// Mirrors the esp32 Preferences API used by generated firmware so
// `g++ -fsyntax-only` acts as a real compiler gate.
#pragma once
#include "Arduino.h"

class Preferences {
public:
  bool begin(const char* name, bool readOnly, const char* partition = nullptr) {
    (void)name; (void)readOnly; (void)partition;
    return true;
  }
  void end() {}
  String getString(const char* key, const String& fallback) const {
    (void)key;
    return fallback;
  }
  void putString(const char* key, const String& value) { (void)key; (void)value; }
  bool clear() { return true; }
};
