import { useState } from 'react';

import { useDesignSession } from '../store/useDesignSession';
import { useGraphStore } from '../store/useGraphStore';

/**
 * "Is this good?" — the human's main job.
 *
 * Perfect! locks it. Anything else is captured as a correction and folded into
 * the next revision, so the loop converges instead of restarting.
 */
export default function ConfirmBar() {
  const stage = useDesignSession((state) => state.stage);
  const revision = useDesignSession((state) => state.revision);
  const feedback = useDesignSession((state) => state.feedback);
  const accept = useDesignSession((state) => state.accept);
  const revise = useDesignSession((state) => state.revise);
  const blocking = useGraphStore((state) => state.blocking);

  const [note, setNote] = useState('');
  const busy = stage === 'planning' || stage === 'interpreting';

  if (stage !== 'reviewing' && stage !== 'accepted') return null;

  if (stage === 'accepted') {
    return (
      <section className="confirm-bar is-accepted">
        <div>
          <strong>Locked in.</strong> Revision {revision} accepted.
        </div>
        <button type="button" className="suggestion" onClick={() => void useDesignSession.getState().reset()}>
          Start something new
        </button>
      </section>
    );
  }

  return (
    <section className={`confirm-bar${blocking ? ' is-warning' : ''}`}>
      <div className="confirm-head">
        <strong>Is this good?</strong>
        <span className="panel-mono">
          REVISION {revision}
          {feedback.length > 0 ? ` · ${feedback.length} CORRECTION(S)` : ''}
        </span>
      </div>

      {blocking && (
        <p className="confirm-note">
          There are blocking issues above. You can still accept, but this will not work as drawn.
        </p>
      )}

      <div className="confirm-form">
        <input
          className="confirm-input"
          value={note}
          placeholder="What's wrong? e.g. the servos can't lift the legs — I need 3 joints per leg"
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && note.trim()) {
              event.preventDefault();
              void revise(note);
              setNote('');
            }
          }}
        />
        <button
          type="button"
          className="suggestion"
          disabled={busy || !note.trim()}
          onClick={() => {
            void revise(note);
            setNote('');
          }}
        >
          {busy ? 'Rebuilding…' : 'Revise'}
        </button>
        <button type="button" className="accept-button" disabled={busy} onClick={accept}>
          Perfect!
        </button>
      </div>

      {feedback.length > 0 && (
        <ul className="detail-bullets">
          {feedback.map((entry, index) => (
            <li key={`${index}-${entry}`}>{entry}</li>
          ))}
        </ul>
      )}
    </section>
  );
}