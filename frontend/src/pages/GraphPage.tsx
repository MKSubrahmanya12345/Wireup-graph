import { useState, Suspense, lazy } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import GraphCanvas from '../components/GraphCanvas';
import NodeInspector from '../components/NodeInspector';
import ValidationDock from '../components/ValidationDock';
import CodeBlock from '../components/CodeBlock';
import { exportGraphPng, getViewportElement } from '../lib/exporters';
import { toFlowNodes } from '../lib/graphAdapter';
import { evaluateGraphValidity } from '../lib/graphValidity';
import { useDesignSession } from '../store/useDesignSession';
import { useGraphStore } from '../store/useGraphStore';
import { toast } from '../store/useToastStore';
import type { ArchitectureGraph } from '../types/architecture';

// three.js is heavy — only fetched when the user asks for the 3D view.
const ThreeViewport = lazy(() => import('../three/ThreeViewport'));

type ViewMode = '2d' | '3d';
type DetailTab = 'contract' | 'bom' | 'assumptions' | 'json';

/** Copy the parts list to the clipboard as TSV (spreadsheet-friendly). */
async function copyBom(graph: ArchitectureGraph): Promise<void> {
  const rows = [
    ['Component', 'Part number', 'Supply', 'Type'],
    ...graph.nodes.map((node) => [
      node.name,
      node.partNumber ?? '',
      node.properties?.find((p) => p.label === 'Supply')?.value ?? '',
      node.type,
    ]),
  ];
  const tsv = rows.map((row) => row.join('\t')).join('\n');
  try {
    await navigator.clipboard.writeText(tsv);
    toast('Parts list copied — paste it into any spreadsheet.');
  } catch {
    toast('Could not copy — clipboard unavailable in this browser.');
  }
}

/**
 * Page 02 — the architecture graph.
 * The validated system plan: drag nodes, inspect parts, audit AI assumptions,
 * review pre-flight hardware⇄software contracts, then send it to the agentic build.
 */
