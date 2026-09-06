/**
 * simStore.ts — the single live state shared by the 2D bench, the 3D bench
 * and the controls panel.
 *
 * This is the Wireup adaptation of velxio's live-element + SensorUpdateRegistry
 * pattern. Velxio drives `<wokwi-*>` element JS properties straight from its
 * simulators (BasicParts / ComplexParts / SensorParts) and reads them back
 * every frame for the 3D view. Our bench does the same through THIS store:
 *
 *   writers: bench element wiring (sim/partSim.ts), 3D mesh gestures
 *            (press the cap, drag the knob), controls panel sliders,
 *            the avr8js heartbeat sync.
 *   readers: 3D animated wrappers (useFrame, imperative — no re-renders),
 *            bench live props, net-level solver (sim/circuitSim.ts).
 *
 * Virtual GPIO: the browser AVR core only runs the heartbeat program, so
 * per-pin digital/ADC levels live here as honest virtual nets (`pins` /
 * `adcVolts`, keyed by net name). The ESP32 firmware itself is compiled and
 * simulated server-side; the UI labels that everywhere it matters.
 */

import { create } from 'zustand';

export interface HeartbeatState {
  ledOn: boolean;
  simMs: number;
  cycles: number;
  edges: number;
}

export interface LedLive {
  on: boolean;
  brightness: number;
  color: string;
}

interface Sim3DState {
  /** Transport. */
  running: boolean;
  heartbeat: HeartbeatState;

  /** Momentary presses, keyed by part id. */
  pressed: Record<string, boolean>;
  /** Wiper / level 0..1023 (pots, sliders, joysticks-as-single, LDR…). */
  analog: Record<string, number>;
  /** Servo + stepper shaft angle, degrees. */
  servo: Record<string, number>;
  /** Toggle switches (slide-switch, relay coil, power…). */
  switchOn: Record<string, boolean>;
  /** DIP-8 states. */
  dip: Record<string, number[]>;
  /** Sensor channels per part id, e.g. sensors[dht_1].temperature. */
  sensors: Record<string, Record<string, number | boolean>>;
  /** LED / NeoPixel live state. */
  led: Record<string, LedLive>;
  /** LCD / OLED text rows. */
  lcdText: Record<string, string[]>;
  /** Last keypad / remote key. */
  lastKey: Record<string, string>;
  /** Rotary encoder step counts. */
  encoder: Record<string, number>;
  /** Virtual digital net levels (INPUT_PULLUP-aware, see circuitSim). */
  pins: Record<string, boolean>;
  /** Virtual ADC voltages by net name. */
  adcVolts: Record<string, number>;
  /** Monotonic sampler bump — drives periodic re-solves (IC clocks). */
  tick: number;

  setRunning: (running: boolean) => void;
  setHeartbeat: (patch: Partial<HeartbeatState>) => void;
  setPressed: (id: string, pressed: boolean) => void;
  setAnalog: (id: string, value: number) => void;
  setServo: (id: string, degrees: number) => void;
  setSwitch: (id: string, on: boolean) => void;
  setDip: (id: string, values: number[]) => void;
  setSensor: (id: string, key: string, value: number | boolean) => void;
  setSensors: (id: string, values: Record<string, number | boolean>) => void;
  setLed: (id: string, patch: Partial<LedLive>) => void;
  setLcdText: (id: string, rows: string[]) => void;
  setLastKey: (id: string, key: string) => void;
  setEncoder: (id: string, steps: number) => void;
  setPin: (net: string, high: boolean) => void;
  setAdc: (net: string, volts: number) => void;
  bumpTick: () => void;
  resetPart: (id: string) => void;
  resetAll: () => void;
}

const INITIAL_HEARTBEAT: HeartbeatState = { ledOn: false, simMs: 0, cycles: 0, edges: 0 };

const clamp1023 = (v: number): number =>
  Math.max(0, Math.min(1023, Math.round(v)));

