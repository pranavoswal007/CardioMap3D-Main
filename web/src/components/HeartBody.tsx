import React, { useRef, useState, useEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import { MeshoptDecoder } from 'three-stdlib';
import * as THREE from 'three';
import type { HeartTransformConfig } from '../types/viewer';
import { defaultHeartTransform } from '../anatomy';

export interface HeartBodyProps {
  xRay?: boolean;
  transform?: HeartTransformConfig;
  onMeshPointerDown?: (point: THREE.Vector3, normal?: THREE.Vector3) => void;
  meshRef?: React.RefObject<THREE.Mesh | null>;
  onMeshReady?: (mesh: THREE.Mesh) => void;
}

/**
 * Procedural cardiac placeholder mesh rendered when /models/heart.glb is not present.
 * Low-poly cardiac geometry with ventricular chambers and great vessel trunks.
 */
function ProceduralHeart({ xRay = false }: { xRay?: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const opacity = xRay ? 0.35 : 1.0;
  const depthWrite = !xRay;

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* Ventricular Core (tapered ellipsoid tilted towards apex) */}
      <mesh position={[-0.04, -0.05, 0.02]} rotation={[0.08, 0, -0.15]}>
        <sphereGeometry args={[1.02, 32, 32]} />
        <meshStandardMaterial
          color="#661125"
          roughness={0.5}
          metalness={0.1}
          transparent={xRay}
          opacity={opacity}
          depthWrite={depthWrite}
        />
      </mesh>

      {/* Right Ventricle / Anterior Mass */}
      <mesh position={[0.22, 0.05, 0.15]} rotation={[-0.05, 0.1, 0.2]}>
        <sphereGeometry args={[0.78, 24, 24]} />
        <meshStandardMaterial
          color="#520e1e"
          roughness={0.55}
          metalness={0.08}
          transparent={xRay}
          opacity={opacity * 0.9}
          depthWrite={depthWrite}
        />
      </mesh>

      {/* Left Atrial & Ventricular Posterior Bulge */}
      <mesh position={[-0.26, 0.2, -0.18]} rotation={[0.1, -0.2, 0]}>
        <sphereGeometry args={[0.72, 24, 24]} />
        <meshStandardMaterial
          color="#5a1022"
          roughness={0.6}
          metalness={0.08}
          transparent={xRay}
          opacity={opacity * 0.85}
          depthWrite={depthWrite}
        />
      </mesh>

      {/* Aortic Root (Base) */}
      <mesh position={[0.06, 0.96, 0.22]} rotation={[0.15, 0, -0.08]}>
        <cylinderGeometry args={[0.26, 0.32, 0.55, 20]} />
        <meshStandardMaterial
          color="#7c1d32"
          roughness={0.4}
          metalness={0.15}
          transparent={xRay}
          opacity={opacity * 0.92}
          depthWrite={depthWrite}
        />
      </mesh>

      {/* Pulmonary Trunk Base */}
      <mesh position={[-0.14, 0.88, 0.32]} rotation={[0.3, 0.2, -0.25]}>
        <cylinderGeometry args={[0.22, 0.26, 0.45, 18]} />
        <meshStandardMaterial
          color="#431422"
          roughness={0.45}
          metalness={0.12}
          transparent={xRay}
          opacity={opacity * 0.85}
          depthWrite={depthWrite}
        />
      </mesh>
    </group>
  );
}

/**
 * Real Anatomical Heart Model Loader.
 * Loads meshopt-compressed heart.glb, normalizes orientation, verifies COLOR_0,
 * and configures MeshStandardMaterial preserving painted vertex colors.
 */
function GLTFHeart({
  url,
  xRay = false,
  transform = defaultHeartTransform,
  onMeshPointerDown,
  meshRef,
  onMeshReady,
}: {
  url: string;
  xRay?: boolean;
  transform?: HeartTransformConfig;
  onMeshPointerDown?: (point: THREE.Vector3, normal?: THREE.Vector3) => void;
  meshRef?: React.RefObject<THREE.Mesh | null>;
  onMeshReady?: (mesh: THREE.Mesh) => void;
}) {
  const { scene } = useGLTF(url, false, true, (loader) => {
    const decoder = typeof MeshoptDecoder === 'function' ? MeshoptDecoder() : MeshoptDecoder;
    loader.setMeshoptDecoder(decoder);
  });
  const internalMeshRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        internalMeshRef.current = mesh;
        if (meshRef) {
          (meshRef as React.MutableRefObject<THREE.Mesh | null>).current = mesh;
        }
        if (onMeshReady) {
          onMeshReady(mesh);
        }

        const geom = mesh.geometry;
        const hasColor = Boolean(geom.attributes.color || geom.attributes.COLOR_0);
        if (!hasColor) {
          console.warn('[HeartBody] COLOR_0 vertex color attribute missing on heart mesh. Falling back to neutral tissue color.');
        }

        // Use MeshStandardMaterial with vertexColors: true, roughness ~0.55, metalness 0
        mesh.material = new THREE.MeshStandardMaterial({
          vertexColors: hasColor,
          color: hasColor ? 0xffffff : 0x7c1d32, // neutral tissue color fallback only if COLOR_0 missing
          roughness: 0.55,
          metalness: 0.0,
          transparent: xRay,
          opacity: xRay ? 0.35 : 1.0,
          depthWrite: !xRay,
          side: THREE.DoubleSide,
        });
      }
    });
  }, [scene, xRay, meshRef, onMeshReady]);

  const rotationRad: [number, number, number] = [
    THREE.MathUtils.degToRad(transform.rotation[0]),
    THREE.MathUtils.degToRad(transform.rotation[1]),
    THREE.MathUtils.degToRad(transform.rotation[2]),
  ];

  const scaleVec: [number, number, number] = [
    transform.scale[0] * (transform.flip ? transform.flip[0] : 1),
    transform.scale[1] * (transform.flip ? transform.flip[1] : 1),
    transform.scale[2] * (transform.flip ? transform.flip[2] : 1),
  ];

  return (
    <group
      position={transform.position}
      rotation={rotationRad}
      scale={scaleVec}
    >
      <primitive
        object={scene}
        onPointerDown={(e: { stopPropagation: () => void; point: THREE.Vector3; face?: { normal: THREE.Vector3 } }) => {
          if (onMeshPointerDown) {
            e.stopPropagation();
            onMeshPointerDown(e.point, e.face?.normal);
          }
        }}
      />
    </group>
  );
}

interface ErrorBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class HeartErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

export function HeartBody({
  xRay = false,
  transform = defaultHeartTransform,
  onMeshPointerDown,
  meshRef,
  onMeshReady,
}: HeartBodyProps) {
  const [modelAvailable, setModelAvailable] = useState<boolean>(false);

  useEffect(() => {
    // Check if /models/heart.glb exists on the server without throwing
    fetch('/models/heart.glb', { method: 'HEAD' })
      .then((res) => {
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && !contentType.includes('text/html')) {
          setModelAvailable(true);
        } else {
          setModelAvailable(false);
        }
      })
      .catch(() => {
        setModelAvailable(false);
      });
  }, []);

  if (modelAvailable) {
    return (
      <HeartErrorBoundary fallback={<ProceduralHeart xRay={xRay} />}>
        <GLTFHeart
          url="/models/heart.glb"
          xRay={xRay}
          transform={transform}
          onMeshPointerDown={onMeshPointerDown}
          meshRef={meshRef}
          onMeshReady={onMeshReady}
        />
      </HeartErrorBoundary>
    );
  }

  // Fallback to procedural heart placeholder
  return <ProceduralHeart xRay={xRay} />;
}
