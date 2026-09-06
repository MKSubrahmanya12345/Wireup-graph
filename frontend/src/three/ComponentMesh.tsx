/**
 * ComponentMesh.tsx — one graph node as a true-scale parametric part.
 *
 * The visible body comes from PartModel (real outlines, live animation).
 * Interaction lives here: hover highlight + tag, click select, XZ drag with
 * commit-on-release (mirrors GraphCanvas onNodeDragStop). Pressable caps and
 * knobs inside the body stopPropagation, so pressing a button never drags
 * the part — that was the "pushbutton does nothing" class of bug.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ArchitectureNode } from '../types/architecture';
import PartModel, { partKeyForNode } from './PartModel';
import { dimForKey } from './dimensions';
import { resolvePosition3d, resolveRotation3d } from './partGeometry';
import { useGraphStore } from '../store/useGraphStore';

interface ComponentMeshProps {
  node: ArchitectureNode;
  isSelected: boolean;
}

export default function ComponentMesh({ node, isSelected }: ComponentMeshProps) {
  const selectNode = useGraphStore((s) => s.selectNode);
  const moveNode3D = useGraphStore((s) => s.moveNode3D);

  const partKey = useMemo(() => partKeyForNode(node), [node]);
  const dims = useMemo(() => dimForKey(partKey), [partKey]);

  const pos = useMemo(
    () => resolvePosition3d(node.x, node.y, node.spatial),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.x, node.y, node.spatial?.position3d?.x, node.spatial?.position3d?.y, node.spatial?.position3d?.z],
  );
  const rot = useMemo(
    () => resolveRotation3d(node.spatial),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.spatial?.rotation3d?.x, node.spatial?.rotation3d?.y, node.spatial?.rotation3d?.z],
  );

  const [hovered, setHovered] = useState(false);
  const [localPos, setLocalPos] = useState<{ x: number; y: number; z: number } | null>(null);
  const dragging = useRef(false);
  const dragPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const dragOffset = useRef(new THREE.Vector3());
  const hit = useRef(new THREE.Vector3());

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      selectNode(node.id);
    },
    [selectNode, node.id],
  );

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      dragging.current = true;
      const meshPos = new THREE.Vector3(pos.x, pos.y, pos.z);
      dragOffset.current.copy(meshPos).sub(e.point);
    },
    [pos],
  );

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      e.stopPropagation();
      if (e.ray.intersectPlane(dragPlane.current, hit.current)) {
        setLocalPos({
          x: hit.current.x + dragOffset.current.x,
          y: pos.y,
          z: hit.current.z + dragOffset.current.z,
        });
      }
    },
    [pos.y],
  );

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      dragging.current = false;
      e.stopPropagation();
      if (localPos) {
        moveNode3D(node.id, localPos);
        setLocalPos(null);
      }
    },
    [localPos, moveNode3D, node.id],
  );

  const displayPos = localPos ?? pos;
  // Hit volume covers the whole true outline + lift so small parts stay grabbable,
  // with a minimum 12 mm touch target for 0402-class bodies.
  const hitW = Math.max(dims.w + 0.004, 0.012);
  const hitH = Math.max(dims.h + dims.lift + 0.004, 0.012);
  const hitD = Math.max(dims.d + 0.004, 0.012);

  return (
    <group position={[displayPos.x, displayPos.y, displayPos.z]} rotation={[rot.x, rot.y, rot.z]}>
      <PartModel node={node} liveId={node.id} selected={isSelected} hovered={hovered} />
      {/* invisible grab volume — the body owns the visuals */}
      <mesh
        position={[0, dims.lift + dims.h / 2, 0]}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'grab';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = '';
        }}
      >
        <boxGeometry args={[hitW, hitH, hitD]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
