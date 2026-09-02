import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import CodeBlock from '../components/CodeBlock';
import WokwiBench from '../components/WokwiBench';
import { samplesFromLog } from '../sim/diagram';
import { downloadZip } from '../lib/zip';
import { api } from '../services/api';
import { useBuildStore, type TerminalLine } from '../store/useBuildStore';
import { useGraphStore } from '../store/useGraphStore';
import { useDesignSession } from '../store/useDesignSession';
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
const BEDROCK_MODELS = [
  'moonshotai.kimi-k2.5',
  'minimax.minimax-m2.5',
  'amazon.nova-pro-v1:0',
  'anthropic.claude-3-sonnet-20240229-v1:0',
];

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
  const sessionLlmOptions = useDesignSession((state) => state.llmOptions);

  const terminalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const canRun = graph.nodes.length > 0 && !running;

  // LLM model selection for the agentic build (AWS Bedrock is the only provider)
  const [model, setModel] = useState<string>(
    sessionLlmOptions.model ?? BEDROCK_MODELS[0]
  );
  // ??$$$ Chatbot prompt state for follow-up user instructions
  const [chatPrompt, setChatPrompt] = useState<string>('');

  const handleRun = (revisionInstruction?: string) => {
    void run({ provider: 'bedrock', model, revisionInstruction });
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatPrompt.trim() || running) return;
    const text = chatPrompt.trim();
    setChatPrompt('');
    handleRun(text);
  };

  // Downloads unlock only when BOTH indicators pass (M4 #28).
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
          <Link to="/design" className="primary-button as-link">← Start with the prompt</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page build-page">
      <section className="build-head">
        <div>
          <div className="eyebrow">Wireup pipeline · 03 — agentic build assistant</div>
          <h1>Build Workspace & AI Chatbot</h1>
          <p className="muted">
            Code Explorer on the left, interactive AI Chatbot & build runner on the right.
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
              <button type="button" className="ghost-button" disabled={!canRun} onClick={() => handleRun()}>
                {result ? '↻ Re-run agentic build' : '⚡ Run agentic build'}
              </button>
            </>
          )}
        </div>
      </section>

      {/* ??$$$ Split IDE Layout: Left = AI Chatbot Assistant, Right = Code Explorer & Files */}
      <div className="agentic-ide-container">
        
        {/* ── LEFT PANE: Chatbot & Live Agent Terminal ───────────────────── */}
        <div className="ide-left-pane">
          <div className="chatbot-card">
            <div className="chatbot-header">
              <div className="chatbot-title">
                <span style={{ fontSize: 16 }}>🤖</span>
                <span>Wireup Agent</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <ToolchainBadge />
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={running}
                  style={{ background: 'var(--bg-raise)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 6px', fontSize: 11 }}
                >
                  {BEDROCK_MODELS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <span className="chatbot-status-tag">{running ? 'BUILDING…' : 'READY'}</span>
              </div>
            </div>

            {/* Chatbot Message Thread (Log & Agent updates styled as messages) */}
            <div className="chatbot-body" ref={terminalRef}>
              <div className="chat-bubble assistant">
                <span className="chat-sender">AI Build Agent</span>
                Welcome! I am your Wireup hardware & firmware agent. Ask me any question or tell me what to refine in the build!
              </div>

              {lines.length === 0 && (
                <div className="chat-bubble system">
                  Press <strong>⚡ Run agentic build</strong> or type an instruction below to start synthesizing firmware and web apps.
                </div>
              )}

              {lines.map((line) => {
                if (line.kind === 'stage') {
                  return (
                    <div key={line.id} className="chat-bubble assistant">
                      <span className="chat-sender">Stage Update</span>
                      <strong>{line.text}</strong>
                      {line.stage === 'firmware-validate' || line.stage === 'software-validate' ? (
                        <span className="tl-spinner" />
                      ) : null}
                    </div>
                  );
                }
                if (line.kind === 'cmd') {
                  return (
                    <div key={line.id} className="chat-bubble system">
                      <code>{line.text}</code>
                      {line.exitCode !== undefined && (
                        <span className={`exit-chip${line.exitCode === 0 ? ' ok' : ' bad'}`}>
                          exit {line.exitCode ?? 'killed'}
                        </span>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={line.id} className={`chat-bubble assistant`}>
                    <span className="chat-sender">Agent Execution</span>
                    <span>{TONE_GLYPH[line.tone]} {line.text}</span>
                  </div>
                );
              })}

              {error && !result && (
                <div className="chat-bubble assistant" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
                  <span className="chat-sender">Build Error</span>
                  {error}
                </div>
              )}
            </div>

            {/* Interactive Chatbot Input Bar */}
            <form className="chat-input-bar" onSubmit={handleChatSubmit}>
              <input
                type="text"
                placeholder={running ? "Building agentic graph..." : "Ask AI to change pins, add Bluetooth, revise build..."}
                value={chatPrompt}
                onChange={(e) => setChatPrompt(e.target.value)}
                disabled={running}
              />
              <button
                type="submit"
                className="primary-button"
                disabled={running || !chatPrompt.trim()}
                style={{ padding: '8px 16px', fontSize: 13 }}
              >
                Send ↵
              </button>
            </form>
          </div>

          {(reports.firmware || reports.software || reports.consistency) && (
            <div className="validation-grid">
              <CheckBadges report={reports.firmware} title="Firmware (g++)" />
              <CheckBadges report={reports.software} title="Software (Vite)" />
              <CheckBadges report={reports.consistency} title="Contract" />
            </div>
          )}
        </div>

        {/* ── RIGHT PANE: Code Explorer, Files, Bench & BOM ──────────────── */}
        <div className="ide-right-pane">
          {result ? (
            <>
              {/* Render Readiness indicators in right pane above code */}
              {result.simulation && <ReadinessPanel result={result} />}

              <FileBrowser result={result} />

              {/* Downloads Bar */}
              <section className="download-grid">
                <div className="download-card firmware">
                  <div className="download-icon">⌘</div>
                  <h3>Firmware Zip</h3>
                  <p className="muted">{result.firmware.board} · {result.firmware.language}</p>
                  <button
                    type="button"
                    className="primary-button wide"
                    disabled={!unlocked}
                    onClick={() => void firmwareZip()}
                  >
                    {unlocked ? '⬇' : '🔒'} Download {result.slug}-firmware.zip
                  </button>
                </div>

                <div className="download-card software">
                  <div className="download-icon">❖</div>
                  <h3>Software Zip (MERN)</h3>
                  <p className="muted">Express + React Dashboard</p>
                  <button
                    type="button"
                    className="primary-button wide"
                    disabled={!unlocked}
                    onClick={() => void softwareZip()}
                  >
                    {unlocked ? '⬇' : '🔒'} Download {result.slug}-software.zip
                  </button>
                </div>
              </section>

              {/* Wokwi Hardware Bench */}
              <WokwiBench
                files={result.firmware.files}
                samples={samplesFromLog(result.simulation?.hardware.log)}
                provider={result.simulation?.hardware.provider}
                hardwareReady={result.simulation?.hardware.ready}
              />

              {result.bom && <BomView result={result} />}
              <LiveDeviceCheck />
            </>
          ) : (
            <div className="file-browser" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
              <h3>Code & File Explorer</h3>
              <p>Generated firmware (.ino/.h) and web app files (.tsx/.json) will appear here on the right in interactive folder trees once you trigger the agentic build.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
