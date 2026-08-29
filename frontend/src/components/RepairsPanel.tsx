import { useState } from 'react';

import { useGraphStore } from '../store/useGraphStore';

/**
 * "What I had to fix before this would draw."
 *
 * The planner is a language model, so its JSON arrives almost-right: pin names
 * instead of ids, a reused id, a link to a component it forgot to emit. The
 * backend repairs all of that deterministically — but a silent repair is
 * indistinguishable from a bug, so every one is listed here.
 *
 * Collapsed by default: this is a transparency record, not an action queue.
 */
export default function RepairsPanel() {
  const repairs = useGraphStore((state) => state.repairs);
  const selectNode = useGraphStore((state) => state.selectNode);
  const [open, setOpen] = useState(false);

  if (repairs.length === 0) return null;

  const warnings = repairs.filter((repair) => repair.severity === 'warning');

  return (
    <section className={`issues-panel${warnings.length > 0 ? '' : ' is-clean'}`}>
      <header className="panel-bar">
        <div className="panel-title">
          <span
            className="bar-mark"
            style={{ background: warnings.length > 0 ? '#e5ae46' : '#6db89f' }}
          />
          Auto-corrections applied
          {warnings.length > 0 && (
            <span className="verify-pill verify-pill-review">{warnings.length} to check</span>
          )}
        </div>
        <button
          type="button"
          className="suggestion"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          {open ? 'Hide' : `Show ${repairs.length}`}
        </button>
      </header>

      {open && (
        <ul className="detail-bullets">
          {repairs.map((repair, index) => (
            <li key={`${repair.code}-${index}`}>
              {repair.targetId ? (
                <button
                  type="button"
                  className="suggestion"
                  onClick={() => selectNode(repair.targetId ?? null)}
                >
                  {repair.message}
                </button>
              ) : (
                repair.message
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
