/**
 * Page 03's live bench.
 *
 * What is real here, precisely:
 *  • The circuit drawn below is the diagram the pipeline actually generated
 *    (`diagram.json` / `hardware/universal-diagram.json` out of the firmware
 *    zip), rendered with the real @wokwi/elements custom elements.
 *  • The heartbeat driving the animation is an avr8js ATmega328p executing
 *    assembled AVR machine code in this tab (see src/sim/avrProgram.ts).
 *  • Every interactive part is WIRED (src/sim/partSim.ts): pushbuttons seed
 *    INPUT_PULLUP and pull LOW on press, pots drive ADC volts, slide/DIP
 *    switches, encoders, joysticks and keypads all write the shared live
 *    store — the velxio BasicParts/ComplexParts contracts, adapted.
 *  • Nets are SOLVED (src/sim/circuitSim.ts): continuity + rails + drivers
 *    + gate truth tables, so a pressed button lights the LED on its net.
 *  • The sensor values shown are the samples the HardwareSimProvider returned
 *    for THIS build — replayed, not invented — blended with the live slider
 *    state you set on each tile.
 *
 * What is NOT happening: your ESP32 firmware is not running in the browser.
 * avr8js simulates AVR silicon; the ESP32 image is compiled and simulated
 * server-side (g++/PlatformIO + the hardware sim provider). This panel says so
 * on screen rather than implying otherwise.
 */
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { diagramFromFiles, diagramPartKey } from '../sim/diagram';
import type { BenchDiagram, BenchPart, BenchSample } from '../sim/diagram';
import { useAvrHeartbeat } from '../sim/useAvrHeartbeat';
import { commitSolved, ledOnForPart, netKeyFor, partNets, partPinNets, resetIcState, solveNets } from '../sim/circuitSim';
import { wirePartElement } from '../sim/partSim';
import { defForKey } from '../three/sensorDefs';
import type { PartControl } from '../three/sensorDefs';
import {
  LOG_STEPS,
  logSliderToValue,
  logValueToSlider,
  pressEnd,
  pressStart,
  readControl,
  tapKey,
  writeControl,
} from '../three/controlBindings';
import { useSim3D } from '../three/simStore';

/** @wokwi/elements registers its custom elements as a side effect of import.
 *  Loaded lazily so a browser without customElements never breaks the page. */
function useWokwiElements(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    import('@wokwi/elements')
      .then(() => alive && setReady(true))
      .catch(() => alive && setReady(false));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

function tagRegistered(tag: string | null): boolean {
  if (!tag) return false;
  try {
    return typeof customElements !== 'undefined' && customElements.get(tag) !== undefined;
  } catch {
    return false;
  }
}

/** Renders one Wokwi custom element, wires its sim events, pushes live props. */
function WokwiElementView({
  part,
  tag,
  attrs,
  props,
  pinNets,
}: {
  part: BenchPart;
  tag: string;
  attrs: Record<string, string | number | boolean>;
  props: Record<string, unknown> | undefined;
  pinNets: { pin: string; net: string }[];
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  }, [attrs]);

  useEffect(() => {
    const el = ref.current as (HTMLElement & Record<string, unknown>) | null;
    if (!el || !props) return;
    for (const [key, value] of Object.entries(props)) {
      try {
        el[key] = value;
      } catch {
        /* unknown prop — element ignores it */
      }
    }
  }, [props]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const st = useSim3D.getState();
    return wirePartElement(
      el,
      part,
      pinNets,
      (net, high) => st.setPin(net, high),
      (net, volts) => st.setAdc(net, volts),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part.id, tag]);

  return createElement(tag, { ref });
}

/** Part types with no @wokwi/elements model — drawn honestly as a stub tile. */
function PlaceholderPart({ part, standIn }: { part: BenchPart; standIn: boolean }) {
  return (
    <div className="bench-placeholder" title={standIn ? `Shown in 3D at true scale; 2D tile is a stand-in` : `No Wokwi element for ${part.type}`}>
      <span className="bench-placeholder-chip">{part.model ?? part.type}</span>
      <span className="tiny muted">{standIn ? '2D stand-in · exact in 3D' : 'no visual model · exact in 3D'}</span>
    </div>
  );
}

