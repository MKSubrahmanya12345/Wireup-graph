// ── Wireup validation harness: ESP32 WiFi stub ──────────────────────────────
#pragma once
#include "Arduino.h"

enum wl_status_t {
  WL_NO_SHIELD = 255,
  WL_IDLE_STATUS = 0,
  WL_NO_SSID_AVAIL = 1,
  WL_SCAN_COMPLETED = 2,
  WL_CONNECTED = 3,
  WL_CONNECT_FAILED = 4,
  WL_CONNECTION_LOST = 5,
  WL_DISCONNECTED = 6
};

enum wifi_mode_t { WIFI_OFF = 0, WIFI_STA = 1, WIFI_AP = 2, WIFI_AP_STA = 3 };

class WiFiClass {
public:
  void mode(wifi_mode_t m) { (void)m; }
  wl_status_t begin(const char* ssid, const char* passphrase = nullptr) {
    (void)ssid; (void)passphrase; return WL_CONNECTED;
  }
  wl_status_t status() { return WL_CONNECTED; }
  IPAddress localIP() { return IPAddress(); }
  IPAddress softAPIP() { return IPAddress(); }
  String SSID() { return String("wireup-net"); }
  int32_t RSSI() { return -51; }
  bool softAP(const char* ssid, const char* passphrase = nullptr) {
    (void)ssid; (void)passphrase; return true;
  }
  void disconnect(bool wifioff = false) { (void)wifioff; }
  uint8_t* macAddress(uint8_t* mac) {
    static uint8_t fake[6] = {0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01};
    if (mac) std::memcpy(mac, fake, 6);
    return mac;
  }
};

extern WiFiClass WiFi;
