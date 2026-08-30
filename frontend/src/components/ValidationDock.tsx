import { useState } from 'react';

import { useGraphStore } from '../store/useGraphStore';

/**
 * The proof panel: engineering-rule verdicts, automatic repairs, structural
 * verification and datasheet sources — everything that makes the graph
 * trustworthy, in one dock.
 */
export default function ValidationDock() {
  const issues = useGraphStore((state) => state.issues);
  const repairs = useGraphStore((state) => state.repairs);
  const verification = useGraphStore((state) => state.verification);
  const blocking = useGraphStore((state) => state.blocking);
  const [open, setOpen] = useState<Record<string, boolean>>({ issues: true });

  const toggle = (key: string) => setOpen((current) => ({ ...current, [key]: !current[key] }));

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const notices = issues.filter((i) => i.severity === 'notice');

  return (
    <section className="dock">
      <div className="dock-summary">
        <span className={`verdict-pill ${blocking ? 'bad' : errors.length ? 'bad' : warnings.length ? 'warn' : 'good'}`}>
          {blocking
            ? '⛔ blocking issues'
            : errors.length
              ? `✘ ${errors.length} error(s)`
              : warnings.length
                ? `⚠ ${warnings.length} warning(s)`
                : '✔ engineering checks pass'}
        </span>
        {verification && (
          <span className="verdict-pill neutral">
            verification: {verification.status} · score {verification.score}
          </span>
        )}
        {repairs.length > 0 && (
          <span className="verdict-pill neutral">{repairs.length} auto-repair(s)</span>
        )}
        {notices.length > 0 && <span className="verdict-pill neutral">{notices.length} notice(s)</span>}
      </div>

      {issues.length > 0 && (
        <div className="dock-section">
          <button type="button" className="dock-toggle" onClick={() => toggle('issues')}>
            {open.issues ? '▾' : '▸'} Engineering issues ({issues.length})
          </button>
          {open.issues && (
            <ul className="dock-list">
              {issues.map((issue) => (
                <li key={issue.id} className={`issue-item ${issue.severity}`}>
                  <div className="issue-head">
                    <span className={`severity-dot ${issue.severity}`} />
                    <strong>{issue.title}</strong>
                    <code>{issue.code}</code>
                  </div>
                  <p>{issue.detail}</p>
                  {issue.remedy && <p className="issue-remedy">Fix: {issue.remedy}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {verification && (
        <div className="dock-section">
          <button type="button" className="dock-toggle" onClick={() => toggle('checks')}>
            {open.checks ? '▾' : '▸'} Structural verification ({verification.checks.length} checks)
          </button>
          {open.checks && (
            <>
              <ul className="dock-list">
                {verification.checks.map((check) => (
                  <li key={check.id} className={`check-item ${check.status}`}>
                    <span className="check-icon">
                      {check.status === 'pass' ? '✔' : check.status === 'fail' ? '✘' : '◐'}
                    </span>
                    <div>
                      <strong>{check.title}</strong>
                      {check.detail && <p>{check.detail}</p>}
                    </div>
                  </li>
                ))}
              </ul>
              {verification.sources.length > 0 && (
                <div className="sources-row">
                  <span className="sources-label">datasheet evidence:</span>
                  {verification.sources.map((source) => (
                    <a key={source.title} href={source.url} target="_blank" rel="noreferrer" className="source-chip" title={source.usedFor}>
                      {source.title}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {repairs.length > 0 && (
        <div className="dock-section">
          <button type="button" className="dock-toggle" onClick={() => toggle('repairs')}>
            {open.repairs ? '▾' : '▸'} Automatic repairs ({repairs.length})
          </button>
          {open.repairs && (
            <ul className="dock-list">
              {repairs.map((repair, index) => (
                <li key={`${repair.code}-${index}`} className="repair-item">
                  <code>{repair.code}</code> {repair.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
