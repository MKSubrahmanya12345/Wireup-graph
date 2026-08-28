import { useGraphStore } from '../store/useGraphStore';

const pad = (value: number) => String(value).padStart(2, '0');

export function ConnectionMatrix() {
  const graph = useGraphStore((state) => state.graph);
  const selectNode = useGraphStore((state) => state.selectNode);

  const labelFor = (id: string) =>
    graph.nodes.find((node) => node.id === id)?.name ?? id;

  return (
    <article className="detail-card">
      <header>
        <h3>Connection matrix</h3>
        <span className="card-count">{pad(graph.connections.length)} LINKS</span>
      </header>
      <div className="detail-list">
        {graph.connections.length ? (
          graph.connections.map((connection) => (
            <div className="detail-row" key={connection.id}>
              <div className="main-label">
                <i className="connector" />
                <button
                  type="button"
                  className="linkish"
                  onClick={() => selectNode(connection.from)}
                >
                  {labelFor(connection.from)}
                </button>
                <span className="panel-mono">→</span>
                <button
                  type="button"
                  className="linkish"
                  onClick={() => selectNode(connection.to)}
                >
                  {labelFor(connection.to)}
                </button>
              </div>
              <span className="value">{connection.kind}</span>
            </div>
          ))
        ) : (
          <span className="panel-mono">No connections returned</span>
        )}
      </div>
    </article>
  );
}

export function DependencyChain() {
  const graph = useGraphStore((state) => state.graph);

  return (
    <article className="detail-card">
      <header>
        <h3>Dependency chain</h3>
        <span className="card-count">ORDERED</span>
      </header>
      <div className="detail-list">
        {graph.dependencies.length ? (
          graph.dependencies.map((dependency, index) => (
            <div className="detail-row" key={dependency.id}>
              <div className="main-label">
                <span className="card-count">{pad(index + 1)}</span>
                <span>{dependency.name}</span>
              </div>
              <span className="value">{dependency.version ?? dependency.kind}</span>
            </div>
          ))
        ) : (
          <span className="panel-mono">No dependencies declared</span>
        )}
      </div>
      {graph.dependencies.length > 0 && (
        <ul className="detail-bullets">
          {graph.dependencies
            .filter((dependency) => dependency.reason)
            .map((dependency) => (
              <li key={`${dependency.id}-reason`}>{dependency.reason}</li>
            ))}
        </ul>
      )}
    </article>
  );
}

export function SoftwareSurface() {
  const graph = useGraphStore((state) => state.graph);
  const software = graph.software;

  return (
    <article className="detail-card">
      <header>
        <h3>Software surface</h3>
        <span className="card-count">{pad(software.length)} MODULES</span>
      </header>
      <div className="detail-list">
        {software.length ? (
          software.map((item) => (
            <div className="software-item" key={item.id}>
              <div>
                <div className="sw-name">{item.name}</div>
                <div className="sw-meta">
                  {[item.kind, item.version, item.details].filter(Boolean).join(' / ')}
                </div>
              </div>
              <span className={`status-pill${item.version ? '' : ' proposed'}`}>
                {item.version ? 'mapped' : 'review'}
              </span>
            </div>
          ))
        ) : (
          <span className="panel-mono">No software declared</span>
        )}
      </div>
    </article>
  );
}