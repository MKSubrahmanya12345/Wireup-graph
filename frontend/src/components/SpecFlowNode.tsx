import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import { statusMeta } from '../lib/specGraphStatus';
import type { SpecNode } from '../types/specGraph';

export type SpecFlowNodeData = { node: SpecNode; selected: boolean };
export type SpecFlowNodeType = Node<SpecFlowNodeData, 'spec'>;

/** One React Flow node = one spec-graph node (domain + status-driven). */
export default function SpecFlowNode({ data }: NodeProps<SpecFlowNodeType>) {
  const { node, selected } = data;
  const meta = statusMeta(node.status);
  const specKeys = Object.keys(node.spec ?? {});

  return (
    <div
      className={`spec-node status-${node.status}${selected ? ' is-selected' : ''}`}
      style={{ borderColor: selected ? meta.color : undefined }}
    >
      <Handle type="target" position={Position.Left} className="spec-handle" />
      <div className="spec-node-top">
        <span className="spec-node-domain">{node.domain}</span>
        <span className="spec-status-chip" style={{ color: meta.color, background: meta.fill }}>
          {meta.label}
        </span>
      </div>
      <div className="spec-node-title">{node.title}</div>
      <div className="spec-node-spec">
        {specKeys.length > 0 ? (
          <code>{specKeys.slice(0, 3).map((k) => `${k}: ${String(node.spec[k])}`).join(' · ')}</code>
        ) : (
          <code className="muted">unresolved spec</code>
        )}
      </div>
      <div className="spec-node-meta">
        <span>{node.requires.length} req</span>
        <span>{node.spawned.length} spawn</span>
        {node.open_questions.length > 0 && <span className="warn">{node.open_questions.length} q</span>}
      </div>
      <Handle type="source" position={Position.Right} className="spec-handle" />
    </div>
  );
}
