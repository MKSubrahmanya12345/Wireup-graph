/**
 * circuitSim.ts — honest visual-bench electrics.
 *
 * The browser AVR core only runs the heartbeat program, so per-pin MCU
 * emulation is out of scope here (the ESP32 firmware is compiled and
 * simulated server-side). What IS real in this tab:
 *
 *   1. Continuity: diagram connections union endpoints into nets.
 *   2. Rails: GND-ish nets read LOW, VCC/5V/3V3-ish nets read HIGH.
 *   3. Drivers: pressed buttons short + pull LOW (INPUT_PULLUP idle HIGH),
 *      slide/DIP switches, relay contacts, logic-gate truth tables and the
 *      heartbeat on D13 drive their nets every solve.
 *   4. Real logic ICs, evaluated from their datasheet pinouts every solve:
 *      NE555 astable (f = 1.44/((R1+2·R2)·C), wall-clock phase), CD4017
 *      decade counter (clock edge, reset, inhibit, carry), 74HC595 shift
 *      register (shift/latch edges, MR, OE, QH′ chaining), and full
 *      multi-gate DIP packages (00/02/04/08/14/32/86/4011) with per-gate
 *      evaluation. Sequential parts keep edge state between solves, keyed
 *      by part id and reset on diagram change (resetIcState).
 *   5. Sinks: LEDs light on anode-HIGH + cathode-GND, buzzers on HIGH,
 *      relay coils from their switch cell.
 *   6. Analog: pot wipers and sensor sliders present ADC volts on their
 *      signal net (V = frac × Vref, 5 V class).
 *
 * Honesty limits, stated plainly:
 *   • Clocks are sampled when the store changes (every frame on the bench,
 *     4 Hz on the graph page). A 555 running faster than ~½ the sample rate
 *     aliases — slow it with C for a visible chase. This is captioned in UI.
 *   • Floating CMOS inputs read LOW (Wokwi convention), never metastable.
 *     Active-LOW controls (595 MR/OE, 555 RESET) are honoured only when
 *     their net is actually DRIVEN, so an unwired chip runs free.
 *   • An IC whose VCC/GND pins ARE wired must see supply there; unwired
 *     supply pins assume power so legacy diagrams keep working.
 *
 * solveNets() reads the store and writes nothing except module-level IC
 * edge state; commitSolved() commits levels/volts/LED/IC readouts with
 * change-detection so there is no write loop. The 3D bodies read the same
 * cells, so pressing the 3D cap lights the 2D LED.
 */

import type { BenchConnection, BenchDiagram, BenchPart } from './diagram';
import { identifyPart } from '../three/partIdentity';
import { useSim3D } from '../three/simStore';

/** Canonical net identity for a connection. */
export function netKeyFor(conn: BenchConnection): string {
  const n = (conn.net || '').trim();
  if (n) return n.toUpperCase();
  return `~${conn.fromPart}:${conn.fromPin}~${conn.toPart}:${conn.toPin}`;
}

const GND_PAT = /^(gnd|ground|g\b|0v|vss)$/i;
const VCC_PAT = /^(vcc|5v|5v0|vin|3v3|3\.3v|3v|vdd|v\+|vcc\.0|pwr|power)$/i;

function isGnd(net: string): boolean {
  return GND_PAT.test(net.replace(/^~/, '')) || /(^|_)GND(_|$)/i.test(net);
}

function isVcc(net: string): boolean {
  const n = net.replace(/^~/, '');
  return VCC_PAT.test(n) || /(^|_)(5V|3V3|VCC|VIN)(_|$)/i.test(n);
}

export interface SolvedNets {
  /** Net → driven HIGH? Floating single-endpoint nets read LOW. */
  levels: Record<string, boolean>;
  /** Net → analog volts (pots / analog sensors). */
  volts: Record<string, number>;
  /** Nets with exactly one endpoint (unconnected ends). */
  floating: string[];
  /** Part id → IC readout (output states, frequency, power). Feeds the UI. */
  ic: Record<string, Record<string, number | boolean>>;
}