export default function GraphPage() {
  const graph = useGraphStore((state) => state.graph);
  const status = useGraphStore((state) => state.status);
  const blocking = useGraphStore((state) => state.blocking);
  const issues = useGraphStore((state) => state.issues);
  const verification = useGraphStore((state) => state.verification);
  const autoRepair = useGraphStore((state) => state.autoRepair);
  const stage = useDesignSession((state) => state.stage);
  const revise = useDesignSession((state) => state.revise);
  const accept = useDesignSession((state) => state.accept);
  const brief = useDesignSession((state) => state.brief);
  const sessionAssumptions = useDesignSession((state) => state.assumptions);
  const requirements = useDesignSession((state) => state.requirements);

  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [activeTab, setActiveTab] = useState<DetailTab>('contract');
  const [revisionNote, setRevisionNote] = useState('');
  const [repairing, setRepairing] = useState(false);
  const navigate = useNavigate();

  const hasGraph = graph.nodes.length > 0;
  const working = stage === 'planning' || stage === 'interpreting' || status === 'planning';
  const hasFixableIssues = issues.length > 0;

  /** Deterministic repair loop — fixes what is mechanically fixable. */
  const handleAutoRepair = async () => {
    if (repairing) return;
    setRepairing(true);
    await autoRepair();
    setRepairing(false);
    const { blocking: stillBlocking, issues: remaining, repairs } = useGraphStore.getState();
    const errorCount = remaining.filter((issue) => issue.severity === 'error').length;
    if (repairs.length === 0) {
      toast('Nothing to auto-repair — the remaining issues need a design change. Say what to change below and Revise.');
    } else if (stillBlocking || errorCount > 0) {
      toast(
        `Repair pass: ${repairs.length} fix(es) applied. ${errorCount} issue(s) remain — describe the fix below and Revise.`,
      );
    } else {
      toast(`Repair pass: ${repairs.length} fix(es) applied — graph re-validated.`);
    }
  };

  const handleExport = async () => {
    const viewportEl = getViewportElement();
    if (!viewportEl || !hasGraph) {
      toast('Nothing to export yet.');
      return;
    }
    try {
      await exportGraphPng(toFlowNodes(graph, null), graph, viewportEl);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  const handleAccept = () => {
    const validity = evaluateGraphValidity({ graph, issues, blocking, verification });
    if (!validity.valid) {
      toast(validity.reason);
      return;
    }
    accept();
    navigate('/build');
  };

  // Compile combined assumptions from requirements, notes, and node details
  const allAssumptions = Array.from(
    new Set([
      ...sessionAssumptions,
      ...(requirements?.assumptions ?? []),
      ...graph.notes,
      ...graph.nodes.flatMap((n) => n.details),
    ]),
  ).filter((a) => a && a.trim().length > 0);

  // Extract allocated hardware pin & bus connections
  const pinMappings = graph.connections
    .filter((c) => c.kind === 'data' || c.kind === 'analog' || c.kind === 'dependency')
    .map((c) => {
      const fromNode = graph.nodes.find((n) => n.id === c.from);
      const toNode = graph.nodes.find((n) => n.id === c.to);
      return {
        id: c.id,
        signal: c.label || 'DATA',
        from: fromNode?.name || c.from,
        to: toNode?.name || c.to,
        details: c.details || 'Direct Signal Net',
      };
    });

  if (!hasGraph) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-mark">◈</div>
          <h1>No design on the bench yet</h1>
          <p className="muted">
            {working
              ? 'Wireup is drawing your architecture right now…'
              : 'Start on page 01: describe the parts you have, then come back here for the validated graph.'}
          </p>
          {!working && (
            <Link to="/" className="primary-button as-link">
              ← Write the prompt
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page graph-page">
      <section className="graph-head">
        <div>
          <div className="eyebrow">Wireup pipeline · 02 — architecture graph</div>
          <h1>{graph.project}</h1>
          <p className="muted">{graph.summary || brief}</p>
        </div>
        <div className="graph-head-actions">
          <div className="view-toggle">
            {(['2d', '3d'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={viewMode === mode ? 'active' : ''}
                onClick={() => setViewMode(mode)}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" className="ghost-button" onClick={() => void handleExport()}>
            Export PNG
          </button>
        </div>
      </section>

      <section className="graph-workarea">
        <div className="graph-canvas-wrap">
          {viewMode === '2d' ? (
            <GraphCanvas />
          ) : (
            <div className="three-wrap">
              <Suspense
                fallback={
                  <div className="empty-state">
                    <span className="boot-mark">◈</span>
                    <p className="muted">Loading 3D viewport…</p>
                  </div>
                }
              >
                <ThreeViewport />
              </Suspense>
            </div>
          )}
        </div>
        <NodeInspector />
      </section>

      <div className="graph-meta-row">
        <span>{graph.nodes.length} components</span>
        <span>{graph.connections.length} connections</span>
        <span>{graph.dependencies.length} dependencies</span>
        <span>{graph.software.length} software parts</span>
      </div>

      {/* ── Pre-Flight Alignment Drawer ─────────────────────────────────── */}
      <section className="dock preflight-drawer">
        <div className="dock-summary" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="eyebrow">Human-AI Alignment & Pre-flight Inspection</div>
          <div className="view-toggle">
            <button
              type="button"
              className={activeTab === 'contract' ? 'active' : ''}
              onClick={() => setActiveTab('contract')}
            >
              Pre-Flight Contract
            </button>
            <button
              type="button"
              className={activeTab === 'assumptions' ? 'active' : ''}
              onClick={() => setActiveTab('assumptions')}
            >
              AI Assumptions ({allAssumptions.length})
            </button>
            <button
              type="button"
              className={activeTab === 'bom' ? 'active' : ''}
              onClick={() => setActiveTab('bom')}
            >
              BOM ({graph.nodes.length})
            </button>
            <button
              type="button"
              className={activeTab === 'json' ? 'active' : ''}
              onClick={() => setActiveTab('json')}
            >
              Spec JSON
            </button>
          </div>
        </div>

        {/* Tab 1: Pre-Flight Contract */}
        {activeTab === 'contract' && (
          <div className="dock-section" style={{ display: 'grid', gap: 16 }}>
            <div>
              <strong style={{ fontSize: 13.5 }}>Hardware Pin & Bus Manifest</strong>
              <p className="muted tiny" style={{ marginTop: 2 }}>
                Deterministic wiring contract: both the firmware code generator and simulator export are locked to these GPIO nets.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginTop: 8 }}>
                {pinMappings.length > 0 ? (
                  pinMappings.map((pin) => (
                    <div key={pin.id} className="rag-fact">
                      <span>{pin.from} ➔ {pin.to}</span>
                      <strong>{pin.signal}</strong>
                      <p className="tiny muted" style={{ margin: 0 }}>{pin.details}</p>
                    </div>
                  ))
                ) : (
                  <div className="muted tiny">Pin allocations determined by controller standard profile.</div>
                )}
              </div>
            </div>

            <div>
              <strong style={{ fontSize: 13.5 }}>Contracted Software & Telemetry Endpoints</strong>
              <p className="muted tiny" style={{ marginTop: 2 }}>
                Downstream agentic coding synthesizers must adhere strictly to these schemas.
              </p>
              <ul className="dock-list" style={{ marginTop: 6 }}>
                <li className="issue-item notice">
                  <div className="issue-head">
                    <strong>/api/sensors (HTTP GET)</strong>
                    <code>JSON Contract</code>
                  </div>
                  <p>Publishes live sensor metrics: <code>temperature_c</code>, <code>humidity_pct</code>, <code>pressure_hpa</code>, <code>gas_ppm</code>, <code>distance_cm</code>.</p>
                </li>
                <li className="issue-item notice">
                  <div className="issue-head">
                    <strong>/api/control (HTTP POST)</strong>
                    <code>JSON / Form Contract</code>
                  </div>
                  <p>Handles actuator state commands (relay on/off, servo angle degree selection).</p>
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Tab 2: AI Assumptions */}
        {activeTab === 'assumptions' && (
          <div className="dock-section">
            <strong style={{ fontSize: 13.5 }}>Silent Engineering Decisions (Assumptions Log)</strong>
            <p className="muted tiny" style={{ marginTop: 2 }}>
              Decisions the AI made on your behalf so you didn't have to answer 20 trivial questions. Override anytime via “Revise”.
            </p>
            <ul className="assumption-list" style={{ marginTop: 10 }}>
              {allAssumptions.map((assumption, idx) => (
                <li key={idx} style={{ lineHeight: 1.6 }}>{assumption}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Tab 3: BOM */}
        {activeTab === 'bom' && (
          <div className="dock-section">
            <div className="bom-head" style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 13.5 }}>Bill of Materials (BOM)</strong>
              <button
                type="button"
                className="ghost-button tiny"
                onClick={() => void copyBom(graph)}
              >
                Copy TSV
              </button>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Part number</th>
                  <th>Supply</th>
                  <th>Datasheet</th>
                </tr>
              </thead>
              <tbody>
                {graph.nodes.map((node) => {
                  const supply = node.properties?.find((p) => p.label === 'Supply')?.value ?? '—';
                  const datasheet = node.properties?.find((p) => p.label === 'Datasheet')?.value ?? '';
                  return (
                    <tr key={node.id}>
                      <td>{node.name}</td>
                      <td><code>{node.partNumber || '—'}</code></td>
                      <td>{supply}</td>
                      <td>
                        {/^https?:\/\//i.test(datasheet) ? (
                          <a href={datasheet} target="_blank" rel="noreferrer" className="link">
                            open ↗
                          </a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 4: JSON */}
        {activeTab === 'json' && (
          <div className="dock-section">
            <CodeBlock path="graph.json" content={JSON.stringify(graph, null, 2)} defaultOpen />
          </div>
        )}
      </section>

      <ValidationDock />

      <section className="proceed-bar">
        <div className="proceed-copy">
          <strong>{blocking ? 'Resolve the blocking issues to continue' : 'Architecture Locked — ready for agentic build'}</strong>
          <p className="muted">
            {blocking
              ? 'The engineering rules found errors that would break the real build.'
              : 'Firmware + MERN dashboard are generated and terminally validated on the next page.'}
          </p>
        </div>
        <div className="proceed-actions">
          <input
            className="revise-input"
            placeholder="Not right? Say what to change and regenerate…"
            value={revisionNote}
            onChange={(event) => setRevisionNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && revisionNote.trim()) {
                void revise(revisionNote);
                setRevisionNote('');
              }
            }}
            disabled={working}
          />
          <button
            type="button"
            className="ghost-button"
            disabled={!revisionNote.trim() || working}
            onClick={() => {
              void revise(revisionNote);
              setRevisionNote('');
            }}
          >
            {working ? 'Regenerating…' : 'Revise'}
          </button>
          {hasFixableIssues && (
            <button
              type="button"
              className="ghost-button"
              disabled={working || repairing}
              onClick={() => void handleAutoRepair()}
              title="Deterministic repair pass: normalises the graph and re-runs the engineering rules. No LLM."
            >
              {repairing ? 'Repairing…' : '⟳ Auto-repair issues'}
            </button>
          )}
          <button type="button" className="primary-button" onClick={handleAccept} disabled={working || blocking}>
            Proceed to build →
          </button>
        </div>
      </section>
    </div>
  );
}