export const useSim3D = create<Sim3DState>()((set) => ({
  running: true,
  heartbeat: INITIAL_HEARTBEAT,

  pressed: {},
  analog: {},
  servo: {},
  switchOn: {},
  dip: {},
  sensors: {},
  led: {},
  lcdText: {},
  lastKey: {},
  encoder: {},
  pins: {},
  adcVolts: {},
  tick: 0,

  setRunning: (running) => set({ running }),
  setHeartbeat: (patch) =>
    set((s) => ({ heartbeat: { ...s.heartbeat, ...patch } })),
  setPressed: (id, pressed) =>
    set((s) => ({ pressed: { ...s.pressed, [id]: pressed } })),
  setAnalog: (id, value) =>
    set((s) => ({ analog: { ...s.analog, [id]: clamp1023(value) } })),
  setServo: (id, degrees) =>
    set((s) => ({
      servo: { ...s.servo, [id]: Math.max(0, Math.min(180, Math.round(degrees))) },
    })),
  setSwitch: (id, on) =>
    set((s) => ({ switchOn: { ...s.switchOn, [id]: on } })),
  setDip: (id, values) =>
    set((s) => ({ dip: { ...s.dip, [id]: values.slice(0, 8) } })),
  setSensor: (id, key, value) =>
    set((s) => ({
      sensors: { ...s.sensors, [id]: { ...s.sensors[id], [key]: value } },
    })),
  setSensors: (id, values) =>
    set((s) => ({
      sensors: { ...s.sensors, [id]: { ...s.sensors[id], ...values } },
    })),
  setLed: (id, patch) =>
    set((s) => ({
      led: {
        ...s.led,
        [id]: {
          on: patch.on ?? s.led[id]?.on ?? false,
          brightness: patch.brightness ?? s.led[id]?.brightness ?? 1,
          color: patch.color ?? s.led[id]?.color ?? 'red',
        },
      },
    })),
  setLcdText: (id, rows) =>
    set((s) => ({ lcdText: { ...s.lcdText, [id]: rows.slice(0, 4) } })),
  setLastKey: (id, key) =>
    set((s) => ({ lastKey: { ...s.lastKey, [id]: key } })),
  setEncoder: (id, steps) =>
    set((s) => ({ encoder: { ...s.encoder, [id]: steps } })),
  setPin: (net, high) =>
    set((s) => ({ pins: { ...s.pins, [net]: high } })),
  setAdc: (net, volts) =>
    set((s) => ({ adcVolts: { ...s.adcVolts, [net]: volts } })),
  bumpTick: () => set((s) => ({ tick: s.tick + 1 })),

  resetPart: (id) =>
    set((s) => {
      const drop = (m: Record<string, unknown>): Record<string, unknown> => {
        const next = { ...m };
        delete next[id];
        return next;
      };
      return {
        pressed: drop(s.pressed) as Record<string, boolean>,
        analog: drop(s.analog) as Record<string, number>,
        servo: drop(s.servo) as Record<string, number>,
        switchOn: drop(s.switchOn) as Record<string, boolean>,
        dip: drop(s.dip) as Record<string, number[]>,
        sensors: drop(s.sensors) as Record<string, Record<string, number | boolean>>,
        led: drop(s.led) as Record<string, LedLive>,
        lcdText: drop(s.lcdText) as Record<string, string[]>,
        lastKey: drop(s.lastKey) as Record<string, string>,
        encoder: drop(s.encoder) as Record<string, number>,
      };
    }),
  resetAll: () =>
    set({
      heartbeat: INITIAL_HEARTBEAT,
      pressed: {},
      analog: {},
      servo: {},
      switchOn: {},
      dip: {},
      sensors: {},
      led: {},
      lcdText: {},
      lastKey: {},
      encoder: {},
      pins: {},
      adcVolts: {},
    }),
}));

/** 0..1023 wiper as a 0..1 fraction (pot knob rotation, LED level…). */
export function analog01(state: Sim3DState, id: string | undefined, fallback = 0): number {
  if (!id) return fallback;
  return (state.analog[id] ?? Math.round(fallback * 1023)) / 1023;
}

/** Servo degrees with a fallback pose. */
export function servoDeg(state: Sim3DState, id: string | undefined, fallback = 90): number {
  if (!id) return fallback;
  return state.servo[id] ?? fallback;
}
