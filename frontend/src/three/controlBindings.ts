/**
 * controlBindings.ts — ONE mapping from control → live state.
 *
 * sensorDefs.ts declares WHAT each part can do; this module declares HOW a
 * widget read/write lands in simStore. Both the 3D ControlsPanel and the 2D
 * bench tiles go through here, so dragging the 3D pot knob, moving the
 * panel slider and moving the bench slider all write the same cell.
 *
 * Special channels (beyond generic sensors[id][key]):
 *   pot/slide-pot `value`  → analog wiper 0..1023 (drives knob + ADC volts)
 *   servo/stepper `angle`  → servo degrees (drives horn/shaft)
 *   slide-switch/relay `on`→ switchOn (drives knob/armature + nets)
 *   led/neopixel colour    → led[id] (+ sensors r/g/b for readback)
 *   lcd/oled `lines`       → lcdText rows (drives canvas textures)
 *   keypad/remote keys     → lastKey (+ momentary press cell)
 *   dip keys               → dip[8]
 *   encoder `steps`        → encoder detents
 */

import type { PartControl } from './sensorDefs';
import { useSim3D } from './simStore';

export const LOG_STEPS = 1000;

/** Slider position 0..STEPS → value, log curve (velxio sensorControlConfig). */
export function logSliderToValue(pos: number, min: number, max: number): number {
  const p = Math.min(Math.max(pos, 0), LOG_STEPS) / LOG_STEPS;
  const span = max - min;
  return Math.round(min + Math.pow(10, (p * Math.log10(span + 1))) - 1);
}

/** Inverse: value → slider position. */
export function logValueToSlider(value: number, min: number, max: number): number {
  const span = max - min;
  const v = Math.min(Math.max(value, min), max) - min;
  return Math.round((Math.log10(v + 1) / Math.log10(span + 1)) * LOG_STEPS);
}

