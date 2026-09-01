import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import CodeBlock from '../components/CodeBlock';
import { downloadZip } from '../lib/zip';
import { api } from '../services/api';
import { useBuildStore, type TerminalLine } from '../store/useBuildStore';
import { useGraphStore } from '../store/useGraphStore';
import { toast } from '../store/useToastStore';
import type { AgenticBuildResult, ValidationReport } from '../types/build';

/**
 * Two INDEPENDENT readiness indicators (M4).
 *
 * "Hardware ready" comes from the HardwareSimProvider (mock virtual bench, or
 * Velxio when SIM_MODE=velxio). "Software ready" comes from the npm/tsc/vite
 * gates, the runtime smoke test and the firmware⇄software contract. Neither
 * is inferred from the other, and a simulator that ERRORED says so explicitly
 * instead of quietly passing or being skipped.
 */
function ReadinessPanel({ result }: { result: AgenticBuildResult }) {
  const sim = result.simulation;
  const hardwareClass = sim.hardware.errored ? 'errored' : sim.hardware.ready ? 'ok' : 'bad';
  return (
    <section className="readiness-grid">
      <div className={`readiness-card ${hardwareClass}`}>
        <div className="readiness-head">
          <span className="glyph">{sim.hardware.ready ? '✔' : '✘'}</span>
          Hardware ready {sim.hardware.ready ? '✔' : '✘'}
        </div>
        <p className="muted tiny">
          simulator: <code>{sim.hardware.provider}</code> · {sim.hardware.checks.length} check(s) ·{' '}
          {(sim.hardware.durationMs / 1000).toFixed(1)} s
        </p>
        {sim.hardware.errored && (
          <p className="live-fail">
            The simulation provider ERRORED — hardware readiness could not be proven. This is an
            error, not a skipped step: fix the provider (or set <code>SIM_MODE=mock</code>) and
            re-run.
          </p>
        )}
        <div className="check-badge-grid">
          {sim.hardware.checks.map((check, index) => (
            <span key={`${check.name}-${index}`} className={`check-badge${check.ok ? ' ok' : ' fail'}`} title={check.detail}>
              {check.ok ? '✔' : '✘'} {check.name}
            </span>
          ))}
        </div>
        {sim.hardware.log.length > 0 && <pre className="readiness-log">{sim.hardware.log.join('\n')}</pre>}
        {sim.hardware.runUrl && (
          <a className="source-chip" href={sim.hardware.runUrl} target="_blank" rel="noreferrer">
            open the simulator run
          </a>
        )}
      </div>

      <div className={`readiness-card ${sim.software.ready ? 'ok' : 'bad'}`}>
        <div className="readiness-head">
          <span className="glyph">{sim.software.ready ? '✔' : '✘'}</span>
          Software ready {sim.software.ready ? '✔' : '✘'}
        </div>
        <p className="muted tiny">{sim.software.detail}</p>
        <div className="check-badge-grid">
          {sim.software.checks.map((check, index) => (
            <span key={`${check.name}-${index}`} className={`check-badge${check.ok ? ' ok' : ' fail'}`} title={check.detail}>
              {check.ok ? '✔' : '✘'} {check.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/** BOM with per-part purchase links (M5 #32). */
function BomView({ result }: { result: AgenticBuildResult }) {
  const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
  return (
    <section className="admin-panel">
      <h3>Bill of materials — {result.projectName}</h3>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Part</th>
            <th>Qty</th>
            <th>Wiring</th>
            <th>Approx</th>
            <th>Buy</th>
          </tr>
        </thead>
        <tbody>
          {result.bom.entries.map((entry) => (
            <tr key={entry.ref}>
              <td><code>{entry.ref}</code></td>
              <td>
                {entry.name}
                <br />
                <span className="muted tiny">{entry.partNumber}</span>
                {entry.datasheet && (
                  <>
                    {' '}
                    <a className="source-chip" href={entry.datasheet} target="_blank" rel="noreferrer">
                      datasheet
                    </a>
                  </>
                )}
              </td>
              <td>{entry.quantity}</td>
              <td className="muted tiny">{entry.connections}</td>
              <td>{entry.approxPricePaise ? rupees(entry.approxPricePaise) : '—'}</td>
              <td className="bom-links">
                {entry.links.map((link) => (
                  <a key={link.vendor} href={link.url} target="_blank" rel="noreferrer" title={link.note}>
                    {link.vendor} ↗
                  </a>
                ))}
                {entry.links.length === 0 && <span className="muted tiny">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted tiny">
        Approximate total {rupees(result.bom.totalApproxPaise)}
        {result.bom.incomplete && ' — some prices unknown'} · vendor links carry the configured
        affiliate tag when one is set.
      </p>
    </section>
  );
}

interface ToolchainStatus {
  node: string | null;
  npm: string | null;
  gpp: string | null;
}

/**
 * Already flashed? Type the IP the firmware printed on Serial and read the
 * sensor straight from the device — the firmware sends permissive CORS, so
 * the browser can talk to it directly. Closes the loop between "download"
 * and "it works on my bench".
 */
function LiveDeviceCheck() {
  const [ip, setIp] = useState('');
  const [testing, setTesting] = useState(false);
  const [reading, setReading] = useState<Record<string, unknown> | null>(null);
  const [fail, setFail] = useState<string | null>(null);

  const test = async () => {
    const host = ip.trim();
    if (!host) return;
    setTesting(true);
    setReading(null);
    setFail(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(`http://${host}/api/sensors`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Device returned HTTP ${response.status}`);
      setReading((await response.json()) as Record<string, unknown>);
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'Timed out.'
          : error instanceof Error
            ? error.message
            : 'Could not reach the device.';
      setFail(
        `${message} Is the device on the same Wi-Fi as this computer? The firmware prints its IP on Serial (115200 baud) — or join the device's own hotspot.`,
      );
    } finally {
      clearTimeout(timer);
      setTesting(false);
    }
  };

  return (
    <section className="live-card">
      <div className="eyebrow">flashed already? test the live device</div>
      <div className="live-row">
        <input
          className="revise-input"
          placeholder="Device IP from Serial (e.g. 192.168.1.50)"
          value={ip}
          onChange={(event) => setIp(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void test();
          }}
        />
        <button type="button" className="ghost-button" disabled={testing || !ip.trim()} onClick={() => void test()}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
      </div>
      {reading && (
        <pre className="live-json">
          {Object.entries(reading)
            .filter(([key]) => key !== 'sample_ts_ms')
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join('\n')}
        </pre>
      )}
      {fail && <p className="live-fail">{fail}</p>}
    </section>
  );
}

/** Show which terminal tools the server can run — g++ missing means the
 *  firmware compile gate is skipped (structural + contract checks remain). */
function ToolchainBadge() {
  const [toolchain, setToolchain] = useState<ToolchainStatus | null>(null);
  useEffect(() => {
    void api.healthToolchain().then(setToolchain).catch(() => undefined);
  }, []);
  if (!toolchain) return null;
  const rows = [
    ['node', toolchain.node],
    ['npm', toolchain.npm],
    ['g++', toolchain.gpp],
  ] as const;
  return (
    <div className="toolchain-badge">
      toolchain:{' '}
      {rows.map(([name, version]) => (
        <span key={name} className={version ? 'ok' : 'missing'}>
          {name} {version ? '✓' : '✗'}
        </span>
      ))}
      {!toolchain.gpp && <span className="muted tiny">firmware gate runs structural + contract checks only</span>}
    </div>
  );
}

const TONE_GLYPH: Record<TerminalLine['tone'], string> = {
  info: ' ',
  ok: '✓',
  warn: '⚠',
  error: '✗',
};

function CheckBadges({ report, title }: { report?: ValidationReport; title: string }) {
  if (!report) return null;
  const failed = report.checks.filter((check) => !check.ok);
  return (
    <div className={`check-badges ${report.ok ? 'ok' : 'bad'}`}>
      <div className="check-badges-title">
        {report.ok ? '✔' : '✘'} {title}
        <span className="muted tiny">{(report.durationMs / 1000).toFixed(1)} s</span>
      </div>
      <div className="check-badge-grid">
        {report.checks.map((check, index) => (
          <span key={`${check.name}-${index}`} className={`check-badge${check.ok ? ' ok' : ' fail'}`} title={check.detail}>
            {check.ok ? '✔' : '✘'} {check.name}
          </span>
        ))}
      </div>
      {failed.length > 0 && (
        <ul className="finding-list">
          {report.findings.slice(0, 8).map((finding, index) => (
            <li key={index} className={`finding ${finding.severity}`}>
              <code>{finding.code}</code>
              {finding.file && <span className="finding-file">{finding.file}{finding.line ? `:${finding.line}` : ''}</span>}
              {finding.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileBrowser({ result }: { result: AgenticBuildResult }) {
  const trees = useMemo(
    () => [
      { id: 'firmware' as const, title: `firmware zip — ${result.slug}-firmware.zip`, files: result.firmware.files },
      { id: 'software' as const, title: `software zip — ${result.slug}-software.zip`, files: result.software.files },
    ],
    [result],
  );
  const [tree, setTree] = useState<'firmware' | 'software'>('firmware');
  const [path, setPath] = useState<string | null>(null);

  const activeTree = trees.find((t) => t.id === tree)!;
  const activeFile = activeTree.files.find((file) => file.path === path) ?? activeTree.files[0];

  useEffect(() => {
    setPath(null);
  }, [tree]);

  return (
    <section className="file-browser">
      <div className="fb-tabs">
        {trees.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`fb-tab${tree === t.id ? ' active' : ''}`}
            onClick={() => setTree(t.id)}
          >
            {t.title}
          </button>
        ))}
      </div>
      <div className="fb-body">
        <nav className="fb-tree">
          {activeTree.files.map((file) => (
            <button
              key={file.path}
              type="button"
              className={`fb-file${activeFile?.path === file.path ? ' active' : ''}`}
              onClick={() => setPath(file.path)}
            >
              {file.path}
            </button>
          ))}
        </nav>
        <div className="fb-content">
          {activeFile && (
            <CodeBlock path={activeFile.path} content={activeFile.content} defaultOpen />
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Page 03 — the agentic build.
 * The terminal stays open while the engine retrieves, generates, compiles,
 * installs, builds and cross-checks. Two zip files come out.
 */
export default function BuildPage() {
  const graph = useGraphStore((state) => state.graph);
  const lines = useBuildStore((state) => state.lines);
  const running = useBuildStore((state) => state.running);
  const reports = useBuildStore((state) => state.reports);
  const result = useBuildStore((state) => state.result);
  const error = useBuildStore((state) => state.error);
  const run = useBuildStore((state) => state.run);
  const cancel = useBuildStore((state) => state.cancel);
  const clear = useBuildStore((state) => state.clear);

  const terminalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const canRun = graph.nodes.length > 0 && !running;

  // Downloads unlock only when BOTH indicators pass (M4 #28).
  // A build result persisted before M4 has no simulation block — treat the
  // absence as "unlocked" rather than trapping the user with an old artifact.
  const unlocked = result?.simulation ? result.simulation.downloadUnlocked : Boolean(result);

  const firmwareZip = async () => {
    if (!result || !unlocked) return;
    await downloadZip(result.firmware.files, `${result.slug}-firmware.zip`);
    toast('Firmware zip downloaded — flash it with Arduino IDE or PlatformIO.');
  };

  const softwareZip = async () => {
    if (!result || !unlocked) return;
    await downloadZip(result.software.files, `${result.slug}-software.zip`);
    toast('Software zip downloaded — npm install && npm run dev on your computer.');
  };

  if (graph.nodes.length === 0 && lines.length === 0) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-mark">⚡</div>
          <h1>Nothing to build yet</h1>
          <p className="muted">The agentic build consumes the validated graph from page 02.</p>
          <Link to="/" className="primary-button as-link">← Start with the prompt</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page build-page">
      <section className="build-head">
        <div>
          <div className="eyebrow">Wireup pipeline · 03 — agentic build</div>
          <h1>Build, compile, verify, ship</h1>
          <p className="muted">
            Deterministic engine + real terminal validation. Watch the log — every
            command actually runs on the server.
          </p>
        </div>
        <div className="build-actions">
          {running ? (
            <button type="button" className="ghost-button" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <>
              {result && (
                <button type="button" className="ghost-button" onClick={clear}>
                  Clear
                </button>
              )}
          <Link to="/sim" className="primary-button as-link" style={{ marginLeft: 10 }}>
            ↳ Simulation
          </Link>
          <button type="button" className="ghost-button" disabled={!canRun} onClick={() => void run()}>
            {result ? '↻ Re-run agentic build' : '⚡ Run agentic build'}
          </button>
            </>
          )}
        </div>
      </section>

      <ToolchainBadge />

      <section className="terminal-card">
        <div className="terminal-chrome">
          <span className="dot red" />
          <span className="dot amber" />
          <span className="dot green" />
          <span className="terminal-title">wireup@api — agentic pipeline</span>
          {running && <span className="terminal-live">● LIVE</span>}
        </div>
        <div className="terminal" ref={terminalRef}>
          {lines.length === 0 && (
            <div className="terminal-empty">
              Ready. Press <strong>Run agentic build</strong> — retrieval → firmware → g++ → MERN → npm/tsc/vite →
              contract checks. Nothing here is simulated.
            </div>
          )}
          {lines.map((line) => {
            if (line.kind === 'stage') {
              return (
                <div key={line.id} className="tl tl-stage">
                  {line.text}
                  {line.stage === 'firmware-validate' || line.stage === 'software-validate' ? (
                    <span className="tl-spinner" />
                  ) : null}
                </div>
              );
            }
            if (line.kind === 'cmd') {
              return (
                <div key={line.id} className={`tl tl-cmd ${line.tone}`}>
                  <span className="tl-text cmd-text">{line.text}</span>
                  {line.exitCode !== undefined && (
                    <span className={`exit-chip${line.exitCode === 0 ? ' ok' : ' bad'}`}>
                      exit {line.exitCode ?? 'killed'}
                    </span>
                  )}
                </div>
              );
            }
            if (line.kind === 'banner') {
              return (
                <div key={line.id} className={`tl tl-banner ${line.tone}`}>
                  {line.text}
                </div>
              );
            }
            return (
              <div key={line.id} className={`tl tl-${line.kind} ${line.tone}`}>
                {line.kind !== 'out' && <span className={`tl-glyph ${line.tone}`}>{TONE_GLYPH[line.tone]}</span>}
                <span className="tl-text">{line.text}</span>
              </div>
            );
          })}
        </div>
      </section>

      {error && !result && (
        <div className="inline-error">{error} — the log above shows exactly where.</div>
      )}

      {(reports.firmware || reports.software || reports.consistency) && (
        <section className="validation-grid">
          <CheckBadges report={reports.firmware} title="Firmware validation (g++)" />
          <CheckBadges report={reports.software} title="Software validation (npm · tsc · vite)" />
          <CheckBadges report={reports.consistency} title="Firmware ⇄ software contract" />
        </section>
      )}

      {result && (
        <>
          {/* A result persisted by an older build has no simulation block. */}
          {result.simulation && <ReadinessPanel result={result} />}

          {result.simulation && !unlocked && (
            <div className="download-locked">
              🔒 Downloads are locked: {result.simulation.hardware.errored
                ? 'the hardware simulation provider errored'
                : !result.simulation.hardware.ready
                  ? 'hardware simulation failed'
                  : 'the software gate failed'}
              . Both indicators must read ✔ before the zips are released.
            </div>
          )}

          <section className="download-grid">
            <div className="download-card firmware">
              <div className="download-icon">⌘</div>
              <h3>Firmware</h3>
              <p className="muted">
                {result.firmware.board} · {result.firmware.language} · {result.firmware.framework}
              </p>
              <ul className="download-files">
                {result.firmware.files.map((file) => (
                  <li key={file.path}>{file.path}</li>
                ))}
              </ul>
              <button
                type="button"
                className="primary-button wide"
                disabled={!unlocked}
                title={unlocked ? '' : 'Locked until hardware AND software both report ready.'}
                onClick={() => void firmwareZip()}
              >
                {unlocked ? '⬇' : '🔒'} Download {result.slug}-firmware.zip
              </button>
            </div>

            <div className="download-card software">
              <div className="download-icon">❖</div>
              <h3>Software (MERN dashboard)</h3>
              <p className="muted">
                Mongo-ready Express + React · runs on your computer · talks to the device over Wi-Fi
              </p>
              <ul className="download-files compact">
                {result.software.files.slice(0, 6).map((file) => (
                  <li key={file.path}>{file.path}</li>
                ))}
                <li className="muted">… {result.software.files.length - 6} more in the zip</li>
              </ul>
              <button
                type="button"
                className="primary-button wide"
                disabled={!unlocked}
                title={unlocked ? '' : 'Locked until hardware AND software both report ready.'}
                onClick={() => void softwareZip()}
              >
                {unlocked ? '⬇' : '🔒'} Download {result.slug}-software.zip
              </button>
            </div>
          </section>

          <section className="after-card">
            <div className="eyebrow">then, on your bench</div>
            <ol>
              {result.firmware.buildSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            <div className="engine-note">
              plan: {result.llm.plan} · LLM provider that actually ran: {result.llm.actual}
              {result.llm.note ? ` (${result.llm.note})` : ''}
              {' · '}engine: {result.engine === 'deterministic' ? 'Wireup deterministic synthesis (knowledge base)' : 'LLM draft + terminal gauntlet'}
              {' · '}iterations: firmware {result.iterations.firmware}, software {result.iterations.software}
            </div>
          </section>

          {result.instructions && (
          <section className="admin-panel">
            <h3>{result.instructions.path}</h3>
            <p className="muted tiny">
              Generated from this build's resolved plan — pins, parts, cadence and the verification
              record for this run. It also ships inside the firmware zip.
            </p>
            <CodeBlock path={result.instructions.path} content={result.instructions.content} defaultOpen />
          </section>
          )}

          {result.bom && <BomView result={result} />}

          <LiveDeviceCheck />

          <FileBrowser result={result} />
        </>
      )}
    </div>
  );
}