/** Ordered unique nets touching a part (connection order). */
export function partNets(diagram: BenchDiagram, partId: string): string[] {
  const out: string[] = [];
  for (const c of diagram.connections) {
    if (c.fromPart === partId || c.toPart === partId) {
      const k = netKeyFor(c);
      if (!out.includes(k)) out.push(k);
    }
  }
  return out;
}

/** Pin-level detail: which pin meets which net (for element wiring). */
export function partPinNets(
  diagram: BenchDiagram,
  partId: string,
): { pin: string; net: string }[] {
  const out: { pin: string; net: string }[] = [];
  for (const c of diagram.connections) {
    if (c.fromPart === partId && c.fromPin) out.push({ pin: c.fromPin, net: netKeyFor(c) });
    if (c.toPart === partId && c.toPin) out.push({ pin: c.toPin, net: netKeyFor(c) });
  }
  return out;
}

type GateFn = (ins: boolean[]) => boolean;

function gateFor(type: string): { fn: GateFn; inputs: number } | null {
  const t = type.toLowerCase();
  const pick = (fn: GateFn, inputs: number): { fn: GateFn; inputs: number } => ({ fn, inputs });
  if (/xnor/.test(t)) return pick((i) => !(i[0] !== i[1]), 2);
  if (/xor|74hc86/.test(t)) return pick((i) => i[0] !== i[1], 2);
  if (/nand|74hc00/.test(t)) return pick((i) => !(i[0] && i[1]), 2);
  if (/nor|74hc02/.test(t)) return pick((i) => !(i[0] || i[1]), 2);
  if (/\bnot\b|inverter|74hc04|74hc14/.test(t)) return pick((i) => !i[0], 1);
  if (/\band\b|74hc08/.test(t)) {
    const n = /-4$|4-input/.test(t) ? 4 : /-3$|3-input/.test(t) ? 3 : 2;
    return pick((i) => i.slice(0, n).every(Boolean), n);
  }
  if (/\bor\b|74hc32/.test(t)) {
    const n = /-4$|4-input/.test(t) ? 4 : /-3$|3-input/.test(t) ? 3 : 2;
    return pick((i) => i.slice(0, n).some(Boolean), n);
  }
  return null;
}

/* ── Logic-IC engine (datasheet pinouts) ─────────────────────────────────── */

type PinName = string | number;

interface PinNets {
  pin: string;
  net: string;
}

/** First net whose pin name matches any alias (case-insensitive). */
function pinNet(pinNets: PinNets[], names: PinName[]): string | null {
  for (const want of names) {
    const w = String(want).toLowerCase();
    const hit = pinNets.find((e) => e.pin.toLowerCase() === w);
    if (hit) return hit.net;
  }
  return null;
}

type Bool2 = (a: boolean, b: boolean) => boolean;
const NAND2: Bool2 = (a, b) => !(a && b);
const NOR2: Bool2 = (a, b) => !(a || b);
const AND2: Bool2 = (a, b) => a && b;
const OR2: Bool2 = (a, b) => a || b;
const XOR2: Bool2 = (a, b) => a !== b;
const NOT1 = (a: boolean): boolean => !a;

interface GatePinDef {
  a: number;
  b: number | null;
  y: number;
  fn: (a: boolean, b: boolean) => boolean;
}

interface GatePackage {
  vcc: number;
  gnd: number;
  gates: GatePinDef[];
}

