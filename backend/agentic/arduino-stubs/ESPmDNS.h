// ── Wireup validation harness: ESP32 mDNS stub ──────────────────────────────
#pragma once
#include "Arduino.h"

class MDNSResponder {
public:
  bool begin(const char* hostName) { (void)hostName; return true; }
  void addService(const char* service, const char* protocol, uint16_t port) {
    (void)service; (void)protocol; (void)port;
  }
};

extern MDNSResponder MDNS;
