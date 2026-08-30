/**
 * ValidationPanel — the UI for the RAG validation loop.
 *
 * Shows doubts, validation status, score, and allows the user to
 * resolve doubts and trigger the validation loop until "project data perfect".
 */
import { useState } from 'react';
import { api } from '../services/api';
import { useGraphStore } from '../store/useGraphStore';

interface DoubtView {
  id: string;
  prompt: string;
  why?: string;
  impact?: string;
  resolved?: boolean;
  resolution?: string;
  kind: string;
  options: Array<{ value: string; label: string }>;
  defaultValue: string;
}

interface LoopView {
  loopId: string;
  status: string;
  doubtsAsked: number;
  doubtsResolved: number;
  completedAt?: string;
}

interface ValidationView {
  loopId?: string;
  isPerfect?: boolean;
  score?: number;
  summary?: string;
  doubts?: DoubtView[];
  validationLoops?: LoopView[];
}

export default function ValidationPanel() {
  const graphStore = useGraphStore();
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'perfect'>('idle');
  const [result, setResult] = useState<ValidationView | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  const handleRunLoop = async () => {
    setStatus('loading');
    try {
      const response = await api.runValidationLoop({
        graph: graphStore.graph,
        projectName: graphStore.graph.project,
        doubts: result?.doubts ?? [],
        resolvedDoubts: resolutions,
        requirements: null,
        notes: ['Triggered from ValidationPanel'],
      });
      setResult({
        loopId: response.loopId,
        isPerfect: response.isPerfect,
        score: response.score,
        summary: response.summary,
        doubts: response.doubts as unknown as DoubtView[],
        validationLoops: response.validationLoops as unknown as LoopView[],
      });
      setStatus(response.isPerfect ? 'perfect' : 'ready');
      if (response.isPerfect) {
        // Show a visual indicator that data is perfect
        setTimeout(() => setStatus('perfect'), 500);
      }
    } catch (error) {
      setStatus('idle');
      console.error('Validation loop error:', error);
    }
  };

  const handleResolveDoubt = (id: string, value: string) => {
    setResolutions((prev) => ({ ...prev, [id]: value }));
  };

  const doubts = result?.doubts ?? [];
  const resolvedCount = doubts.filter(
    (d) => d.resolved || Boolean(resolutions[d.id])
  ).length;

  const perfect = result?.isPerfect ?? false;

  return (
    <div className="validation-panel">
      <div className="panel-header">
        <h2>Validation Loop</h2>
        <span className={`status-badge ${perfect ? 'perfect' : status === 'perfect' ? 'perfect' : 'in-progress'}`}>
          {perfect ? '✓ PROJECT DATA PERFECT' : status === 'loading' ? 'Validating...' : `Score: ${result?.score ?? '--'}/100`}
        </span>
      </div>

      <div className="panel-body">
        {perfect && (
          <div className="perfect-banner">
            <strong>Project data perfect.</strong> This verified architecture is stored as a PRD (Graph DSA) and ready for agentic coding.
          </div>
        )}

        <p className="summary">{result?.summary ?? 'Run validation loop to see RAG-enhanced verification results.'}</p>

        {doubts.length > 0 && (
          <div className="doubts-section">
            <h3>Doubts ({resolvedCount}/{doubts.length} resolved)</h3>
            <ul className="doubts-list">
              {doubts.map((doubt) => (
                <li key={doubt.id} className={`doubt-item ${doubt.resolved || resolutions[doubt.id] ? 'resolved' : 'open'}`}>
                  <div className="doubt-prompt">{doubt.prompt}</div>
                  <div className="doubt-why">Why: {doubt.why || 'Material to architecture'}</div>
                  <div className="doubt-impact">Impact: {doubt.impact || 'Changes design'}</div>
                  {!doubt.resolved && !resolutions[doubt.id] && (
                    <div className="doubt-resolve">
                      <label>Resolve:</label>
                      <select
                        value={resolutions[doubt.id] ?? doubt.defaultValue ?? ''}
                        onChange={(e) => handleResolveDoubt(doubt.id, e.target.value)}
                      >
                        {(doubt.options ?? []).map((opt: { value: string; label: string }) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {(doubt.resolved || resolutions[doubt.id]) && (
                    <div className="doubt-resolved-label">✓ Resolved</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result?.validationLoops && result.validationLoops.length > 0 && (
          <div className="loops-section">
            <h3>Loop History</h3>
            <table>
              <thead>
                <tr>
                  <th>Loop ID</th>
                  <th>Status</th>
                  <th>Doubts Asked</th>
                  <th>Resolved</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {result.validationLoops.map((loop) => (
                  <tr key={loop.loopId}>
                    <td>{loop.loopId}</td>
                    <td>{loop.status}</td>
                    <td>{loop.doubtsAsked}</td>
                    <td>{loop.doubtsResolved}</td>
                    <td>{loop.completedAt ? new Date(loop.completedAt).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel-footer">
        <button
          onClick={handleRunLoop}
          disabled={status === 'loading' || !graphStore.graph}
          className="primary-button"
        >
          {status === 'loading' ? 'Running...' : 'Run Validation Loop'}
        </button>
        <button
          onClick={() => {
            api.checkPerfectStatus({ graph: graphStore.graph, doubts: doubts, resolvedDoubts: resolutions, requirements: null })
              .then((r) => {
                setResult((prev) => ({ ...prev, isPerfect: r.isPerfect, score: r.score, summary: r.summary }));
                setStatus(r.isPerfect ? 'perfect' : 'ready');
              })
              .catch(console.error);
          }}
          className="secondary-button"
        >
          Check Perfect Status
        </button>
      </div>
    </div>
  );
}
