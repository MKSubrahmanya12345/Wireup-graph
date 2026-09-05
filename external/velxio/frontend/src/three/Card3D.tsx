/**
 * Card3D — a component/board as a flat "card" on the 3D bench.
 *
 * A thin slab gives the part a physical edge when the bench is tilted, and the
 * top face is textured with the part's real SVG art (from useSvgTexture).
 * When no art resolves (inline-only parts), a labeled fallback face is drawn.
 *
 * World space maps 1:1 to the 2D canvas: (x, z) are the canvas (x, y) pixels
 * and +Y is up. Cards are rotated about Y to honour the part's 2D rotation.
 */
import React, { useMemo } from 'react';
import { DoubleSide } from 'three';
import { Text } from '@react-three/drei';
import { useSvgTexture } from './useSvgTexture';

interface Card3DProps {
  /** Canvas-space top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Slab height (world units). */
  lift: number;
  artUrl: string | null;
  label?: string;
  slabColor?: string;
  faceColor?: string;
  /** Component rotation in degrees (0/90/180/270). */
  rotationDeg?: number;
}

const DEFAULT_SLAB = '#2c313a';
const DEFAULT_FACE = '#1d2430';

export function Card3D({
  x,
  y,
  w,
  h,
  lift,
  artUrl,
  label,
  slabColor = DEFAULT_SLAB,
  faceColor = DEFAULT_FACE,
  rotationDeg = 0,
}: Card3DProps) {
  const texture = useSvgTexture(artUrl);
  const rotationY = useMemo(() => -(rotationDeg * Math.PI) / 180, [rotationDeg]);

  return (
    <group position={[x + w / 2, 0, y + h / 2]} rotation={[0, rotationY, 0]}>
      {/* Physical slab edge */}
      <mesh position={[0, lift / 2, 0]}>
        <boxGeometry args={[w, lift, h]} />
        <meshStandardMaterial color={slabColor} roughness={0.85} metalness={0.05} />
      </mesh>

      {/* Art face, flat on top of the slab */}
      <mesh position={[0, lift + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, h]} />
        {texture ? (
          <meshBasicMaterial map={texture} transparent side={DoubleSide} toneMapped={false} />
        ) : (
          <meshStandardMaterial color={faceColor} roughness={0.6} metalness={0.1} />
        )}
      </mesh>

      {!texture && label ? (
        <Text
          position={[0, lift + 0.1, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={Math.min(w, h) / 6}
          color="#9aa7b8"
          anchorX="center"
          anchorY="middle"
          maxWidth={w * 0.9}
        >
          {label}
        </Text>
      ) : null}
    </group>
  );
}