function rgbOf(id: string): string {
  const st = useSim3D.getState();
  const sn = st.sensors[id] ?? {};
  const r = Math.max(0, Math.min(255, Number(sn.r ?? 255)));
  const g = Math.max(0, Math.min(255, Number(sn.g ?? 64)));
  const b = Math.max(0, Math.min(255, Number(sn.b ?? 0)));
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

/** Current widget value. */
export function readControl(
  partKey: string,
  id: string,
  control: PartControl,
): number | boolean | string {
  const st = useSim3D.getState();
  if (control.kind === 'toggle') {
    if (control.key === 'on' && (partKey === 'slide-switch' || partKey === 'relay' || partKey === 'power-supply' || partKey === 'ili9341')) {
      return st.switchOn[id] ?? control.def;
    }
    if (control.key === 'ch2') return (st.sensors[id]?.ch2 as boolean | undefined) ?? false;
    if (control.key === 'en') return (st.sensors[id]?.en as boolean | undefined) ?? true;
    if (control.key === 'backlight') return (st.sensors[id]?.backlight as boolean | undefined) ?? true;
    if (partKey === 'led') return st.led[id]?.on ?? true;
    return (st.sensors[id]?.[control.key] as boolean | undefined) ?? control.def;
  }
  if (control.kind === 'slider') {
    if (control.key === 'value' && (partKey === 'potentiometer' || partKey === 'slide-potentiometer')) {
      return st.analog[id] ?? control.def;
    }
    if (control.key === 'angle' && (partKey === 'servo' || partKey === 'mg996r' || partKey === 'stepper-motor' || partKey === 'stepper-28byj' || partKey === 'stepper-nema17' || partKey === 'biaxial-stepper')) {
      return st.servo[id] ?? control.def;
    }
    if (control.key === 'steps' && partKey === 'ky-040') return st.encoder[id] ?? 0;
    if (control.key === 'brightness' && (partKey === 'led' || partKey === 'neopixel-matrix' || partKey === 'led-ring')) {
      return Math.round((st.led[id]?.brightness ?? control.def / 100) * 100);
    }
    if ((control.key === 'r' || control.key === 'g' || control.key === 'b') && (partKey === 'rgb-led' || partKey === 'neopixel')) {
      const fb = control.key === 'r' ? 255 : control.key === 'g' ? 64 : 0;
      return Number(st.sensors[id]?.[control.key] ?? fb);
    }
    if (control.key === 'level' && partKey === 'led-bar-graph') {
      return Number(st.sensors[id]?.level ?? control.def);
    }
    if (control.key === 'digit' && partKey === '7segment') {
      return Number(st.sensors[id]?.digit ?? control.def);
    }
    const v = st.sensors[id]?.[control.key];
    if (typeof v === 'number') return v;
    return control.def;
  }
  if (control.kind === 'text') {
    const rows = st.lcdText[id];
    if (rows && rows.length) return rows.join('\n');
    return control.def;
  }
  // press / keys have no persistent value
  return '';
}

/** Write a widget value. */
export function writeControl(
  partKey: string,
  id: string,
  control: PartControl,
  value: number | boolean | string,
): void {
  const st = useSim3D.getState();
  if (control.kind === 'toggle') {
    const on = value === true || value === 'true' || value === 1;
    if (control.key === 'on' && (partKey === 'slide-switch' || partKey === 'relay' || partKey === 'power-supply' || partKey === 'ili9341')) {
      st.setSwitch(id, on);
      return;
    }
    if (partKey === 'led' && control.key === 'on') {
      st.setLed(id, { on });
      return;
    }
    st.setSensor(id, control.key, on);
    return;
  }
  if (control.kind === 'slider' && typeof value === 'number') {
    if (control.key === 'value' && (partKey === 'potentiometer' || partKey === 'slide-potentiometer')) {
      st.setAnalog(id, value);
      return;
    }
    if (control.key === 'angle' && (partKey === 'servo' || partKey === 'mg996r' || partKey === 'stepper-motor' || partKey === 'stepper-28byj' || partKey === 'stepper-nema17' || partKey === 'biaxial-stepper')) {
      st.setServo(id, value);
      return;
    }
    if (control.key === 'steps' && partKey === 'ky-040') {
      st.setEncoder(id, Math.round(value));
      return;
    }
    if (control.key === 'brightness' && (partKey === 'led' || partKey === 'neopixel-matrix' || partKey === 'led-ring')) {
      st.setLed(id, { brightness: Math.max(0, Math.min(100, value)) / 100 });
      return;
    }
    if ((control.key === 'r' || control.key === 'g' || control.key === 'b') && (partKey === 'rgb-led' || partKey === 'neopixel')) {
      st.setSensor(id, control.key, value);
      st.setLed(id, { color: rgbOf(id), on: true });
      return;
    }
    st.setSensor(id, control.key, value);
    return;
  }
  if (control.kind === 'text' && typeof value === 'string') {
    st.setLcdText(id, value.split('\n'));
  }
}

/** Press-and-hold start (buttons, beeps, PIR, claps, pulses…). */
export function pressStart(partKey: string, id: string): void {
  const st = useSim3D.getState();
  if (partKey === 'tilt-switch') {
    st.setPressed(id, !(st.pressed[id] ?? false));
    return;
  }
  if (partKey === 'big-sound-sensor' || partKey === 'small-sound-sensor') {
    st.setSensor(id, 'soundLevel', 900);
    return;
  }
  if (partKey === 'a4988') {
    st.setServo(id, ((st.servo[id] ?? 0) + 7) % 360);
    return;
  }
  if (partKey === 'neopixel-matrix') {
    st.setLed(id, { color: '#22d3ee', on: true, brightness: 0.8 });
    return;
  }
  if (partKey === 'ds1307') {
    st.setLastKey(id, `tick@${Date.now() % 100000}`);
    return;
  }
  if (partKey === 'ir-receiver') {
    st.setLastKey(id, 'NEC 0x00FF 0x15');
    return;
  }
  if (partKey === 'microsd-card') {
    st.setLastKey(id, 'flushed');
    return;
  }
  st.setPressed(id, true);
}

/** Press-and-hold end. */
export function pressEnd(partKey: string, id: string): void {
  const st = useSim3D.getState();
  if (
    partKey === 'tilt-switch' ||
    partKey === 'a4988' ||
    partKey === 'neopixel-matrix' ||
    partKey === 'ds1307' ||
    partKey === 'ir-receiver' ||
    partKey === 'microsd-card'
  ) {
    return;
  }
  if (partKey === 'big-sound-sensor' || partKey === 'small-sound-sensor') {
    window.setTimeout(() => useSim3D.getState().setSensor(id, 'soundLevel', 512), 250);
    return;
  }
  st.setPressed(id, false);
}

/** Keypad / remote / DIP key tap. */
export function tapKey(partKey: string, id: string, key: string): void {
  const st = useSim3D.getState();
  if (partKey === 'dip-switch-8') {
    const idx = Number(key) - 1;
    if (idx >= 0 && idx < 8) {
      const cur = [...(st.dip[id] ?? [0, 0, 0, 0, 0, 0, 0, 0])];
      cur[idx] = cur[idx] ? 0 : 1;
      st.setDip(id, cur);
    }
    return;
  }
  st.setLastKey(id, key);
  st.setPressed(`${id}:${key}`, true);
  window.setTimeout(() => useSim3D.getState().setPressed(`${id}:${key}`, false), 220);
}
