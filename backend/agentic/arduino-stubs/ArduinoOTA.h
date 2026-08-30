// ── Wireup validation harness: ArduinoOTA stub ─────────────────────────────
// Mirrors the ArduinoOTA API surface used by generated firmware.
#pragma once

class ArduinoOTAClass {
public:
  void setHostname(const char* hostname) { (void)hostname; }
  void setPassword(const char* password) { (void)password; }
  void onStart(void (*fn)()) { (void)fn; }
  void onEnd(void (*fn)()) { (void)fn; }
  void onProgress(void (*fn)(unsigned int, unsigned int)) { (void)fn; }
  void onError(void (*fn)(int)) { (void)fn; }
  void begin() {}
  void handle() {}
};

extern ArduinoOTAClass ArduinoOTA;
