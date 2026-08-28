import { useState } from 'react';

import { useGraphStore } from '../store/useGraphStore';

export default function JsonDrawer() {
  const graph = useGraphStore((state) => state.graph);
  const verification = useGraphStore((state) => state.verification);
  const [open, setOpen] = useState(false);

  return (
    <section className="json-drawer">
      <button
        type="button"
        className="json-toggle"
        data-testid="button-toggle-json"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <strong>Graph JSON</strong>
        <span>{open ? 'HIDE RAW MODEL' : 'SHOW RAW MODEL'}</span>
      </button>
      {open && (
        <div id="json-content" className="open">
          <pre id="graph-json">{JSON.stringify({ ...graph, verification }, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}