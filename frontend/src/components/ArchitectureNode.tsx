import { Handle, Position, type NodeProps } from '@xyflow/react';

import { paletteFor } from '../lib/palette';
import type { ArchitectureNodeType } from '../lib/graphAdapter';
import { sourceHandleId, targetHandleId } from '../lib/graphAdapter';

/** One React Flow node = one component in the canonical graph. */
export default function ArchitectureNode({ data }: NodeProps<ArchitectureNodeType>) {
  const { node, selected } = data;
  const palette = paletteFor(node.type);
  const portCount = node.ports.length;

  return (
    <div
      className={`arch-node${selected ? ' is-selected' : ''}`}
      style={{
        background: palette.fill,
        borderColor: selected ? palette.text : palette.stroke,
        color: palette.text,
      }}
    >
      {node.ports.map((port, index) => {
        const top = portCount === 1 ? 50 : 18 + (index * 64) / (portCount - 1);
        // A pin with no id cannot be addressed by a connection, so it gets no
        // handles — the backend repair pass assigns ids, this is the backstop.
        if (!port.id) return null;
        return (
          <span key={port.id}>
            <Handle
              type="target"
              id={targetHandleId(port.id)}
              position={Position.Left}
              style={{ top: `${top}%`, background: palette.stroke }}
            />
            <Handle
              type="source"
              id={sourceHandleId(port.id)}
              position={Position.Right}
              style={{ top: `${top}%`, background: palette.stroke }}
            />
          </span>
        );
      })}

      <div className="arch-node-kind" style={{ color: palette.text }}>
        {node.type}
      </div>
      <div className="arch-node-name">{node.name}</div>
      <div className="arch-node-desc">{node.description || 'Architecture component'}</div>
      {node.partNumber && <div className="arch-node-part">{node.partNumber}</div>}
    </div>
  );
}