/** Live props for the parts that react — read from the shared live store. */
function liveProps(
  part: BenchPart,
  _partKey: string,
  solved: ReturnType<typeof solveNets>,
  diagram: BenchDiagram,
  heartbeatOn: boolean,
): Record<string, unknown> | undefined {
  const st = useSim3D.getState();
  const id = part.id;
  switch (part.tag) {
    case 'wokwi-led': {
      // Wired LEDs follow their net (commitSolved keeps the store cell in
      // sync, so 2D and 3D agree). An unwired LED has no net to follow, so
      // it mirrors the heartbeat clock.
      const wired = partNets(diagram, id).length > 0;
      const on = wired ? ledOnForPart(diagram, solved, id) : heartbeatOn;
      return { value: on, color: st.led[id]?.color ?? 'red', label: part.id };
    }
    case 'wokwi-rgb-led': {
      const sn = st.sensors[id] ?? {};
      return {
        red: Number(sn.r ?? 255) / 255,
        green: Number(sn.g ?? 64) / 255,
        blue: Number(sn.b ?? 0) / 255,
      };
    }
    case 'wokwi-neopixel':
    case 'wokwi-neopixel-matrix': {
      const sn = st.sensors[id] ?? {};
      return { r: Number(sn.r ?? 255), g: Number(sn.g ?? 64), b: Number(sn.b ?? 0) };
    }
    case 'wokwi-buzzer':
      return { hasSignal: st.pressed[id] === true || st.switchOn[id] === true };
    case 'wokwi-ks2e-m-dc5':
      return { on: st.switchOn[id] === true };
    case 'wokwi-servo':
      return { angle: st.servo[id] ?? 90 };
    case 'wokwi-stepper-motor':
      return { angle: st.servo[id] ?? 0 };
    case 'wokwi-pir-motion-sensor':
      return { sensing: st.pressed[id] === true };
    case 'wokwi-pushbutton':
      return { pressed: st.pressed[id] === true };
    case 'wokwi-potentiometer':
    case 'wokwi-slide-potentiometer':
      return { value: st.analog[id] ?? 512 };
    case 'wokwi-7segment':
      return { value: Number(st.sensors[id]?.digit ?? 8) };
    case 'wokwi-membrane-keypad':
      return { key: st.lastKey[id] ?? '' };
    case 'wokwi-lcd1602': {
      const rows = st.lcdText[id];
      return rows ? { text: rows.join('\n') } : undefined;
    }
    default:
      return undefined;
  }
}

/* ── Tile controls (mini widgets, same bindings as the 3D panel) ───────── */

