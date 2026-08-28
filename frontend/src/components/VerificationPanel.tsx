import { useState } from 'react';

import { useGraphStore } from '../store/useGraphStore';
import type { CheckStatus, VerificationCheck, VerificationStatus } from '../types/architecture';
import { ShieldIcon } from './Icons';

const STATUS_COPY: Record<VerificationStatus, string> = {
  verified: 'Verified',
  review: 'Needs review',
  blocked: 'Blocked',
  unavailable: 'Unavailable',
};

const CHECK_ORDER: Record<CheckStatus, number> = { fail: 0, review: 1, pass: 2 };

/**
 * Surfaces the independent verifier pass — the second LLM call that reviews
 * the planner's output against the official component bank. Previously this
 * whole payload was computed server-side and then silently dropped by the UI.
 */
export default function VerificationPanel() {
  const verification = useGraphStore((state) => state.verification);
  const [showPassing, setShowPassing] = useState(false);

  if (!verification) {
    return (
      <section className="verify-panel">
        <header className="panel-bar">
          <div className="panel-title">
            <span className="bar-mark" style={{ background: 'var(--coral)' }} />
            Independent review
          </div>
          <span className="panel-mono">/ NO REPORT YET</span>
        </header>
        <div className="verify-empty">
          <ShieldIcon />
          <p>Generate a plan to run the independent architecture review.</p>
        </div>
      </section>
    );
  }

  const { status, score, summary, checks, sources } = verification;

  const counts = checks.reduce<Record<CheckStatus, number>>(
    (acc, check) => ({ ...acc, [check.status]: acc[check.status] + 1 }),
    { pass: 0, review: 0, fail: 0 },
  );

  const visibleChecks = checks
    .slice()
    .sort((a, b) => CHECK_ORDER[a.status] - CHECK_ORDER[b.status])
    .filter((check) => showPassing || check.status !== 'pass');

  return (
    <section className={`verify-panel verify-${status}`}>
      <header className="panel-bar">
        <div className="panel-title">
          <span className="bar-mark" style={{ background: 'var(--coral)' }} />
          Independent review
          <span className={`verify-pill verify-pill-${status}`}>{STATUS_COPY[status]}</span>
        </div>
        <span className="panel-mono">/ SCORE {score}/100</span>
      </header>

      <div className="verify-body">
        <div className="verify-summary">
          <div className="verify-score" aria-label={`Review score ${score} out of 100`}>
            <span className="verify-score-value">{score}</span>
            <span className="verify-score-unit">/100</span>
          </div>
          <p>{summary}</p>
        </div>

        <div className="verify-counts" role="list">
          <span role="listitem" className="verify-count fail">
            {counts.fail} fail
          </span>
          <span role="listitem" className="verify-count review">
            {counts.review} review
          </span>
          <span role="listitem" className="verify-count pass">
            {counts.pass} pass
          </span>
          {counts.pass > 0 && (
            <button type="button" className="verify-toggle" onClick={() => setShowPassing((v) => !v)}>
              {showPassing ? 'Hide passing checks' : 'Show passing checks'}
            </button>
          )}
        </div>

        <div className="verify-checks">
          {visibleChecks.map((check) => (
            <CheckRow key={check.id + check.title} check={check} />
          ))}
          {visibleChecks.length === 0 && (
            <p className="panel-mono">No outstanding checks — everything passed.</p>
          )}
        </div>

        {sources.length > 0 && (
          <div className="verify-sources">
            <div className="section-label">Cited sources</div>
            <ul>
              {sources.map((source) => (
                <li key={source.url + source.title}>
                  <a href={source.url} target="_blank" rel="noreferrer noopener">
                    {source.title}
                  </a>
                  <span className="panel-mono"> — {source.usedFor}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function CheckRow({ check }: { check: VerificationCheck }) {
  return (
    <article className={`verify-check verify-check-${check.status}`}>
      <header>
        <span className={`verify-badge verify-badge-${check.status}`}>{check.status}</span>
        <strong>{check.title}</strong>
        <span className="panel-mono">
          {check.scope}
          {check.targetId ? ` · ${check.targetId}` : ''}
        </span>
      </header>
      <p>{check.detail}</p>
    </article>
  );
}