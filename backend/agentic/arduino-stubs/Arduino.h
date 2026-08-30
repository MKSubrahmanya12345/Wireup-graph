// ── Wireup validation harness: Arduino core API stub ────────────────────────
// Mirrors the Arduino/ESP32 Arduino-core surface used by generated firmware
// so `g++ -fsyntax-only` acts as a real compiler gate. Function bodies are
// inline no-ops; signatures and types match the real core.
#pragma once

#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

typedef bool boolean;
typedef uint8_t byte;
typedef std::string __arduino_string_base;

#define HIGH 0x1
#define LOW 0x0

#define INPUT 0x01
#define OUTPUT 0x02
#define INPUT_PULLUP 0x04
#define INPUT_PULLDOWN 0x08

#define RISING 1
#define FALLING 2
#define CHANGE 3

#define LSBFIRST 0
#define MSBFIRST 1

#define PROGMEM
#define F(x) x
#define PSTR(x) x
#define ARDUINO 10812

class String : public __arduino_string_base {
public:
  String() : __arduino_string_base() {}
  String(const char* s) : __arduino_string_base(s ? s : "") {}
  String(const std::string& s) : __arduino_string_base(s) {}
  String(int value) : __arduino_string_base(std::to_string(value)) {}
  String(unsigned int value) : __arduino_string_base(std::to_string(value)) {}
  String(long value) : __arduino_string_base(std::to_string(value)) {}
  String(unsigned long value) : __arduino_string_base(std::to_string(value)) {}
  String(double value) : __arduino_string_base(std::to_string(value)) {}
  String(double value, int decimals) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.*f", decimals, value);
    assign(buf);
  }
  const char* c_str() const { return data(); }
  String& operator+=(const String& rhs) {
    append(rhs);
    return *this;
  }
  String& operator+=(const char* rhs) {
    append(rhs ? rhs : "");
    return *this;
  }
  String& operator+=(char rhs) {
    push_back(rhs);
    return *this;
  }
};

inline String operator+(const String& a, const String& b) {
  String out(a);
  out += b;
  return out;
}
inline String operator+(const char* a, const String& b) {
  String out(a);
  out += b;
  return out;
}
inline String operator+(const String& a, const char* b) {
  String out(a);
  out += b;
  return out;
}
inline String operator+(const String& a, char b) {
  String out(a);
  out += b;
  return out;
}

class IPAddress {
public:
  IPAddress() : value_(0) {}
  explicit IPAddress(uint32_t value) : value_(value) {}
  String toString() const { return String("192.168.1.50"); }
  uint32_t value_;
};

class HardwareSerial {
public:
  void begin(unsigned long baud) { (void)baud; }
  void end() {}
  size_t print(const char* s) { return s ? std::strlen(s) : 0; }
  size_t print(const String& s) { return s.size(); }
  size_t print(char c) { (void)c; return 1; }
  size_t print(int v) { (void)v; return 1; }
  size_t print(unsigned int v) { (void)v; return 1; }
  size_t print(long v) { (void)v; return 1; }
  size_t print(unsigned long v) { (void)v; return 1; }
  size_t print(double v) { (void)v; return 1; }
  size_t print(const IPAddress& ip) { return print(ip.toString()); }
  size_t println() { return 1; }
  size_t println(const IPAddress& ip) { return print(ip.toString()); }
  size_t println(const char* s) { return print(s); }
  size_t println(const String& s) { return print(s); }
  size_t println(char c) { return print(c); }
  size_t println(int v) { return print(v); }
  size_t println(unsigned int v) { return print(v); }
  size_t println(long v) { return print(v); }
  size_t println(unsigned long v) { return print(v); }
  size_t println(double v) { return print(v); }
  int printf(const char* fmt, ...) {
    (void)fmt;
    va_list args;
    va_start(args, fmt);
    va_end(args);
    return 0;
  }
  int available() { return 0; }
  int read() { return -1; }
};

extern HardwareSerial Serial;

inline void pinMode(uint8_t pin, uint8_t mode) { (void)pin; (void)mode; }
inline void digitalWrite(uint8_t pin, uint8_t value) { (void)pin; (void)value; }
inline int digitalRead(uint8_t pin) { (void)pin; return LOW; }
inline int analogRead(uint8_t pin) { (void)pin; return 0; }
inline uint32_t analogReadMilliVolts(uint8_t pin) { (void)pin; return 0; }
inline void analogWrite(uint8_t pin, int value) { (void)pin; (void)value; }
inline void dacWrite(uint8_t pin, uint8_t value) { (void)pin; (void)value; }
inline unsigned long millis() { return 0; }
inline unsigned long micros() { return 0; }
inline void delay(unsigned long ms) { (void)ms; }
inline void delayMicroseconds(unsigned int us) { (void)us; }
inline void yield() {}
inline unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout = 1000000UL) {
  (void)pin; (void)state; (void)timeout; return 0;
}
inline void attachInterrupt(uint8_t pin, void (*isr)(), int mode) { (void)pin; (void)isr; (void)mode; }
inline long random(long upper) { (void)upper; return 0; }

inline double sq(double x) { return x * x; }
inline long mapL(long x, long in_min, long in_max, long out_min, long out_max) {
  if (in_max == in_min) return out_min;
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}
// Arduino map() returns long; the standard macro version is kept off the std namespace.
#define map(x, in_min, in_max, out_min, out_max) mapL((long)(x), (long)(in_min), (long)(in_max), (long)(out_min), (long)(out_max))

#ifndef isnan
#define isnan __builtin_isnan
#endif

// setup()/loop() are user-defined in the sketch translation unit.