function TileControl({ partKey, partId, control }: { partKey: string; partId: string; control: PartControl }) {
  useSim3D();
  if (control.kind === 'slider') {
    const raw = readControl(partKey, partId, control);
    const value = typeof raw === 'number' ? raw : control.def;
    const pos = control.log ? logValueToSlider(value, control.min, control.max) : value;
    return (
      <label className="tile-ctl" title={control.label}>
        <span>
          {control.label} <b>{control.decimals !== undefined ? value.toFixed(control.decimals) : Math.round(value * 100) / 100}{control.unit ? ` ${control.unit}` : ''}</b>
        </span>
        <input
          type="range"
          min={control.log ? 0 : control.min}
          max={control.log ? LOG_STEPS : control.max}
          step={control.log ? 1 : control.step}
          value={pos}
          onChange={(e) => {
            const p = Number(e.target.value);
            writeControl(partKey, partId, control, control.log ? logSliderToValue(p, control.min, control.max) : p);
          }}
          aria-label={control.label}
        />
      </label>
    );
  }
  if (control.kind === 'press') {
    return (
      <button
        type="button"
        className="tile-ctl-btn"
        onPointerDown={() => pressStart(partKey, partId)}
        onPointerUp={() => pressEnd(partKey, partId)}
        onPointerLeave={() => pressEnd(partKey, partId)}
        title={control.hint ?? control.label}
      >
        {control.label} ⏺
      </button>
    );
  }
  if (control.kind === 'toggle') {
    const raw = readControl(partKey, partId, control);
    const on = raw === true;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`tile-ctl-btn${on ? ' on' : ''}`}
        onClick={() => writeControl(partKey, partId, control, !on)}
      >
        {control.label}: {on ? 'ON' : 'OFF'}
      </button>
    );
  }
  if (control.kind === 'keys') {
    return (
      <span className="tile-ctl-keys">
        {control.keys.slice(0, 8).map((k) => (
          <button key={k} type="button" onClick={() => tapKey(partKey, partId, k)} title={`Tap ${k}`}>
            {k}
          </button>
        ))}
        {control.keys.length > 8 ? <span className="tiny muted">+{control.keys.length - 8} in 3D</span> : null}
      </span>
    );
  }
  // text: single-line editor on the tile (full editor lives in 3D).
  const raw = readControl(partKey, partId, control);
  return (
    <input
      className="tile-ctl-text"
      value={typeof raw === 'string' ? raw.split('\n')[0] : control.def.split('\n')[0]}
      onChange={(e) => {
        const rows = String(readControl(partKey, partId, control) || '').split('\n');
        rows[0] = e.target.value;
        writeControl(partKey, partId, control, rows.join('\n'));
      }}
      aria-label={control.label}
    />
  );
}

function TileControls({ partKey, partId }: { partKey: string; partId: string }) {
  const def = defForKey(partKey);
  if (def.controls.length === 0) return null;
  return (
    <div className="tile-controls">
      {def.controls.slice(0, 4).map((c) => (
        <TileControl key={c.key} partKey={partKey} partId={partId} control={c} />
      ))}
      {def.controls.length > 4 ? <span className="tiny muted">+{def.controls.length - 4} more in the 3D inspector</span> : null}
    </div>
  );
}

/* ── Bench ─────────────────────────────────────────────────────────────── */

export interface WokwiBenchProps {
  /** Files to look for a diagram in (the firmware zip, usually). */
  files: { path: string; content: string }[];
  /** Sensor samples replayed from the hardware simulation log. */
  samples?: BenchSample[];
  /** Which hardware sim produced those samples. */
  provider?: string;
  /** Whether the hardware readiness gate passed for this build. */
  hardwareReady?: boolean;
  /** Extra line of provenance shown under the title. */
  sourceNote?: string;
  /** Set false to render without the outer panel chrome. */
  heading?: boolean;
}

