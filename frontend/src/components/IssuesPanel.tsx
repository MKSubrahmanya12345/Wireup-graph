import { useDesignSession } from '../store/useDesignSession';
import { useGraphStore } from '../store/useGraphStore';
import type { Issue, IssueSeverity } from '../types/architecture';
import { ShieldIcon } from './Icons';

const ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, notice: 2 };

/**
 * The conversation medium. Every finding is deterministic, names the evidence,
 * and offers a remedy — plus an explicit "accept risk" so the human can
 * override the checker rather than fight it.
 */
export default function IssuesPanel() {
  const issues = useGraphStore((state) => state.issues);
  const blocking = useGraphStore((state) => state.blocking);
  const acceptedRisks = useDesignSession((state) => state.acceptedRisks);
  const acceptRisk = useDesignSession((state) => state.acceptRisk);
  const selectNode = useGraphStore((state) => state.selectNode);

  if (issues.length === 0) {
    return (
      <section className="issues-panel is-clean">
        <header className="panel-bar">
          <div className="panel-title">
            <span className="bar-mark" style={{ background: '#6db89f' }} />
            Engineering checks
          </div>
          <span className="panel-mono">/ ALL CLEAR</span>
        </header>
        <div className="issues-empty">
          <ShieldIcon />
          <p>No current, connectivity, or mechanical violations found.</p>
        </div>
      </section>
    );
  }

  const visible = issues
    .filter((issue) => !acceptedRisks.includes(issue.id))
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  const remainingBlocking = visible.filter((issue) => issue.severity === 'error');

  return (
    <section className={`issues-panel${blocking ? ' is-blocking' : ''}`}>
      <header className="panel-bar">
        <div className="panel-title">
          <span className="bar-mark" style={{ background: 'var(--coral)' }} />
          Engineering checks
          {remainingBlocking.length > 0 && (
            <span className="verify-pill verify-pill-blocked">
              {remainingBlocking.length} blocking
            </span>
          )}
        </div>
        <span className="panel-mono">
          / {visible.length} OPEN · {acceptedRisks.length} ACCEPTED
        </span>
      </header>

      <div className="issues-body">
        {blocking && remainingBlocking.length > 0 && (
          <p className="issues-warning">
            This design will not work as drawn. Power it up and it fails — fix the blocking
            issues below, or accept the risk consciously.
          </p>
        )}

        {visible.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            onAccept={() => acceptRisk(issue.id)}
            onSelect={issue.targetId ? () => selectNode(issue.targetId!) : undefined}
          />
        ))}

        {visible.length === 0 && (
          <p className="panel-mono">Every finding has been accepted. Proceed knowingly.</p>
        )}
      </div>
    </section>
  );
}

function IssueRow({
  issue,
  onAccept,
  onSelect,
}: {
  issue: Issue;
  onAccept: () => void;
  onSelect?: () => void;
}) {
  return (
    <article className={`issue issue-${issue.severity}`}>
      <header>
        <span className={`verify-badge verify-badge-${issue.severity}`}>{issue.severity}</span>
        <strong>{issue.title}</strong>
        <span className="panel-mono">
          {issue.code}
          {issue.targetId ? ` · ${issue.targetId}` : ''}
        </span>
      </header>

      <p>{issue.detail}</p>

      {issue.remedy && <p className="issue-remedy">Fix: {issue.remedy}</p>}

      <div className="issue-actions">
        {onSelect && (
          <button type="button" className="linkish" onClick={onSelect}>
            Show me
          </button>
        )}
        <button type="button" className="linkish" onClick={onAccept}>
          Accept this risk
        </button>
      </div>
    </article>
  );
}