import { useMemo, useState } from 'react';

import { STATUS_LABEL, type SpecNode, type SpecNodeStatus } from '../types/specGraph';

/**
 * The live spec graph.
 *
 * Nodes are rendered in the order the engine spawned them, so the board fills
 * in as the decomposition runs — with the still-unresolved ones visibly marked
 * rather than papered over. Nothing here pretends the graph is finished: a
 * node that is waiting on an answer says so.
 */

const STATUS_ORDER: SpecNodeStatus[] = [
  'unresolved',
  'needs_revalidation',
  'assumed',
  'validated',
  'user_confirmed',
];

/** One accent per domain, picked deterministically so colours never jitter. */
const DOMAIN_HUES = [
  '#22d3ee',
  '#a78bfa',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#60a5fa',
  '#fb923c',
  '#4ade80',
];

function hueFor(domain: string): string {
  let hash = 0;
  for (let i = 0; i < domain.length; i += 1) hash = (hash * 31 + domain.charCodeAt(i)) >>> 0;
  return DOMAIN_HUES[hash % DOMAIN_HUES.length]!;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${formatValue(v)}`)
    .join(', ');
  return String(value);
}

/** The spec keys worth showing — the rest is noise on a first read. */
const INTERESTING_KEYS = [
  'board', 'part', 'device_id', 'bus', 'pin', 'sda', 'scl', 'supply_v',
  'transport', 'reach', 'path', 'framework', 'source', 'target_runtime',
  'estimated_draw_ma', 'pull', 'metrics',
];

export default function SpecGraphBoard({
  nodes,
  streaming,
}: {
  nodes: SpecNode[];
  streaming: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const ordered = useMemo(() => {
    const copy = [...nodes];
    copy.sort((a, b) => {
      const delta = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      return delta !== 0 ? delta : 0;
    });
    return copy;
  }, [nodes]);

  const unresolved = nodes.filter((node) => node.status === 'unresolved').length;

  if (nodes.length === 0) {
    return (
      <div className="spec-board">
        <div className="spec-board-head">
          <span className="panel-title">Spec graph</span>
          <span className="panel-mono">
            {streaming ? 'decomposing…' : 'idle'}
          </span>
        </div>
        <div className="spec-board-empty">
          {streaming
            ? 'Reading the brief — extracting the parts you named and inferring what they imply…'
            : 'Describe what you want to build. Capabilities get one node each as the engine finds them.'}
        </div>
      </div>
    );
  }

  return (
    <div className="spec-board">
      <div className="spec-board-head">
        <span className="panel-title">Spec graph</span>
        <span className="panel-mono">
          {String(nodes.length).padStart(2, '0')} NODES
          {unresolved > 0 ? ` · ${unresolved} WAITING ON YOU` : ''}
          {streaming ? ' · LIVE' : ''}
        </span>
      </div>

      <div className="spec-node-grid">
        {ordered.map((node) => {
          const hue = hueFor(node.domain);
          const isOpen = expanded === node.id;
          const facts = Object.entries(node.spec).filter(([key]) =>
            INTERESTING_KEYS.includes(key),
          );
          const errors = node.validation.issues.filter((i) => i.severity === 'error');

          return (
            <article
              key={node.id}
              className={`spec-node status-${node.status}${isOpen ? ' open' : ''}`}
              style={{ '--node-hue': hue } as React.CSSProperties}
            >
              <header>
                <span className="spec-domain">{node.domain}</span>
                <span className="spec-status">{STATUS_LABEL[node.status]}</span>
              </header>

              <h4>{node.title}</h4>

              {errors.length > 0 && (
                <p className="spec-node-error">
                  {errors.map((e) => e.message).join(' ')}
                </p>
              )}

              {facts.length > 0 && (
                <dl className={`spec-facts${isOpen ? '' : ' clipped'}`}>
                  {facts.slice(0, isOpen ? facts.length : 3).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key.replace(/_/g, ' ')}</dt>
                      <dd>{formatValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {node.open_questions.length > 0 && (
                <p className="spec-open-q">
                  ❓ {node.open_questions.length} question
                  {node.open_questions.length > 1 ? 's' : ''} for you
                </p>
              )}

              {node.requires.length > 0 && (
                <p className="spec-requires">
                  needs {node.requires.map((r) => r.replace(/^node_/, '')).join(', ')}
                </p>
              )}

              {(node.assumptions.length > 0 || facts.length > 3) && (
                <button
                  type="button"
                  className="spec-toggle"
                  onClick={() => setExpanded(isOpen ? null : node.id)}
                >
                  {isOpen ? 'Less' : `Why · ${node.assumptions.length} decision(s)`}
                </button>
              )}

              {isOpen && node.assumptions.length > 0 && (
                <ul className="spec-assumptions">
                  {node.assumptions.map((a, i) => (
                    <li key={i}>
                      <strong>{a.claim}</strong>
                      <span>{a.why}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}

        {streaming && (
          <article className="spec-node pending" aria-hidden>
            <span className="spec-pulse" />
            resolving next capability…
          </article>
        )}
      </div>
    </div>
  );
}
