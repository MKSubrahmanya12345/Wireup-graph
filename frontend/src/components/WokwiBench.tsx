/**
 * Page 03's live bench.
 *
 * What is real here, precisely:
 *  • The circuit drawn below is the diagram the pipeline actually generated
 *    (`diagram.json` / `hardware/universal-diagram.json` out of the firmware
 *    zip), rendered with the real @wokwi/elements custom elements.
 *  • The heartbeat driving the animation is an avr8js ATmega328p executing
 *    assembled AVR machine code in this tab (see src/sim/avrProgram.ts).
 *  • The sensor values shown are the samples the HardwareSimProvider returned
 *    for THIS build — they are replayed, not invented in the browser.
 *
 * What is NOT happening: your ESP32 firmware is not running in the browser.
 * avr8js simulates AVR silicon; the ESP32 image is compiled and simulated
 * server-side (g++/PlatformIO + the hardware sim provider). This panel says so
 * on screen rather than implying otherwise.
 */
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { diagramFromFiles } from '../sim/diagram';
import type { BenchPart, BenchSample } from '../sim/diagram';
import { useAvrHeartbeat } from '../sim/useAvrHeartbeat';

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

/** Renders one Wokwi custom element and pushes live props onto it. */
function WokwiElementView({
  tag,
  attrs,
  props,
}: {
  tag: string;
  attrs: Record<string, string | number | boolean>;
  props?: Record<string, unknown>;
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
    for (const [key, value] of Object.entries(props)) el[key] = value;
  }, [props]);

  return createElement(tag, { ref });
}

/** Part types with no @wokwi/elements model — drawn honestly as a stub tile. */
function PlaceholderPart({ part }: { part: BenchPart }) {
  return (
    <div className="bench-placeholder" title={`No Wokwi element for ${part.type}`}>
      <span className="bench-placeholder-chip">{part.model ?? part.type}</span>
      <span className="tiny muted">no visual model</span>
    </div>
  );
}

/** Live props for the parts that can actually react to the heartbeat. */
function liveProps(
  part: BenchPart,
  state: { ledOn: boolean; sample?: { field: string; value: string; unit: string } },
): Record<string, unknown> | undefined {
  switch (part.tag) {
    case 'wokwi-led':
      return { value: state.ledOn, color: 'red', label: 'STATUS' };
    case 'wokwi-buzzer':
      return { hasSignal: state.ledOn };
    case 'wokwi-ks2e-m-dc5':
      return { on: state.ledOn };
    case 'wokwi-servo':
      return { angle: state.ledOn ? 120 : 30 };
    case 'wokwi-pir-motion-sensor':
      return { sensing: state.ledOn };
    default:
      return undefined;
  }
}

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
}: WokwiBenchProps) {
  const elementsReady = useWokwiElements();
  const diagram = useMemo(() => diagramFromFiles(files), [files]);
  const heartbeat = useAvrHeartbeat(true);

  if (!diagram) {
    return (
      <section className="panel bench-panel">
        <h3>Live bench</h3>
        <p className="muted">
          This build produced no machine-readable diagram, so there is nothing honest to animate.
        </p>
      </section>
    );
  }

  // Samples are handed out in diagram order so each sensor shows its own value.
  const sampleFor = (index: number) => samples[index % Math.max(samples.length, 1)];

  const beatStyle: CSSProperties = {
    opacity: heartbeat.ledOn ? 1 : 0.25,
  };

  return (
    <section className="panel bench-panel">
      <header className="bench-head">
        <div>
          <h3>Live bench — {diagram.parts.length} parts from your diagram</h3>
          <p className="tiny muted">
            Circuit drawn from <code>{diagram.source}</code> · heartbeat executed by avr8js
            (ATmega328p) in this tab · sensor values replayed from the <strong>{provider}</strong> run.
            Your ESP32 firmware is compiled and simulated server-side, not in the browser.
            {sourceNote ? ` ${sourceNote}` : ''}
          </p>
        </div>
        <div className="bench-controls">
          <span className="bench-beat" style={beatStyle} aria-hidden>
            ●
          </span>
          <button type="button" onClick={() => heartbeat.setRunning(!heartbeat.running)}>
            {heartbeat.running ? '❚❚ Pause' : '▶ Run'}
          </button>
          <button type="button" onClick={heartbeat.reset}>
            ↺ Reset
          </button>
        </div>
      </header>

      <div className="bench-stage">
        {diagram.parts.map((part, index) => {
          const sample = sampleFor(index);
          return (
            <figure key={part.id} className={`bench-part${part.tag ? '' : ' stub'}`}>
              <div className="bench-part-body">
                {part.tag && elementsReady ? (
                  <WokwiElementView
                    tag={part.tag}
                    attrs={part.attrs}
                    props={liveProps(part, { ledOn: heartbeat.ledOn, sample })}
                  />
                ) : part.tag ? (
                  <span className="tiny muted">loading element…</span>
                ) : (
                  <PlaceholderPart part={part} />
                )}
              </div>
              <figcaption>
                <strong>{part.id}</strong>
                <span className="tiny muted">{part.role ?? part.type}</span>
                {sample && part.role === 'sensor' && (
                  <span className="bench-sample">
                    {sample.field} = {sample.value} {sample.unit}
                  </span>
                )}
              </figcaption>
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
          {diagram.connections.map((conn, index) => (
            <li key={`${conn.fromPart}-${conn.fromPin}-${index}`}>
              <code>
                {conn.fromPart}.{conn.fromPin}
              </code>{' '}
              →{' '}
              <code>
                {conn.toPart}.{conn.toPin}
              </code>{' '}
              <span className="tiny muted">net {conn.net || '—'}</span>
            </li>
          ))}
        </ul>
        {diagram.unrendered.length > 0 && (
          <p className="tiny muted">
            No Wokwi visual model for: {diagram.unrendered.join(', ')} — shown as stub tiles rather
            than substituted with a lookalike part.
          </p>
        )}
      </details>
    </section>
  );
}
