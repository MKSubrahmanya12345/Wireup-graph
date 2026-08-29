/**
 * ComponentMesh.tsx
 * Renders one ArchitectureNode as a 3D mesh.
 * Geometry and material are memoized — they are NOT recreated on every render.
 *
 * mesh selection syncs to useGraphStore.selectNode so both views share state.
 * drag logic lives here in local state; moveNode3D fires only on drag-stop
 *         (mirrors the GraphCanvas.tsx → onNodeDragStop pattern exactly).
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ArchitectureNode, NodeType } from '../types/architecture';
import { paletteFor } from '../lib/palette';
import { resolveBoxDimensions, resolvePosition3d, resolveRotation3d } from './partGeometry';
import { useGraphStore } from '../store/useGraphStore';

interface ComponentMeshProps {
  node: ArchitectureNode;
  isSelected: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: (id: string) => void;
}

// Material is created ONCE per node type (22 types × 2 states = ~44 objects max)
// using a module-level cache so they survive re-renders.
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function getMaterial(type: NodeType, selected: boolean): THREE.MeshStandardMaterial {
  const key = `${type}-${selected ? 'sel' : 'base'}`;
  if (materialCache.has(key)) return materialCache.get(key)!;

  const palette = paletteFor(type);
  // Parse hex color from palette stroke
  const color = new THREE.Color(selected ? palette.stroke : palette.fill);
  const emissive = new THREE.Color(selected ? palette.stroke : '#000000');

  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: selected ? 0.25 : 0,
    roughness: 0.45,
    metalness: 0.3,
  });
  materialCache.set(key, mat);
  return mat;
}

export default function ComponentMesh({ node, isSelected, onDragStart, onDragEnd }: ComponentMeshProps) {
  const selectNode = useGraphStore((s) => s.selectNode);
  const moveNode3D = useGraphStore((s) => s.moveNode3D);

  const dims = useMemo(
    () => resolveBoxDimensions(node.type, node.spatial),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.type, node.spatial?.dimensions?.w, node.spatial?.dimensions?.h, node.spatial?.dimensions?.d],
  );

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

  // local transient position during drag; committed on drag-stop.
  const [localPos, setLocalPos] = useState<{ x: number; y: number; z: number } | null>(null);
  const isDragging = useRef(false);
  const dragPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const dragOffset = useRef(new THREE.Vector3());
  const intersectVec = useRef(new THREE.Vector3());

  const baseMat = useMemo(() => getMaterial(node.type, false), [node.type]);
  const selMat = useMemo(() => getMaterial(node.type, true), [node.type]);

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
      // Only handle left-click drag
      if (e.button !== 0) return;
      isDragging.current = true;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

      // Calculate offset from mesh centre to click point
      const meshPos = new THREE.Vector3(pos.x, pos.y, pos.z);
      dragOffset.current.copy(meshPos).sub(e.point);
      onDragStart?.(node.id);
    },
    [pos, node.id, onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isDragging.current) return;
      e.stopPropagation();
      // Ray → plane intersection for XZ drag (Y is fixed)
      const ray = e.ray;
      if (ray.intersectPlane(dragPlane.current, intersectVec.current)) {
        const newPos = {
          x: intersectVec.current.x + dragOffset.current.x,
          y: pos.y, // keep vertical fixed during XZ drag
          z: intersectVec.current.z + dragOffset.current.z,
        };
        setLocalPos(newPos);
      }
    },
    [pos.y],
  );

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      e.stopPropagation();
      if (localPos) {
        // commit to store ONLY on drag-stop (exact mirror of moveNode pattern)
        moveNode3D(node.id, localPos);
        setLocalPos(null);
      }
      onDragEnd?.(node.id);
    },
    [localPos, moveNode3D, node.id, onDragEnd],
  );

  const displayPos = localPos ?? pos;

  return (
    <group position={[displayPos.x, displayPos.y, displayPos.z]} rotation={[rot.x, rot.y, rot.z]}>
      {/* Main body box */}
      <mesh
        castShadow
        receiveShadow
        material={isSelected ? selMat : baseMat}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <boxGeometry args={[dims.w, dims.h, dims.d]} />
      </mesh>

      {/* Selection halo — slightly larger transparent box */}
      {isSelected && (
        <mesh>
          <boxGeometry args={[dims.w + 0.006, dims.h + 0.006, dims.d + 0.006]} />
          <meshBasicMaterial
            color={paletteFor(node.type).stroke}
            transparent
            opacity={0.18}
            side={THREE.BackSide}
          />
        </mesh>
      )}
    </group>
  );
}
