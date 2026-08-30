// ── Wireup validation harness: ESP32Servo stub ──────────────────────────────
#pragma once
#include "Arduino.h"

class Servo {
public:
  void setPeriodHertz(int hertz) { (void)hertz; }
  int attach(int pin, int min = 500, int max = 2400) {
    (void)pin; (void)min; (void)max; return 0;
  }
  void detach() {}
  void write(int value) { (void)value; }
  int read() { return 90; }
  bool attached() { return true; }
};
