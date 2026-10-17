import { useMemo } from 'react';
import * as THREE from 'three';

export interface ArteryMaskOverlayProps {
  mesh: THREE.Mesh | null;
  mask: Uint8Array | null;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

/**
 * Non-destructive overlay that displays masked artery vertices in bright green (#22c55e).
 * Never mutates the loaded 3D asset or its original geometry attributes.
 */
export function ArteryMaskOverlay({
  mesh,
  mask,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
}: ArteryMaskOverlayProps) {
  const geometry = useMemo(() => {
    if (!mesh || !mask) return null;
    const posAttr = mesh.geometry.attributes.position;
    if (!posAttr) return null;

    const selected: number[] = [];
    const count = Math.min(mask.length, posAttr.count);
    for (let i = 0; i < count; i++) {
      if (mask[i] === 1) {
        selected.push(i);
      }
    }

    if (selected.length === 0) return null;

    const positions = new Float32Array(selected.length * 3);
    for (let i = 0; i < selected.length; i++) {
      const idx = selected[i];
      positions[i * 3] = posAttr.getX(idx);
      positions[i * 3 + 1] = posAttr.getY(idx);
      positions[i * 3 + 2] = posAttr.getZ(idx);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geom;
  }, [mesh, mask]);

  if (!geometry) return null;

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <points geometry={geometry}>
        <pointsMaterial
          color="#22c55e"
          size={0.016}
          sizeAttenuation
          transparent
          opacity={0.9}
        />
      </points>
    </group>
  );
}
