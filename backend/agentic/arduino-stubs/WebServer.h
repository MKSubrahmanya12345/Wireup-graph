// ── Wireup validation harness: ESP32 WebServer stub ─────────────────────────
#pragma once
#include "Arduino.h"
#include <functional>

enum HTTPMethod { HTTP_ANY = 0, HTTP_GET = 1, HTTP_POST = 2, HTTP_PUT = 3, HTTP_DELETE = 4 };

class WebServer {
public:
  typedef std::function<void()> THandlerFunction;

  explicit WebServer(int port = 80) { (void)port; }

  void begin() {}
  void stop() {}
  void handleClient() {}

  void on(const char* uri, THandlerFunction handler) { (void)uri; (void)handler; }
  void on(const char* uri, HTTPMethod method, THandlerFunction handler) {
    (void)uri; (void)method; (void)handler;
  }
  void onNotFound(THandlerFunction handler) { (void)handler; }

  void send(int code, const char* contentType = nullptr, const String& content = String()) {
    (void)code; (void)contentType; (void)content;
  }
  void send_P(int code, const char* contentType, const char* content) {
    (void)code; (void)contentType; (void)content;
  }
  void sendHeader(const char* name, const String& value, bool first = false) {
    (void)name; (void)value; (void)first;
  }
  bool hasArg(const char* name) const { (void)name; return false; }
  String arg(const char* name) const { (void)name; return String(); }
  int args() const { return 0; }
};
