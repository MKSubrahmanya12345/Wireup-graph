import { useState } from 'react';

// three.js is heavy — only fetched when the user asks for the 3D view.
const ThreeViewport = lazy(() => import('../three/ThreeViewport'));
import { Link, useNavigate } from 'react-router-dom';

import type { ArchitectureGraph } from '../types/architecture';

/** Copy the parts list to the clipboard as TSV (spreadsheet-friendly). */
async function copyBom(graph: ArchitectureGraph): Promise<void> {
  const rows = [
    ['Component', 'Part number', 'Supply'],
    ...graph.nodes.map((node) => [
      node.name,
      node.partNumber ?? '',
      node.properties?.find((p) => p.label === 'Supply')?.value ?? '',
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

import { Suspense, lazy } from 'react';
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

type ViewMode = '2d' | '3d';

/**
 * Page 02 — the architecture graph.
 * The validated system plan: drag nodes, inspect parts, read the engineering
 * verdict, then send it to the agentic build.
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
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [revisionNote, setRevisionNote] = useState('');
  const [repairing, setRepairing] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const navigate = useNavigate();

  const hasGraph = graph.nodes.length > 0;
  const working = stage === 'planning' || stage === 'interpreting' || status === 'planning';
  const hasFixableIssues = issues.length > 0;

  /** Deterministic repair loop — fixes what is mechanically fixable, then
   *  reports what remains instead of leaving the page frozen. */
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
    // Same check page 01's "Complete" button uses — one implementation.
    const validity = evaluateGraphValidity({ graph, issues, blocking, verification });
    if (!validity.valid) {
      toast(validity.reason);
      return;
    }
    accept();
    navigate('/build');
  };

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
          <button type="button" className="ghost-button" onClick={() => setShowJson((v) => !v)}>
            {showJson ? 'Hide JSON' : 'View JSON'}
          </button>
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
              <Suspense fallback={<div className="empty-state"><span className="boot-mark">◈</span><p className="muted">Loading 3D viewport…</p></div>}>
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

      {graph.nodes.length > 0 && (
        <section className="bom-card">
          <div className="bom-head">
            <div className="eyebrow">parts list (BOM)</div>
            <button
              type="button"
              className="ghost-button tiny"
              onClick={() => void copyBom(graph)}
            >
              Copy BOM
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
        </section>
      )}

      {showJson && (
        <section className="json-card">
          <CodeBlock path="graph.json" content={JSON.stringify(graph, null, 2)} defaultOpen />
        </section>
      )}

      <ValidationDock />

      {graph.notes.length > 0 && (
        <section className="notes-card">
          <div className="eyebrow">engineering notes</div>
          <ul>
            {graph.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="proceed-bar">
        <div className="proceed-copy">
          <strong>{blocking ? 'Resolve the blocking issues to continue' : 'Graph validated — ready for the agentic build'}</strong>
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
