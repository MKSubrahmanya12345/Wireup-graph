import { useGraphStore } from '../store/useGraphStore';
import type { ConnectionKind } from '../types/architecture';

export default function SignalMapPage() {
  const graph = useGraphStore((state) => state.graph);
  const selectNode = useGraphStore((state) => state.selectNode);

  const byKind = graph.connections.reduce<Record<string, typeof graph.connections>>(
    (acc, connection) => ({
      ...acc,
      [connection.kind]: [...(acc[connection.kind] ?? []), connection],
    }),
    {},
  );

  const nameFor = (id: string) => graph.nodes.find((node) => node.id === id)?.name ?? id;

  return (
    <>
      <section className="heading-row">
        <div>
          <div className="eyebrow">Architecture workspace / 02</div>
          <h1>Signal map</h1>
          <p className="heading-sub">
            Every declared connection, grouped by signal class. Click a row to inspect the node.
          </p>
        </div>
        <div className="header-meta">
          <span>{String(graph.connections.length).padStart(2, '0')} LINKS</span>
        </div>
      </section>

      {graph.connections.length === 0 ? (
        <section className="detail-card">
          <p className="panel-mono">No connections yet — generate a plan first.</p>
        </section>
      ) : (
        <section className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>From</th>
                <th>Port</th>
                <th>To</th>
                <th>Port</th>
                <th>Label</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {graph.connections.map((connection) => (
                <tr key={connection.id} onClick={() => selectNode(connection.from)}>
                  <td>
                    <span className={`kind-chip kind-${connection.kind as ConnectionKind}`}>
                      {connection.kind}
                    </span>
                  </td>
                  <td>{nameFor(connection.from)}</td>
                  <td className="panel-mono">{connection.fromPort ?? '—'}</td>
                  <td>{nameFor(connection.to)}</td>
                  <td className="panel-mono">{connection.toPort ?? '—'}</td>
                  <td>{connection.label}</td>
                  <td className="muted-cell">{connection.details || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="details-grid">
        {(Object.keys(byKind) as ConnectionKind[]).map((kind) => (
          <article className="detail-card" key={kind}>
            <header>
              <h3>{kind}</h3>
              <span className="card-count">
                {String(byKind[kind]?.length ?? 0).padStart(2, '0')} LINKS
              </span>
            </header>
            <ul className="detail-bullets">
              {(byKind[kind] ?? []).map((connection) => (
                <li key={connection.id}>
                  {nameFor(connection.from)} → {nameFor(connection.to)}
                  {connection.details ? ` — ${connection.details}` : ''}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </>
  );
}