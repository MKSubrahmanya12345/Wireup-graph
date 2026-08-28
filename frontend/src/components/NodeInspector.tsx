import { Fragment } from 'react';

import { useGraphStore, selectSelectedNode } from '../store/useGraphStore';
import { CrosshairIcon } from './Icons';

export default function NodeInspector() {
  const node = useGraphStore(selectSelectedNode);
  const graph = useGraphStore((state) => state.graph);

  const related = node
    ? graph.connections.filter(
        (connection) => connection.from === node.id || connection.to === node.id,
      )
    : [];

  return (
    <aside className="inspector" aria-labelledby="inspector-title">
      <div className="panel-bar">
        <div className="panel-title">
          <span className="bar-mark" style={{ background: 'var(--coral)' }} />
          <span id="inspector-title">Node inspection</span>
        </div>
        <span className="panel-mono">{node ? 'SELECTED' : 'NONE'}</span>
      </div>

      <div className="inspector-body">
        {!node ? (
          <div className="empty-inspector">
            <CrosshairIcon />
            <p>
              Select a node on the graph to inspect its metadata, pins, and connected
              dependencies.
            </p>
          </div>
        ) : (
          <>
            <div className="selected-node">
              <div className="node-kind">
                {node.type} / {node.id}
              </div>
              <h2>{node.name}</h2>
              <p>{node.description || 'No description returned by the architecture service.'}</p>
            </div>

            <div className="inspector-section">
              <div className="section-label">Metadata</div>
              <dl className="kv">
                {node.partNumber && (
                  <>
                    <dt>part</dt>
                    <dd>{node.partNumber}</dd>
                  </>
                )}
                {node.properties.length ? (
                  node.properties.map((property) => (
                    <Fragment key={property.label}>
                      <dt>{property.label}</dt>
                      <dd>{property.value}</dd>
                    </Fragment>
                  ))
                ) : (
                  <>
                    <dt>status</dt>
                    <dd>Returned without metadata</dd>
                  </>
                )}
              </dl>
            </div>

            <div className="inspector-section">
              <div className="section-label">Interfaces / pins</div>
              <div className="pin-list">
                {node.ports.length ? (
                  node.ports.map((port) => (
                    <div className="pin" key={port.id}>
                      <strong>{port.label || port.id}</strong>
                      <span>
                        {port.signal} · {port.direction}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="panel-mono">No pins declared</div>
                )}
              </div>
            </div>

            {node.details.length > 0 && (
              <div className="inspector-section">
                <div className="section-label">Build notes</div>
                <ul className="detail-bullets">
                  {node.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="inspector-section">
              <div className="section-label">
                Connections <span style={{ float: 'right' }}>{related.length}</span>
              </div>
              <div className="tag-list">
                {related.length ? (
                  related.map((connection) => (
                    <span className="tag" key={connection.id}>
                      {connection.label || connection.kind}
                    </span>
                  ))
                ) : (
                  <span className="panel-mono">No connections</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}