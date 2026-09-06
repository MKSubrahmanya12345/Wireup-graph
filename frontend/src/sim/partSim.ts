/**
 * partSim.ts — bench element ⇄ store wiring (the pushbutton fix).
 *
 * Velxio drives each <wokwi-*> element from PartSimulationRegistry
 * (BasicParts: pushbutton INPUT_PULLUP seeding + button-press/release,
 * ComplexParts: pot wiper → ADC volts, joystick, servo PWM measure, …).
 * This module is the Wireup adaptation for our bench: it attaches the same
 * event contracts to the mounted custom elements and mirrors everything
 * into simStore, so the 2D element, the 3D body and the net solver share
 * one truth. All handlers are defensive: unknown elements simply get no
 * wiring instead of throwing.
 */

import type { BenchPart } from './diagram';
import { identifyPart } from '../three/partIdentity';
import { useSim3D } from '../three/simStore';

export interface ElementNets {
  pin: string;
  net: string;
}

type El = HTMLElement & Record<string, unknown>;

function num(v: unknown, fb: number): number {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fb;
}

/**
 * Attach live wiring for one mounted element. Returns a cleanup fn.
 * `setPin`/`setAdc` commit virtual GPIO (INPUT_PULLUP seeds, ADC volts).
 */
export function wirePartElement(
  el: HTMLElement,
  part: BenchPart,
  pinNets: ElementNets[],
  setPin: (net: string, high: boolean) => void,
  setAdc: (net: string, volts: number) => void,
): () => void {
  const cleanups: (() => void)[] = [];
  const on = (type: string, fn: EventListener): void => {
    el.addEventListener(type, fn);
    cleanups.push(() => el.removeEventListener(type, fn));
  };
  const e = el as El;
  const st = () => useSim3D.getState();
  const firstNet = pinNets[0]?.net;
  const key = identifyPart({ name: part.type, partNumber: part.type }).key;
  const VREF = 5;

  try {
    if (key === 'pushbutton' || key === 'pushbutton-6mm') {
      // INPUT_PULLUP seed: idle HIGH so firmware reads HIGH until pressed.
      if (firstNet) setPin(firstNet, true);
      const press = (): void => {
        if (firstNet) setPin(firstNet, false);
        e.pressed = true;
        st().setPressed(part.id, true);
      };
      const release = (): void => {
        if (firstNet) setPin(firstNet, true);
        e.pressed = false;
        st().setPressed(part.id, false);
      };
      on('button-press', press as EventListener);
      on('button-release', release as EventListener);
    } else if (key === 'slide-switch') {
      const sync = (): void => {
        const v = e.value;
        const isOn = v === 1 || v === '1';
        if (firstNet) setPin(firstNet, isOn);
        st().setSwitch(part.id, isOn);
      };
      sync();
      on('change', sync as EventListener);
      on('input', sync as EventListener);
    } else if (key === 'dip-switch-8') {
      const sync = (): void => {
        const vals = (e.values as number[] | undefined) ?? new Array(8).fill(0);
        vals.slice(0, 8).forEach((v, i) => {
          const net = pinNets[i]?.net;
          if (net) setPin(net, v === 1);
        });
        st().setDip(part.id, vals.map((v) => (v === 1 ? 1 : 0)));
      };
      sync();
      on('change', sync as EventListener);
      on('input', sync as EventListener);
    } else if (key === 'potentiometer' || key === 'slide-potentiometer') {
      const sync = (): void => {
        const raw = Math.max(0, Math.min(1023, Math.round(num(e.value, 512))));
        if (firstNet) setAdc(firstNet, (raw / 1023) * VREF);
        st().setAnalog(part.id, raw);
      };
      sync();
      on('input', sync as EventListener);
      on('change', sync as EventListener);
    } else if (key === 'analog-joystick') {
      const move = (): void => {
        const xv = num((e as El).xValue, 0);
        const yv = num((e as El).yValue, 0);
        const vx = pinNets[0]?.net;
        const vy = pinNets[1]?.net;
        if (vx) setAdc(vx, ((Math.max(-1, Math.min(1, xv)) + 1) / 2) * VREF);
        if (vy) setAdc(vy, ((Math.max(-1, Math.min(1, yv)) + 1) / 2) * VREF);
      };
      const press = (): void => {
        const sw = pinNets[pinNets.length - 1]?.net;
        if (sw) setPin(sw, false);
        st().setPressed(part.id, true);
      };
      const release = (): void => {
        const sw = pinNets[pinNets.length - 1]?.net;
        if (sw) setPin(sw, true);
        st().setPressed(part.id, false);
      };
      move();
      on('input', move as EventListener);
      on('joystick-move', move as EventListener);
      on('button-press', press as EventListener);
      on('button-release', release as EventListener);
    } else if (key === 'ky-040') {
      const sync = (): void => {
        const steps = Math.round(num(e.value, 0));
        st().setEncoder(part.id, steps);
      };
      on('input', sync as EventListener);
      on('change', sync as EventListener);
      const press = (): void => st().setPressed(part.id, true);
      const release = (): void => st().setPressed(part.id, false);
      on('button-press', press as EventListener);
      on('button-release', release as EventListener);
    } else if (key === 'membrane-keypad' || key === 'ir-remote' || key === 'rotary-dialer') {
      const sync = (): void => {
        const k = e.key ?? e.value;
        if (k !== undefined && k !== null && k !== '') st().setLastKey(part.id, String(k));
      };
      on('keypress', sync as EventListener);
      on('input', sync as EventListener);
      on('change', sync as EventListener);
    } else if (key === 'tilt-switch') {
      const toggle = (): void => {
        const next = !(st().pressed[part.id] ?? false);
        if (firstNet) setPin(firstNet, next);
        st().setPressed(part.id, next);
      };
      on('click', toggle as EventListener);
    } else if (
      key === 'photoresistor-sensor' ||
      key === 'gas-sensor' ||
      key === 'mq-2' ||
      key === 'flame-sensor' ||
      key === 'big-sound-sensor' ||
      key === 'small-sound-sensor'
    ) {
      // Seed mid-range volts; panel sliders + 3D keep it live after.
      if (firstNet) setAdc(firstNet, key === 'flame-sensor' ? 4.5 : 2.2);
      const sync = (): void => {
        const raw = e.value;
        if (raw !== undefined && firstNet) {
          setAdc(firstNet, (Math.max(0, Math.min(1023, num(raw, 512))) / 1023) * VREF);
        }
      };
      on('input', sync as EventListener);
    }
  } catch {
    // A hostile element must never break the bench.
  }

  return () => cleanups.forEach((fn) => fn());
}
