/**
 * Page 04 — /sim. Two halves of the same build, one swap button.
 *
 *   Simulation  — the circuit this build resolved, running.
 *                 · By default: Wireup's own browser bench (avr8js executing
 *                   real AVR machine code + @wokwi/elements drawing the parts
 *                   from the generated diagram). No Docker, no external
 *                   service, works offline.
 *                 · When this deployment sets VELXIO_URL, the same panel
 *                   embeds that Velxio instance instead (external/velxio,
 *                   AGPL-3.0) — the full multi-board emulator.
 *                 · Either way the build ships a .vlx project you can open in
 *                   Velxio directly.
 *
 *   Website     — the generated MERN dashboard, actually running. The bundle
 *                 served in the iframe is the one the software gate built;
 *                 the device API behind it is Wireup's preview stub, because a
 *                 browser tab cannot reach your ESP32 over your LAN.
 *
 * The swap button flips between them, keeps its state in the URL (?view=…) so
 * a reload or a shared link lands on the same half, and reports plainly when a
 * half has nothing to show instead of rendering an empty frame.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import WokwiBench from '../components/WokwiBench';
import { samplesFromLog } from '../sim/diagram';
import { api, type SimConfig } from '../services/api';
import { useBuildStore } from '../store/useBuildStore';
import {
  chooseEngine,
  previewBlockedReason,
  previewTarget,
  velxioArtifact,
  type SimEngine,
} from '../lib/simSources';

type View = 'simulation' | 'website';

function isView(value: string | null): value is View {
  return value === 'simulation' || value === 'website';
}

/** Download the .vlx so it can be opened in Velxio. */
function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function SimPage() {
  const result = useBuildStore((state) => state.result);
  const [params, setParams] = useSearchParams();
  const [config, setConfig] = useState<SimConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [engineChoice, setEngineChoice] = useState<SimEngine | null>(null);

  const view: View = isView(params.get('view')) ? (params.get('view') as View) : 'simulation';

  const setView = useCallback(
    (next: View) => {
      const updated = new URLSearchParams(params);
      updated.set('view', next);
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    let alive = true;
    api
      .simConfig()
      .then((value) => alive && setConfig(value))
      .catch((error: unknown) => {
        if (!alive) return;
        setConfigError(error instanceof Error ? error.message : 'Could not read the simulator config');
      });
    return () => {
      alive = false;
    };
  }, []);

  const engine = chooseEngine(config, engineChoice);
  const velxioUrl = config?.velxio.embedUrl ?? null;
  const vlx = useMemo(() => velxioArtifact(result), [result]);
  const preview = useMemo(() => previewTarget(result), [result]);
  const samples = useMemo(() => samplesFromLog(result?.simulation?.hardware.log), [result]);

  return (
    <div className="sim-page">
      <header className="sim-head">
        <Link to="/build" className="sim-back">
          ← Build
        </Link>

        <div className="sim-title">
          <h1>{result ? result.projectName : 'Simulation & website'}</h1>
          <span className="tiny muted">
            {result
              ? `${result.slug} · ${result.firmware.board}`
              : 'No build loaded — run the agentic build on page 03'}
          </span>
        </div>

        {/* The swap. One control, two states, and it says where it will take
            you — not just where you are. */}
        <div className="sim-swap" role="group" aria-label="Switch between the simulation and the website">
          <button
            type="button"
            className={view === 'simulation' ? 'active' : ''}
            aria-pressed={view === 'simulation'}
            onClick={() => setView('simulation')}
          >
            ⚡ Simulation
          </button>
          <button
            type="button"
            className={view === 'website' ? 'active' : ''}
            aria-pressed={view === 'website'}
            onClick={() => setView('website')}
          >
            🖥 Website
          </button>
        </div>
      </header>

      <main className="sim-main">
        {view === 'simulation' ? (
          <section className="sim-panel">
            <div className="sim-panel-bar">
              <div>
                <strong>
                  {engine === 'velxio' ? 'Velxio emulator (embedded)' : 'Wireup browser bench'}
                </strong>
                <span className="tiny muted">
                  {engine === 'velxio'
                    ? `Embedded from ${velxioUrl} — full multi-board emulation, AGPL-3.0.`
                    : 'avr8js + @wokwi/elements, running in this tab. The ESP32 firmware is compiled and simulated server-side.'}
                </span>
              </div>

              <div className="sim-panel-actions">
                {config?.velxio.configured && (
                  <button
                    type="button"
                    onClick={() => setEngineChoice(engine === 'velxio' ? 'native' : 'velxio')}
                  >
                    {engine === 'velxio' ? 'Use the browser bench' : 'Use the Velxio instance'}
                  </button>
                )}
                {vlx && (
                  <button type="button" onClick={() => downloadText(vlx.filename, vlx.content)}>
                    ⬇ {vlx.filename}
                  </button>
                )}
                {vlx && (
                  <a
                    className="sim-linkbtn"
                    href={velxioUrl ?? 'https://velxio.dev'}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open Velxio ↗
                  </a>
                )}
              </div>
            </div>

            {engine === 'velxio' && velxioUrl ? (
              <iframe
                className="sim-frame"
                src={velxioUrl}
                title="Velxio emulator"
                allow="clipboard-write; fullscreen; serial; usb"
              />
            ) : result ? (
              <WokwiBench
                files={result.firmware.files}
                samples={samples}
                provider={result.simulation?.hardware.provider}
                hardwareReady={result.simulation?.hardware.ready}
                sourceNote={
                  vlx
                    ? `The same circuit is exported as ${vlx.filename} (${vlx.parts} parts, ${vlx.wires} wires) for the Velxio emulator.`
                    : undefined
                }
              />
            ) : (
              <div className="sim-empty">
                <h2>Nothing to simulate yet</h2>
                <p>
                  The bench draws the circuit from the diagram a build produces. Run the agentic
                  build on <Link to="/build">page 03</Link> and come back — the result is kept in
                  this browser.
                </p>
              </div>
            )}

            {vlx && (
              <p className="sim-foot tiny muted">
                <code>{vlx.path}</code> is a native Velxio project ({vlx.boardKind ?? 'board'} ·{' '}
                {vlx.parts} parts · {vlx.wires} wires) generated from this build's plan — the same
                pins the firmware drives. Velxio is open source (AGPL-3.0):{' '}
                <a href="https://github.com/davidmonterocrespo24/velxio" target="_blank" rel="noreferrer noopener">
                  github.com/davidmonterocrespo24/velxio
                </a>
                , vendored here as the <code>external/velxio</code> submodule.
              </p>
            )}
            {configError && <p className="sim-foot tiny bad">Simulator config unavailable: {configError}</p>}
          </section>
        ) : (
          <section className="sim-panel">
            <div className="sim-panel-bar">
              <div>
                <strong>Generated dashboard — live</strong>
                <span className="tiny muted">
                  {preview
                    ? 'This is the real bundle the software gate built. Its device API is a Wireup preview stub; the shipped Express backend talks to your board over the LAN.'
                    : 'Not published for this build.'}
                </span>
              </div>
              <div className="sim-panel-actions">
                {preview && (
                  <a className="sim-linkbtn" href={preview.url} target="_blank" rel="noreferrer noopener">
                    Open in a tab ↗
                  </a>
                )}
                <Link className="sim-linkbtn" to="/build">
                  Download the zip
                </Link>
              </div>
            </div>

            {preview ? (
              <iframe
                className="sim-frame"
                src={preview.url}
                title="Generated dashboard preview"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            ) : (
              <div className="sim-empty">
                <h2>No live dashboard for this build</h2>
                <p>{previewBlockedReason(result)}</p>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
