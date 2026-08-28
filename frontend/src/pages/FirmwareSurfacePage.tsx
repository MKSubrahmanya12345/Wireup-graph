import { useGraphStore } from '../store/useGraphStore';

export default function FirmwareSurfacePage() {
  const graph = useGraphStore((state) => state.graph);
  const softwareNodes = graph.nodes.filter((node) => node.type === 'software');

  return (
    <>
      <section className="heading-row">
        <div>
          <div className="eyebrow">Architecture workspace / 03</div>
          <h1>Firmware surface</h1>
          <p className="heading-sub">
            Software modules, libraries and firmware dependencies implied by the plan.
          </p>
        </div>
        <div className="header-meta">
          <span>{String(graph.software.length).padStart(2, '0')} MODULES</span>
          <span className="meta-sep">·</span>
          <span>{String(graph.dependencies.length).padStart(2, '0')} DEPS</span>
        </div>
      </section>

      <section className="details-grid">
        <article className="detail-card">
          <header>
            <h3>Software modules</h3>
            <span className="card-count">
              {String(graph.software.length).padStart(2, '0')} MODULES
            </span>
          </header>
          <div className="detail-list">
            {graph.software.length ? (
              graph.software.map((item) => (
                <div className="software-item" key={item.id}>
                  <div>
                    <div className="sw-name">{item.name}</div>
                    <div className="sw-meta">
                      {[item.kind, item.version].filter(Boolean).join(' / ') || 'unversioned'}
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
          {graph.software.length > 0 && (
            <ul className="detail-bullets">
              {graph.software
                .filter((item) => item.details)
                .map((item) => (
                  <li key={`${item.id}-details`}>{item.details}</li>
                ))}
            </ul>
          )}
        </article>

        <article className="detail-card">
          <header>
            <h3>Dependencies</h3>
            <span className="card-count">
              {String(graph.dependencies.length).padStart(2, '0')} DEPS
            </span>
          </header>
          <div className="detail-list">
            {graph.dependencies.length ? (
              graph.dependencies.map((dependency) => (
                <div className="detail-row" key={dependency.id}>
                  <div className="main-label">
                    <i className="connector" />
                    <span>{dependency.name}</span>
                  </div>
                  <span className="value">{dependency.version ?? dependency.kind}</span>
                </div>
              ))
            ) : (
              <span className="panel-mono">No dependencies declared</span>
            )}
          </div>
        </article>

        <article className="detail-card">
          <header>
            <h3>Software nodes in graph</h3>
            <span className="card-count">
              {String(softwareNodes.length).padStart(2, '0')} NODES
            </span>
          </header>
          <div className="detail-list">
            {softwareNodes.length ? (
              softwareNodes.map((node) => (
                <div className="detail-row" key={node.id}>
                  <div className="main-label">
                    <i className="connector" />
                    <span>{node.name}</span>
                  </div>
                  <span className="value">{node.partNumber ?? 'component'}</span>
                </div>
              ))
            ) : (
              <span className="panel-mono">No software components in the graph</span>
            )}
          </div>
        </article>
      </section>
    </>
  );
}