export default function WokwiBench({
  files,
  samples = [],
  provider = 'unknown',
  hardwareReady = false,
  sourceNote,
  heading = true,
}: WokwiBenchProps) {
  const elementsReady = useWokwiElements();
  const diagram = useMemo(() => diagramFromFiles(files), [files]);
  // Whole-store subscription: tiles, nets and 3D gestures stay in lock-step.
  const snap = useSim3D();
  const heartbeat = useAvrHeartbeat(snap.running);

  // Heartbeat → shared store (guarded: no write when nothing changed).
  const hb = heartbeat.ledOn;
  useEffect(() => {
    const cur = useSim3D.getState().heartbeat;
    if (cur.ledOn !== hb) useSim3D.getState().setHeartbeat({ ledOn: hb });
  }, [hb]);
  useEffect(() => {
    const cur = useSim3D.getState().heartbeat;
    if (cur.simMs !== heartbeat.simMs || cur.cycles !== heartbeat.cycles || cur.edges !== heartbeat.edges) {
      useSim3D.getState().setHeartbeat({
        simMs: heartbeat.simMs,
        cycles: heartbeat.cycles,
        edges: heartbeat.edges,
      });
    }
  }, [heartbeat.simMs, heartbeat.cycles, heartbeat.edges]);

  // Seed per-part defaults once per diagram (sliders, servo pose, screens).
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!diagram || seeded.current === diagram.source) return;
    seeded.current = diagram.source;
    const st = useSim3D.getState();
    for (const part of diagram.parts) {
      const key = diagramPartKey(part.type);
      const def = defForKey(key);
      for (const c of def.controls) {
        if (c.kind === 'slider' && typeof st.sensors[part.id]?.[c.key] !== 'number') {
          if (c.key === 'value' && (key === 'potentiometer' || key === 'slide-potentiometer')) {
            if (st.analog[part.id] === undefined) st.setAnalog(part.id, c.def);
          } else if (c.key === 'angle' && (key === 'servo' || key === 'stepper-motor')) {
            if (st.servo[part.id] === undefined) st.setServo(part.id, c.def);
          } else if (c.key === 'steps') {
            if (st.encoder[part.id] === undefined) st.setEncoder(part.id, 0);
          } else if (c.key === 'brightness' || c.key === 'r' || c.key === 'g' || c.key === 'b') {
            // LED colour cells seed lazily on first touch.
          } else if (st.sensors[part.id]?.[c.key] === undefined) {
            st.setSensor(part.id, c.key, c.def);
          }
        }
        if (c.kind === 'text' && !st.lcdText[part.id]) {
          st.setLcdText(part.id, c.def.split('\n'));
        }
      }
      if ((key === 'led' || key === 'neopixel' || key === 'led-ring' || key === 'neopixel-matrix') && !st.led[part.id]) {
        st.setLed(part.id, { on: true, brightness: 1, color: 'red' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagram]);

  const solved = useMemo(() => (diagram ? solveNets(diagram) : null), [diagram, snap]);

  useEffect(() => {
    if (solved && diagram) commitSolved(diagram, solved);
  }, [solved]);

  const pinNetsByPart = useMemo(() => {
    const map = new Map<string, { pin: string; net: string }[]>();
    if (!diagram) return map;
    for (const part of diagram.parts) map.set(part.id, partPinNets(diagram, part.id));
    return map;
  }, [diagram]);

  if (!diagram) {
    return (
      <section className="panel bench-panel">
        {heading ? <h3>Live bench</h3> : null}
        <p className="muted">
          This build produced no machine-readable diagram, so there is nothing honest to animate.
        </p>
      </section>
    );
  }

  // Samples are handed out in diagram order so each sensor shows its own value.
  const sampleFor = (index: number): BenchSample | undefined =>
    samples[index % Math.max(samples.length, 1)];

  const beatStyle: CSSProperties = {
    opacity: heartbeat.ledOn ? 1 : 0.25,
  };

  const setRunning = useSim3D.getState().setRunning;

  return (
    <section className="panel bench-panel">
      {heading ? (
        <header className="bench-head">
          <div>
            <h3>Live bench — {diagram.parts.length} parts from your diagram</h3>
            <p className="tiny muted">
              Circuit drawn from <code>{diagram.source}</code> · heartbeat executed by avr8js
              (ATmega328p) in this tab · buttons/knobs/sliders drive live nets (INPUT_PULLUP,
              active-low) · sensor values replayed from the <strong>{provider}</strong> run.
              Your ESP32 firmware is compiled and simulated server-side, not in the browser.
              {sourceNote ? ` ${sourceNote}` : ''}
            </p>
          </div>
          <div className="bench-controls">
            <span className="bench-beat" style={beatStyle} aria-hidden>
              ●
            </span>
            <button type="button" onClick={() => {
              heartbeat.setRunning(!heartbeat.running);
              setRunning(!snap.running);
            }}>
              {heartbeat.running ? '❚❚ Pause' : '▶ Run'}
            </button>
            <button type="button" onClick={() => { heartbeat.reset(); useSim3D.getState().resetAll(); resetIcState(); }}>
              ↺ Reset
            </button>
          </div>
        </header>
      ) : null}

      <div className="bench-stage">
        {diagram.parts.map((part, index) => {
          const sample = sampleFor(index);
          const partKey = diagramPartKey(part.type);
          const registered = elementsReady && tagRegistered(part.tag);
          const nets = partNets(diagram, part.id);
          const props = part.tag && solved ? liveProps(part, partKey, solved, diagram, heartbeat.ledOn) : undefined;
          const sn = snap.sensors[part.id];
          const volts = nets.map((n) => solved?.volts[n]).find((v) => v !== undefined);
          return (
            <figure key={part.id} className={`bench-part${part.tag && registered ? '' : ' stub'}`}>
              <div className="bench-part-body">
                {part.tag && registered ? (
                  <WokwiElementView
                    part={part}
                    tag={part.tag}
                    attrs={part.attrs}
                    props={props}
                    pinNets={pinNetsByPart.get(part.id) ?? []}
                  />
                ) : part.tag && elementsReady ? (
                  <span className="tiny muted">loading element…</span>
                ) : (
                  <PlaceholderPart part={part} standIn={Boolean(part.tag)} />
                )}
              </div>
              <figcaption>
                <strong>{part.id}</strong>
                <span className="tiny muted">
                  {part.role ?? part.type}
                  {(part.type === 'dht11' && part.tag === 'wokwi-dht22') || (part.type.startsWith('lcd2004') && part.tag === 'wokwi-lcd1602')
                    ? ' · 2D stand-in, exact in 3D'
                    : ''}
                </span>
                {sample && partKey !== 'led' && (
                  <span className="bench-sample">
                    {sample.field} = {sample.value} {sample.unit}
                  </span>
                )}
                {sn ? (
                  <span className="bench-sample">
                    {Object.entries(sn)
                      .filter(([, v]) => typeof v === 'number')
                      .map(([k, v]) => `${k}=${Math.round(Number(v) * 100) / 100}`)
                      .join(' · ')}
                  </span>
                ) : null}
                {volts !== undefined ? (
                  <span className="tiny muted">AO ≈ {volts.toFixed(2)} V</span>
                ) : null}
                {snap.lastKey[part.id] ? (
                  <span className="bench-sample">key = {snap.lastKey[part.id]}</span>
                ) : null}
              </figcaption>
              <TileControls partKey={partKey} partId={part.id} />
            </figure>
          );
        })}
      </div>

      <div className="bench-meta">
        <dl>
          <div>
            <dt>Simulated time</dt>
            <dd>{(heartbeat.simMs / 1000).toFixed(2)} s</dd>
          </div>
          <div>
            <dt>AVR cycles retired</dt>
            <dd>{heartbeat.cycles.toLocaleString()}</dd>
          </div>
          <div>
            <dt>LED edges</dt>
            <dd>{heartbeat.edges}</dd>
          </div>
          <div>
            <dt>Hardware gate</dt>
            <dd className={hardwareReady ? 'ok' : 'bad'}>{hardwareReady ? 'ready ✔' : 'not ready ✘'}</dd>
          </div>
        </dl>
      </div>

      <details className="bench-nets">
        <summary>{diagram.connections.length} connections in this diagram</summary>
        <ul>
          {diagram.connections.map((conn, index) => {
            const net = netKeyFor(conn);
            const high = solved?.levels[net];
            return (
              <li key={`${conn.fromPart}-${conn.fromPin}-${index}`}>
                <span className={`net-dot${high ? ' high' : ''}`} aria-hidden />
                <code>
                  {conn.fromPart}.{conn.fromPin}
                </code>{' '}
                →{' '}
                <code>
                  {conn.toPart}.{conn.toPin}
                </code>{' '}
                <span className="tiny muted">net {conn.net || '—'}{high ? ' · HIGH' : ''}</span>
              </li>
            );
          })}
        </ul>
        {diagram.unrendered.length > 0 && (
          <p className="tiny muted">
            No Wokwi visual model for: {diagram.unrendered.join(', ')} — shown as stub tiles (exact
            true-scale bodies in the 3D view) rather than substituted with a lookalike part.
          </p>
        )}
      </details>
    </section>
  );
}