/** Full DIP pinouts — pin 1 is the dot, inputs by NUMBER, outputs driven. */
const GATE_PACKAGES: Record<string, GatePackage> = {
  hc00: {
    vcc: 14,
    gnd: 7,
    gates: [
      { a: 1, b: 2, y: 3, fn: NAND2 },
      { a: 5, b: 6, y: 4, fn: NAND2 },
      { a: 8, b: 9, y: 10, fn: NAND2 },
      { a: 13, b: 12, y: 11, fn: NAND2 },
    ],
  },
  cd4011: {
    vcc: 14,
    gnd: 7,
    gates: [
      { a: 1, b: 2, y: 3, fn: NOR2 },
      { a: 5, b: 6, y: 4, fn: NOR2 },
      { a: 8, b: 9, y: 10, fn: NOR2 },
      { a: 13, b: 12, y: 11, fn: NOR2 },
    ],
  },
  hc02: {
    vcc: 14,
    gnd: 7,
    gates: [
      { a: 2, b: 3, y: 1, fn: NOR2 },
      { a: 6, b: 5, y: 4, fn: NOR2 },
      { a: 8, b: 9, y: 10, fn: NOR2 },
      { a: 12, b: 13, y: 11, fn: NOR2 },
    ],
  },
  hc04: {
    vcc: 14,
    gnd: 7,
    gates: [
      { a: 1, b: null, y: 2, fn: (a) => NOT1(a) },
      { a: 3, b: null, y: 4, fn: (a) => NOT1(a) },
      { a: 5, b: null, y: 6, fn: (a) => NOT1(a) },
      { a: 9, b: null, y: 8, fn: (a) => NOT1(a) },
      { a: 11, b: null, y: 10, fn: (a) => NOT1(a) },
      { a: 13, b: null, y: 12, fn: (a) => NOT1(a) },
    ],
  },
  hc08: {
    vcc: 14,
    gnd: 7,
    gates: [
      { a: 1, b: 2, y: 3, fn: AND2 },
      { a: 5, b: 6, y: 4, fn: AND2 },
      { a: 8, b: 9, y: 10, fn: AND2 },
      { a: 12, b: 13, y: 11, fn: AND2 },
    ],
  },
  hc32: {
    vcc: 14,
    gnd: 7,
    gates: [
      { a: 1, b: 2, y: 3, fn: OR2 },
      { a: 5, b: 6, y: 4, fn: OR2 },
      { a: 8, b: 9, y: 10, fn: OR2 },
      { a: 12, b: 13, y: 11, fn: OR2 },
    ],
  },
  hc86: {
    vcc: 14,
    gnd: 7,
    gates: [
      { a: 1, b: 2, y: 3, fn: XOR2 },
      { a: 5, b: 6, y: 4, fn: XOR2 },
      { a: 8, b: 9, y: 10, fn: XOR2 },
      { a: 12, b: 13, y: 11, fn: XOR2 },
    ],
  },
};

interface IcState {
  clk: boolean;
  srclk: boolean;
  rclk: boolean;
  count: number;
  reg: number;
  latch: number;
  t0: number;
}

const freshIc = (): IcState => ({ clk: false, srclk: false, rclk: false, count: 0, reg: 0, latch: 0, t0: 0 });

const icState = new Map<string, IcState>();
let icSource = '';

