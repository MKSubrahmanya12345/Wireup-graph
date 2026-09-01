/**
 * A tiny AVR assembler + the heartbeat program the in-browser bench runs.
 *
 * Page 03's live bench executes REAL AVR machine code on avr8js — not a
 * setInterval pretending to be a simulator. The program below is assembled
 * here (no toolchain needed at build time) and its only job is to be an
 * honest clock source: it toggles PORTB5 with a delay loop, so the animated
 * circuit's heartbeat is driven by instructions actually retiring on a
 * simulated ATmega328p core.
 *
 * Why an AVR core for an ESP32 build: avr8js simulates AVR silicon, and the
 * Wireup knowledge base targets the ESP32 — those cannot be the same chip.
 * The ESP32 firmware itself is compiled and simulated SERVER-side (g++ →
 * PlatformIO → Wokwi headless) and by the HardwareSimProvider; this canvas is
 * the visual bench on top of that, and it is labelled as such in the UI.
 */

const F_CPU = 16_000_000;

// ── Instruction encoders (ATmega328p) ──────────────────────────────────────

/** sbi A, b — set bit b in I/O register A. */
const sbi = (a: number, b: number): number => 0x9a00 | (a << 3) | b;
/** cbi A, b — clear bit b in I/O register A. */
const cbi = (a: number, b: number): number => 0x9800 | (a << 3) | b;
/** ldi Rd, K — load immediate (Rd must be r16..r31). */
const ldi = (d: number, k: number): number =>
  0xe000 | ((k & 0xf0) << 4) | ((d - 16) << 4) | (k & 0x0f);
/** sbiw Rd+1:Rd, K — subtract immediate from word (Rd ∈ {24,26,28,30}). */
const sbiw = (d: number, k: number): number =>
  0x9700 | ((k & 0x30) << 2) | (((d - 24) / 2) << 4) | (k & 0x0f);
/** dec Rd — decrement register. */
const dec = (d: number): number => 0x940a | (d << 4);
/** brne k — branch if not equal, k in instruction words (signed 7-bit). */
const brne = (k: number): number => 0xf401 | ((k & 0x7f) << 3);
/** rjmp k — relative jump, k in instruction words (signed 12-bit). */
const rjmp = (k: number): number => 0xc000 | (k & 0xfff);

const DDRB = 0x04;
const PORTB = 0x05;
const LED_BIT = 5; // PORTB5 = the classic D13 LED

/** How many outer iterations each half-period runs (≈16.4 ms per iteration). */
const OUTER = 15;

/**
 * The assembled heartbeat program.
 *
 *   sbi  DDRB, 5          ; LED pin as output
 * loop:
 *   sbi  PORTB, 5         ; LED on
 *   <delay>
 *   cbi  PORTB, 5         ; LED off
 *   <delay>
 *   rjmp loop
 *
 *   <delay> = ldi r18,OUTER / ldi r24,0xFF / ldi r25,0xFF
 *             inner: sbiw r24,1 / brne inner
 *             dec r18 / brne outer
 */
export function assembleHeartbeat(): Uint16Array {
  const words: number[] = [];
  const delay = (): void => {
    words.push(ldi(18, OUTER)); // outer counter
    // outer:
    const outerStart = words.length;
    words.push(ldi(24, 0xff));
    words.push(ldi(25, 0xff));
    // inner:
    words.push(sbiw(24, 1));
    words.push(brne(-2)); // back to sbiw
    words.push(dec(18));
    // back to `outer:` — the branch is relative to the NEXT instruction.
    words.push(brne(outerStart - (words.length + 1)));
  };

  words.push(sbi(DDRB, LED_BIT));
  const loopStart = words.length;
  words.push(sbi(PORTB, LED_BIT));
  delay();
  words.push(cbi(PORTB, LED_BIT));
  delay();
  words.push(rjmp(loopStart - (words.length + 1)));

  return Uint16Array.from(words);
}

/** Cycles in one LED half-period — used to sanity-check the runtime. */
export function heartbeatHalfPeriodCycles(): number {
  // inner loop: sbiw (2) + brne taken (2) = 4 cycles × 65536 iterations,
  // minus the final non-taken branch, plus the outer bookkeeping.
  const inner = 65536 * 4 - 1;
  return OUTER * (inner + 2 /* ldi ×2 */ + 1 /* dec */ + 2 /* brne */) + 1;
}

export const CPU_HZ = F_CPU;

/** Simulated milliseconds for a cycle count at 16 MHz. */
export function cyclesToMs(cycles: number): number {
  return (cycles / F_CPU) * 1000;
}
