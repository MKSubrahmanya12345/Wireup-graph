import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import CodeBlock from '../components/CodeBlock';
import { downloadZip } from '../lib/zip';
import { useBuildStore, type TerminalLine } from '../store/useBuildStore';
import { useGraphStore } from '../store/useGraphStore';
import { toast } from '../store/useToastStore';
import type { AgenticBuildResult, ValidationReport } from '../types/build';

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

  const firmwareZip = async () => {
    if (!result) return;
    await downloadZip(result.firmware.files, `${result.slug}-firmware.zip`);
    toast('Firmware zip downloaded — flash it with Arduino IDE or PlatformIO.');
  };

  const softwareZip = async () => {
    if (!result) return;
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
              <button type="button" className="primary-button" disabled={!canRun} onClick={() => void run()}>
                {result ? '↻ Re-run agentic build' : '⚡ Run agentic build'}
              </button>
            </>
          )}
        </div>
      </section>

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
              <button type="button" className="primary-button wide" onClick={() => void firmwareZip()}>
                ⬇ Download {result.slug}-firmware.zip
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
              <button type="button" className="primary-button wide" onClick={() => void softwareZip()}>
                ⬇ Download {result.slug}-software.zip
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
              engine: {result.engine === 'deterministic' ? 'Wireup deterministic synthesis (knowledge base)' : 'LLM draft + terminal gauntlet'}
              {' · '}iterations: firmware {result.iterations.firmware}, software {result.iterations.software}
            </div>
          </section>

          <FileBrowser result={result} />
        </>
      )}
    </div>
  );
}
