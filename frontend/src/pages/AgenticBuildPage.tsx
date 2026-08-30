import { useState } from 'react';

import { useGraphStore } from '../store/useGraphStore';
import { useDesignSession } from '../store/useDesignSession';
import { api } from '../services/api';
import { toast } from '../store/useToastStore';
import CodeBlock from '../components/CodeBlock';
import { downloadZip } from '../lib/zip';
import type {
  FirmwareResult,
  FullBuildResult,
  WebsiteBuildResult,
  WebsiteRequirements,
} from '../types/build';

/**
 * Agentic Build — the firmware + website generation stage.
 *
 * Pipeline (always in this order):
 *   1. Firmware (hardware) is generated FIRST.
 *   2. Then a "Website Requirements" section is produced (only meaningful when
 *      the user's brief implies a website; detected automatically).
 *   3. Then the hosting-ready MERN website is assembled on the hardcoded
 *      scaffold, with the AI wiring only the device-specific files.
 */
export default function AgenticBuildPage() {
  const graph = useGraphStore((state) => state.graph);
  const brief = useDesignSession((state) => state.brief);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FullBuildResult | null>(null);

  const [firmware, setFirmware] = useState<FirmwareResult | null>(null);
  const [requirements, setRequirements] = useState<WebsiteRequirements | null>(null);
  const [website, setWebsite] = useState<WebsiteBuildResult | null>(null);

  const canRun = graph.nodes.length > 0 && !busy;

  const run = async () => {
    if (graph.nodes.length === 0) {
      toast('Generate an architecture plan first (Architecture plan page).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const full = await api.buildAll({
        brief: brief.trim(),
        projectName: graph.project,
        graph,
      });
      setResult(full);
      setFirmware(full.firmware);
      setRequirements(full.websiteRequirements);
      setWebsite(full.website);
      if (!full.websiteRequested) {
        toast('No website was detected in the brief — firmware only.');
      } else {
        toast('Agentic build complete.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agentic build failed.');
    } finally {
      setBusy(false);
    }
  };

  const firmwareZip = async () => {
    if (!firmware) return;
    await downloadZip(
      firmware.files.map((file) => ({ path: file.path, content: file.content })),
      `${graph.project.replace(/\s+/g, '-')}-firmware.zip`,
    );
    toast('Firmware source downloaded.');
  };

  const websiteZip = async () => {
    if (!website) return;
    await downloadZip(website.mergedFiles, `${website.projectName}-website.zip`);
    toast('Website codebase downloaded.');
  };

  const reset = () => {
    setResult(null);
    setFirmware(null);
    setRequirements(null);
    setWebsite(null);
    setError(null);
  };

  return (
    <>
      <section className="heading-row">
        <div>
          <div className="eyebrow">Architecture workspace / 05</div>
          <h1>Agentic build</h1>
          <p className="heading-sub">
            Firmware first, then website requirements, then a hosting-ready MERN
            dashboard assembled on a hardcoded scaffold.
          </p>
        </div>
        <div className="header-meta">
          <span>{graph.nodes.length} NODES</span>
          <span className="meta-sep">·</span>
          <span>{graph.project}</span>
        </div>
      </section>

      <section className="build-panel">
        <div className="build-steps">
          <div className={`step ${firmware ? 'done' : ''}`}>
            <span className="step-num">1</span>
            <div>
              <strong>Firmware</strong>
              <p>Real embedded source for the device (hardware first).</p>
            </div>
          </div>
          <div className={`step ${requirements ? 'done' : ''}`}>
            <span className="step-num">2</span>
            <div>
              <strong>Website requirements</strong>
              <p>What the web app needs to connect to the hardware.</p>
            </div>
          </div>
          <div className={`step ${website ? 'done' : ''}`}>
            <span className="step-num">3</span>
            <div>
              <strong>Website build</strong>
              <p>MERN codebase on the hardcoded scaffold + Vercel config.</p>
            </div>
          </div>
        </div>

        <div className="build-actions">
          {!result ? (
            <button
              type="button"
              className="plan-button"
              disabled={!canRun}
              onClick={() => void run()}
            >
              <span className="button-label">
                {busy ? 'Building…' : 'Run full agentic build'}
              </span>
              <span className="button-arrow">↗</span>
            </button>
          ) : (
            <button type="button" className="suggestion" onClick={reset}>
              Rebuild
            </button>
          )}
        </div>
        {!canRun && !busy && (
          <p className="panel-mono">Generate a plan on the Architecture page first.</p>
        )}
        {error && <p className="build-error">{error}</p>}
      </section>

      {busy && (
        <section className="build-section">
          <span className="panel-mono">Running pipeline: firmware → website requirements → website…</span>
        </section>
      )}

      {firmware && (
        <section className="build-section">
          <header className="build-section-head">
            <div>
              <h2>1 · Firmware</h2>
              <p className="heading-sub">
                {firmware.platform} · {firmware.board} · {firmware.language}
              </p>
            </div>
            <button type="button" className="export-button" onClick={() => void firmwareZip()}>
              Download .zip
            </button>
          </header>

          <div className="detail-list">
            {firmware.buildSteps.length > 0 && (
              <div className="detail-card">
                <h3>Build steps</h3>
                <ul className="detail-bullets">
                  {firmware.buildSteps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
            {firmware.notes.length > 0 && (
              <div className="detail-card">
                <h3>Notes</h3>
                <ul className="detail-bullets">
                  {firmware.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="code-list">
            {firmware.files.map((file) => (
              <CodeBlock key={file.path} path={file.path} content={file.content} />
            ))}
          </div>
        </section>
      )}

      {requirements && (
        <section className="build-section">
          <header className="build-section-head">
            <div>
              <h2>2 · Website requirements</h2>
              {requirements.requested ? (
                <span className="status-pill">website requested</span>
              ) : (
                <span className="status-pill proposed">no website detected</span>
              )}
            </div>
          </header>

          {!requirements.requested ? (
            <div className="detail-card">
              <p className="heading-sub">
                The brief did not indicate a companion website, so this section
                is informational. Re-run with a website in mind to generate one.
              </p>
              <p className="panel-mono">{requirements.summary}</p>
            </div>
          ) : (
            <div className="details-grid">
              <article className="detail-card">
                <header>
                  <h3>Device connection</h3>
                  <span className="card-count">{requirements.device.connection}</span>
                </header>
                <div className="detail-list">
                  <div className="detail-row">
                    <span className="main-label">
                      <i className="connector" />
                      Name
                    </span>
                    <span className="value">{requirements.device.name || '—'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="main-label">
                      <i className="connector" />
                      Endpoint base
                    </span>
                    <span className="value">{requirements.device.endpointBase || '—'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="main-label">
                      <i className="connector" />
                      IP hint
                    </span>
                    <span className="value">{requirements.device.localIpHint ?? '—'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="main-label">
                      <i className="connector" />
                      Port
                    </span>
                    <span className="value">{requirements.device.port ?? '—'}</span>
                  </div>
                </div>
              </article>

              <article className="detail-card">
                <header>
                  <h3>Data model</h3>
                  <span className="card-count">
                    {String(requirements.dataModel.length).padStart(2, '0')} FIELDS
                  </span>
                </header>
                <div className="detail-list">
                  {requirements.dataModel.map((field, index) => (
                    <div className="detail-row" key={`${field.field}-${index}`}>
                      <div className="main-label">
                        <i className="connector" />
                        <span>{field.field}</span>
                      </div>
                      <span className="value">
                        {field.type}
                        {field.unit ? ` (${field.unit})` : ''}
                      </span>
                    </div>
                  ))}
                  {requirements.dataModel.length === 0 && (
                    <span className="panel-mono">No data fields declared</span>
                  )}
                </div>
              </article>
            </div>
          )}

          {requirements.requested && (
            <div className="details-grid">
              <article className="detail-card">
                <header>
                  <h3>Read endpoints</h3>
                  <span className="card-count">
                    {String(requirements.readEndpoints.length).padStart(2, '0')} ENDPOINTS
                  </span>
                </header>
                <div className="detail-list">
                  {requirements.readEndpoints.map((endpoint, index) => (
                    <div className="detail-row" key={`${endpoint.name}-${index}`}>
                      <div className="main-label">
                        <i className="connector" />
                        <span>
                          {endpoint.method} {endpoint.path}
                        </span>
                      </div>
                      <span className="value">{endpoint.description || endpoint.name}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="detail-card">
                <header>
                  <h3>Control endpoints</h3>
                  <span className="card-count">
                    {String(requirements.controlEndpoints.length).padStart(2, '0')} ENDPOINTS
                  </span>
                </header>
                <div className="detail-list">
                  {requirements.controlEndpoints.map((endpoint, index) => (
                    <div className="detail-row" key={`${endpoint.name}-${index}`}>
                      <div className="main-label">
                        <i className="connector" />
                        <span>
                          {endpoint.method} {endpoint.path}
                        </span>
                      </div>
                      <span className="value">{endpoint.description || endpoint.name}</span>
                    </div>
                  ))}
                  {requirements.controlEndpoints.length === 0 && (
                    <span className="panel-mono">No controls</span>
                  )}
                </div>
              </article>
            </div>
          )}

          {requirements.requested && requirements.security.length > 0 && (
            <div className="detail-card">
              <h3>Security</h3>
              <ul className="detail-bullets">
                {requirements.security.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {website && (
        <section className="build-section">
          <header className="build-section-head">
            <div>
              <h2>3 · Website build</h2>
              <p className="heading-sub">
                {website.mergedFiles.length} files · {website.scaffoldFiles} from the
                hardcoded scaffold · {website.generatedFiles.length} AI-generated
              </p>
            </div>
            <button type="button" className="export-button" onClick={() => void websiteZip()}>
              Download .zip
            </button>
          </header>

          <div className="detail-list">
            <div className="detail-card">
              <h3>Vercel wiring</h3>
              <ul className="detail-bullets">
                <li>
                  <span className="panel-mono">{website.vercel.config}</span> — monorepo
                  config (frontend static + backend serverless at /api)
                </li>
                <li>Frontend → {website.vercel.frontend}</li>
                <li>Backend → {website.vercel.backend}</li>
              </ul>
            </div>
          </div>

          <div className="code-list">
            <h3 className="code-list-title">AI-generated device wiring</h3>
            {website.generatedFiles.map((file) => (
              <CodeBlock key={file.path} path={file.path} content={file.content} />
            ))}
            {website.buildNotes.length > 0 && (
              <div className="detail-card">
                <h3>Build notes</h3>
                <ul className="detail-bullets">
                  {website.buildNotes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="code-list">
            <h3 className="code-list-title">Full project (download for the complete tree)</h3>
            <div className="panel-mono">
              {website.mergedFiles
                .filter((file) => !file.path.startsWith('frontend/src/lib/deviceSpec'))
                .slice(0, 8)
                .map((file) => file.path)
                .join(' · ')}
              {website.mergedFiles.length > 8 ? ' · …' : ''}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