/** Clear sequential-IC edge state (whole bench, or one part). */
export function resetIcState(id?: string): void {
  if (id === undefined) {
    icState.clear();
    icSource = '';
  } else {
    icState.delete(id);
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

export function solveNets(diagram: BenchDiagram): SolvedNets {
  const st = useSim3D.getState();
  const now = Date.now();

  // A new diagram means new silicon: drop stale flip-flop/shift/counter state.
  if (diagram.source !== icSource) {
    icState.clear();
    icSource = diagram.source;
  }

  // Union-find for contact shorts (pressed buttons, closed relays, tilt).
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    // path halve
    let c = x;
    while (parent.get(c) !== undefined && parent.get(c) !== r) {
      const nxt = parent.get(c)!;
      parent.set(c, r);
      c = nxt;
    }
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const nets = new Set<string>();
  const endpoints = new Map<string, number>();
  for (const c of diagram.connections) {
    const k = netKeyFor(c);
    nets.add(k);
    endpoints.set(k, (endpoints.get(k) ?? 0) + 2);
    if (!parent.has(k)) parent.set(k, k);
  }

  const keyOf = (p: BenchPart): string => identifyPart({ name: p.type, partNumber: p.type }).key;

  // Contact shorts first (they merge nets).
  for (const p of diagram.parts) {
    const key = keyOf(p);
    const ns = partNets(diagram, p.id);
    if (ns.length < 2) continue;
    if (key === 'pushbutton' || key === 'pushbutton-6mm') {
      if (st.pressed[p.id] === true) union(ns[0], ns[1]);
    } else if (key === 'tilt-switch') {
      if (st.pressed[p.id] === true) union(ns[0], ns[1]);
    } else if (key === 'relay' || key === 'ks2e-m-dc5') {
      if (st.switchOn[p.id] === true) union(ns[0], ns[1]);
    }
  }

  const level = new Map<string, boolean>();
  const driven = new Set<string>();

  // Rails.
  for (const n of nets) {
    const r = find(n);
    if (isGnd(n)) {
      level.set(r, false);
      driven.add(r);
    } else if (isVcc(n)) {
      if (!driven.has(r)) {
        level.set(r, true);
        driven.add(r);
      }
    }
  }

  const drive = (net: string, high: boolean): void => {
    const r = find(net);
    if (driven.has(r)) {
      // A short between power and ground is a fault, not a state: LOW wins
      // and the UI flags it via the floating/fault note. Never oscillate.
      if (level.get(r) === true && high === false) level.set(r, false);
      return;
    }
    level.set(r, high);
    driven.add(r);
  };

  const lvl = (net: string): boolean => level.get(find(net)) ?? false;
  const netDriven = (net: string): boolean => driven.has(find(net));

  // IC supply rule: a WIRED VCC/GND pin must see supply; unwired supply
  // pins assume power so legacy diagrams keep working.
  const poweredFor = (pp: PinNets[], vccNames: PinName[], gndNames: PinName[]): boolean => {
    const vcc = pinNet(pp, vccNames);
    const gnd = pinNet(pp, gndNames);
    const vOk = vcc === null ? true : lvl(vcc);
    const gOk = gnd === null ? true : !lvl(gnd);
    return vOk && gOk;
  };

  const stateFor = (id: string): { s: IcState; fresh: boolean } => {
    const prev = icState.get(id);
    if (prev) return { s: prev, fresh: false };
    const s = freshIc();
    icState.set(id, s);
    return { s, fresh: true };
  };

  // Active drivers (combinational parts first).
  for (const p of diagram.parts) {
    const key = keyOf(p);
    const ns = partNets(diagram, p.id);
    if (ns.length === 0) continue;
    if (key === 'pushbutton' || key === 'pushbutton-6mm') {
      // INPUT_PULLUP seed: idle HIGH, press pulls the (shorted) net LOW.
      if (st.pressed[p.id] === true) drive(ns[0], false);
      else if (!driven.has(find(ns[0]))) drive(ns[0], true);
    } else if (key === 'slide-switch') {
      drive(ns[0], st.switchOn[p.id] ?? false);
    } else if (key === 'dip-switch-8') {
      const vals = st.dip[p.id] ?? [];
      ns.slice(0, 8).forEach((n, i) => drive(n, (vals[i] ?? 0) === 1));
    } else if (key === 'tilt-switch') {
      drive(ns[0], st.pressed[p.id] === true);
    } else if (key === 'ttp223' || key === 'sw420') {
      // Touch / vibration: active-HIGH digital out while stimulated.
      drive(ns[0], st.pressed[p.id] === true);
    } else if (key === 'analog-joystick') {
      // SW idle HIGH (pull-up), pressed LOW.
      const swNet = ns[ns.length - 1];
      drive(swNet, !(st.pressed[p.id] === true));
    } else if (key === 'logic-ic' || key.startsWith('logic-gate') || key.startsWith('flip-flop') || key.startsWith('ic-74hc')) {
      const g = gateFor(`${p.type} ${key}`);
      if (g && ns.length > g.inputs) {
        const ins = ns.slice(0, g.inputs).map((n) => level.get(find(n)) ?? false);
        drive(ns[g.inputs], g.fn(ins));
      }
    }
  }

  // Heartbeat onto D13-class nets (board pin *13*/PB5/LED).
  const hb = st.heartbeat.ledOn;
  for (const c of diagram.connections) {
    for (const [partId, pin] of [
      [c.fromPart, c.fromPin],
      [c.toPart, c.toPin],
    ] as [string, string][]) {
      if (/^(d)?13$|pb5|led|sck/i.test(pin)) {
        const part = diagram.parts.find((q) => q.id === partId);
        const fam = part ? identifyPart({ name: part.type, partNumber: part.type }).family : 'generic';
        if (fam === 'board' || fam === 'generic') drive(netKeyFor(c), hb);
      }
    }
  }

  const ic: SolvedNets['ic'] = {};

  // ── Pass A: oscillators + combinational gate packages ──────────────────
  for (const p of diagram.parts) {
    const key = keyOf(p);
    if (key === 'ne555') {
      const pp = partPinNets(diagram, p.id);
      const outNet = pinNet(pp, [3, 'out', 'output']);
      const powered = poweredFor(pp, [8, 'vcc', '5v', 'v+'], [1, 'gnd', 'ground']);
      const sn = st.sensors[p.id] ?? {};
      // Sliders speak kΩ and µF (human units); the formula wants Ω and F.
      const r1 = Math.max(100, Number(sn.r1 ?? 1) * 1000);
      const r2 = Math.max(100, Number(sn.r2 ?? 100) * 1000);
      const c = Math.max(1e-9, Number(sn.c ?? 10) / 1e6);
      const f = 1.44 / ((r1 + 2 * r2) * c);
      const duty = (r1 + r2) / (r1 + 2 * r2);
      const { s } = stateFor(p.id);
      if (!s.t0) s.t0 = now;
      const period = 1 / Math.max(f, 1e-6);
      const phase = ((((now - s.t0) / 1000) % period) + period) % period / period;
      let out = powered && phase < duty;
      // RESET (pin 4, active LOW) holds OUT low — but only when driven,
      // so an unwired 555 still runs free like real CMOS-with-pullup.
      const rstNet = pinNet(pp, [4, 'reset', 'rst', 'mr']);
      if (rstNet && netDriven(rstNet) && !lvl(rstNet)) out = false;
      if (outNet) drive(outNet, out);
      ic[p.id] = { f: round2(f), duty: round2(duty), out, powered };
    } else if (GATE_PACKAGES[key]) {
      const pkg = GATE_PACKAGES[key];
      const pp = partPinNets(diagram, p.id);
      const powered = poweredFor(pp, [pkg.vcc, 'vcc', 'vdd'], [pkg.gnd, 'gnd', 'vss']);
      const readout: Record<string, number | boolean> = { powered };
      pkg.gates.forEach((g, i) => {
        const na = pinNet(pp, [g.a, `a${g.a}`, `in${g.a}`]);
        const nb = g.b === null ? null : pinNet(pp, [g.b, `b${g.b}`, `in${g.b}`]);
        const ny = pinNet(pp, [g.y, `y${g.y}`, `out${g.y}`, 'out', 'output']);
        // A gate whose inputs are not BOTH found stays undriven — partial
        // honesty beats a guessed truth table.
        if (!na || (g.b !== null && !nb)) return;
        const y = powered && g.fn(lvl(na), nb ? lvl(nb) : false);
        readout[`y${i + 1}`] = y;
        if (ny) drive(ny, y);
      });
      ic[p.id] = readout;
    }
  }

  // ── Pass B: edge-triggered sequential ICs (4017 / 165 / 595) ───────────
  for (const p of diagram.parts) {
    const key = keyOf(p);
    if (key === 'cd4017') {
      const pp = partPinNets(diagram, p.id);
      const clkNet = pinNet(pp, [14, 'clk', 'clock', 'cl']);
      const rstNet = pinNet(pp, [15, 'rst', 'reset', 'mr']);
      const inhNet = pinNet(pp, [13, 'inh', 'inhibit', 'ci', 'clock-inhibit']);
      const powered = poweredFor(pp, [16, 'vdd', 'vcc'], [8, 'vss', 'gnd']);
      const clk = clkNet ? lvl(clkNet) : false;
      const rst = rstNet ? lvl(rstNet) : false;
      const inh = inhNet ? lvl(inhNet) : false;
      const { s, fresh } = stateFor(p.id);
      if (fresh) s.clk = clk; // never invent an edge on first sight
      let count = s.count;
      if (st.pressed[p.id] === true || rst) count = 0;
      else if (powered && clk && !s.clk && !inh) count = (count + 1) % 10;
      s.clk = clk;
      s.count = count;
      // Q0..Q9 live on DIP pins 3,2,4,7,10,1,5,6,9,11 (datasheet order).
      const qPins = [3, 2, 4, 7, 10, 1, 5, 6, 9, 11];
      const readout: Record<string, number | boolean> = { count, powered };
      qPins.forEach((pin, i) => {
        const n = pinNet(pp, [pin, `q${i}`]);
        const high = powered && count === i;
        readout[`q${i}`] = high;
        if (n) drive(n, high);
      });
      const coNet = pinNet(pp, [12, 'co', 'carry', 'cout']);
      const co = powered && count < 5;
      readout.co = co;
      if (coNet) drive(coNet, co);
      ic[p.id] = readout;
    } else if (key === 'hc165') {
      // 74HC165 parallel-in shift register (DIP-16): SH/LD (1, active LOW)
      // or hold-to-load samples D0–D7; CLK ↑ (2, gated by CLK INH 15)
      // shifts SER (10) in; QH (9) reads out, QH′ (7) chains.
      const pp = partPinNets(diagram, p.id);
      const ldNet = pinNet(pp, [1, 'shld', 'sh-ld', 'load', 'pl']);
      const clkNet = pinNet(pp, [2, 'clk', 'clock', 'cp']);
      const inhNet = pinNet(pp, [15, 'clk-inh', 'inh', 'ce']);
      const serNet = pinNet(pp, [10, 'ser', 'ds', 'data', 'din']);
      const powered = poweredFor(pp, [16, 'vcc'], [8, 'gnd']);
      const load = st.pressed[p.id] === true || (ldNet !== null && netDriven(ldNet) && !lvl(ldNet));
      const clk = clkNet ? lvl(clkNet) : false;
      const inh = inhNet ? lvl(inhNet) : false;
      const ser = serNet ? lvl(serNet) : false;
      const { s, fresh } = stateFor(p.id);
      if (fresh) s.clk = clk;
      // Parallel inputs A–H on pins 11,12,13,14,3,4,5,6. SER enters at
      // the A end and QH reads the H stage, so A is bit 0, H is bit 7.
      const dPins = [11, 12, 13, 14, 3, 4, 5, 6];
      if (load) {
        let reg = 0;
        dPins.forEach((pin, i) => {
          const n = pinNet(pp, [pin, `d${i}`]);
          if (n && lvl(n)) reg |= 1 << i;
        });
        s.reg = reg;
      } else if (powered && clk && !s.clk && !inh) {
        s.reg = ((s.reg << 1) | (ser ? 1 : 0)) & 0xff;
      }
      s.clk = clk;
      const qh = powered && ((s.reg >> 7) & 1) === 1;
      const qhNet = pinNet(pp, [9, 'qh', 'q']);
      if (qhNet) drive(qhNet, qh);
      const qhpNet = pinNet(pp, [7, 'qhp', "qh'", 'qhs']);
      // QH′ (pin 7) is the COMPLEMENT of QH — the chaining tap.
      const qhp = powered && !qh;
      if (qhpNet) drive(qhpNet, qhp);
      ic[p.id] = { reg: s.reg, qh, powered };
    } else if (key === 'hc595') {
      const pp = partPinNets(diagram, p.id);
      const serNet = pinNet(pp, [14, 'ser', 'ds', 'data', 'din']);
      const srclkNet = pinNet(pp, [11, 'srclk', 'sck', 'shift', 'shcp']);
      const rclkNet = pinNet(pp, [12, 'rclk', 'latch', 'stcp']);
      const clrNet = pinNet(pp, [10, 'srclr', 'mr', 'reset', 'clr']);
      const oeNet = pinNet(pp, [13, 'oe', 'g']);
      const powered = poweredFor(pp, [16, 'vcc'], [8, 'gnd']);
      const ser = serNet ? lvl(serNet) : false;
      const sr = srclkNet ? lvl(srclkNet) : false;
      const rr = rclkNet ? lvl(rclkNet) : false;
      const { s, fresh } = stateFor(p.id);
      if (fresh) {
        s.srclk = sr;
        s.rclk = rr;
      }
      // MR (active LOW, driven only) clears the SHIFT register; the latch
      // keeps its old byte until the next RCLK — exactly like silicon.
      if (st.pressed[p.id] === true || (clrNet && netDriven(clrNet) && !lvl(clrNet))) {
        s.reg = 0;
      } else if (powered && sr && !s.srclk) {
        s.reg = ((s.reg << 1) | (ser ? 1 : 0)) & 0xff;
      }
      if (powered && rr && !s.rclk) s.latch = s.reg;
      s.srclk = sr;
      s.rclk = rr;
      // QH′ (pin 9) always follows the top of the shift register, so chips
      // chain even while the parallel outputs are disabled by OE.
      const qhNet = pinNet(pp, [9, 'qh', 'qhs', 'serial-out', "qh'"]);
      const qh = powered && ((s.reg >> 7) & 1) === 1;
      if (qhNet) drive(qhNet, qh);
      // OE HIGH (driven) floats Q0–Q7; floating OE means enabled.
      const disabled = oeNet !== null && netDriven(oeNet) && lvl(oeNet);
      const qPins = [15, 1, 2, 3, 4, 5, 6, 7];
      const readout: Record<string, number | boolean> = { reg: s.reg, latch: s.latch, qh, powered };
      qPins.forEach((pin, i) => {
        const letter = 'abcdefgh'[i];
        const n = pinNet(pp, [pin, `q${i}`, `q${letter}`]);
        const high = powered && !disabled && ((s.latch >> i) & 1) === 1;
        readout[`q${i}`] = high;
        if (n) drive(n, high);
      });
      ic[p.id] = readout;
    }
  }

  // Analog volts: wiper / sensor level → signal net.
  const volts: Record<string, number> = {};
  const VREF = 5;
  for (const p of diagram.parts) {
    const key = keyOf(p);
    const ns = partNets(diagram, p.id);
    if (ns.length === 0) continue;
    if (key === 'potentiometer' || key === 'slide-potentiometer') {
      const frac = (st.analog[p.id] ?? 512) / 1023;
      volts[find(ns[0])] = frac * VREF;
    } else if (key === 'photoresistor-sensor' || key === 'photodiode') {
      const lux = Number(st.sensors[p.id]?.lux ?? 500);
      volts[find(ns[0])] = (Math.max(0, Math.min(1000, lux)) / 1000) * VREF;
    } else if (key === 'gas-sensor' || key === 'mq-2' || key === 'big-sound-sensor' || key === 'small-sound-sensor') {
      const raw = Number(st.sensors[p.id]?.gasLevel ?? st.sensors[p.id]?.soundLevel ?? 512);
      volts[find(ns[0])] = (Math.max(0, Math.min(1023, raw)) / 1023) * VREF;
    } else if (key === 'flame-sensor') {
      const raw = Number(st.sensors[p.id]?.intensity ?? 0);
      volts[find(ns[0])] = VREF - (Math.max(0, Math.min(1023, raw)) / 1023) * VREF;
    } else if (key === 'rain-plate' || key === 'soil-resistive') {
      // Wet shorts the exposed traces: output sits HIGH when dry, falls wet.
      const wet = Number(st.sensors[p.id]?.wetness ?? st.sensors[p.id]?.moisture ?? 20);
      volts[find(ns[0])] = VREF - (Math.max(0, Math.min(100, wet)) / 100) * VREF;
    } else if (key === 'water-level') {
      const lvl = Number(st.sensors[p.id]?.level ?? 30);
      volts[find(ns[0])] = (Math.max(0, Math.min(100, lvl)) / 100) * VREF;
    } else if (key === 'ntc-temperature-sensor') {
      const t = Number(st.sensors[p.id]?.temperature ?? 25);
      // β-model divider, 10 k pull-up (matches the 3D note).
      const r = 10_000 * Math.exp(3950 * (1 / (t + 273.15) - 1 / 298.15));
      volts[find(ns[0])] = VREF * (r / (r + 10_000));
    }
  }

  const levels: Record<string, boolean> = {};
  const floating: string[] = [];
  for (const n of nets) {
    const r = find(n);
    if ((endpoints.get(n) ?? 0) <= 2 && !driven.has(r) && !isGnd(n) && !isVcc(n)) {
      floating.push(n);
    }
    levels[n] = level.get(r) ?? false;
  }
  return { levels, volts, floating, ic };
}

/** LED sink rule: anode HIGH and cathode on a real LOW (not floating). */
export function ledOnForPart(
  diagram: BenchDiagram,
  solved: SolvedNets,
  partId: string,
  storeOn?: boolean,
): boolean {
  const ns = partNets(diagram, partId);
  if (storeOn !== undefined) return storeOn;
  if (ns.length < 2) {
    // Single-net LED (bench shorthand): follows its net.
    return ns.length === 1 ? (solved.levels[ns[0]] ?? false) : false;
  }
  const anodeHigh = solved.levels[ns[0]] ?? false;
  const cathode = ns[1];
  const cathodeLow = (solved.levels[cathode] ?? false) === false && !solved.floating.includes(cathode);
  const cathodeRail = isGnd(cathode);
  return anodeHigh && (cathodeLow || cathodeRail);
}

/** Parts whose `on` cell is owned by their nets (never by a hand toggle). */
const NET_DRIVEN_LEDS = new Set(['led', 'rgb-led', 'neopixel', 'neopixel-matrix', 'led-ring']);

/**
 * Commit solved levels + volts + LED drive + IC readouts into the store's
 * virtual GPIO with change-detection (no write → no loop). One function
 * serves the 2D bench diagram and the adapted architecture graph alike.
 */
export function commitSolved(diagram: BenchDiagram, solved: SolvedNets): void {
  const st = useSim3D.getState();
  for (const [net, high] of Object.entries(solved.levels)) {
    if (st.pins[net] !== high) st.setPin(net, high);
  }
  for (const [net, v] of Object.entries(solved.volts)) {
    if (Math.abs((st.adcVolts[net] ?? -1) - v) > 0.005) st.setAdc(net, v);
  }
  for (const p of diagram.parts) {
    const key = identifyPart({ name: p.type, partNumber: p.type }).key;
    if (NET_DRIVEN_LEDS.has(key)) {
      // Wired LEDs follow their nets — a real LED has no software switch.
      if (partNets(diagram, p.id).length > 0) {
        const on = ledOnForPart(diagram, solved, p.id);
        if ((st.led[p.id]?.on ?? false) !== on) st.setLed(p.id, { on });
      }
    }
    const readout = solved.ic[p.id];
    if (readout) {
      const cur = st.sensors[p.id] ?? {};
      let diff = false;
      for (const [k, v] of Object.entries(readout)) {
        if (cur[k] !== v) {
          diff = true;
          break;
        }
      }
      if (diff) st.setSensors(p.id, readout);
    }
  }
}
