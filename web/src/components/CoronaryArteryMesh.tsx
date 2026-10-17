import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { VesselConfig, VesselData } from '../types/viewer';
import { coronaryConfig } from '../anatomy';
import { evaluateVesselColor } from '../utils/vesselColors';
import { createTaperedTubeGeometry, getEffectiveTubeRadius } from '../utils/taperedTube';

export interface CoronaryArteryMeshProps {
  config: VesselConfig;
  data: VesselData;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
  overridePoints?: [number, number, number][];
}

export function CoronaryArteryMesh({
  config,
  data,
  selected,
  hovered,
  onSelect,
  onHover,
  overridePoints,
}: CoronaryArteryMeshProps) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const glowMaterialRef = useRef<THREE.MeshBasicMaterial>(null);

  const activePoints = overridePoints && overridePoints.length >= 2 ? overridePoints : config.points;

  // Compute CatmullRom spline from control points
  const curve = useMemo(() => {
    const vectors = activePoints.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    return new THREE.CatmullRomCurve3(vectors, false, 'catmullrom', 0.5);
  }, [activePoints]);

  const isTraced = Boolean(coronaryConfig.traced);
  const effectiveRadius = getEffectiveTubeRadius(config.radius, isTraced);

  // Main anatomical tube geometry with proximal-to-distal taper
  const tubeGeometry = useMemo(() => {
    const startRadius = effectiveRadius * 1.15;
    const endRadius = effectiveRadius * 0.65;
    return createTaperedTubeGeometry(curve, 64, startRadius, endRadius, 14);
  }, [curve, effectiveRadius]);

  // Selection & hover halo geometry
  const glowGeometry = useMemo(() => {
    const startRadius = effectiveRadius * 1.55;
    const endRadius = effectiveRadius * 0.95;
    return createTaperedTubeGeometry(curve, 48, startRadius, endRadius, 12);
  }, [curve, effectiveRadius]);

  // Target color evaluation from clinical risk thresholds
  const evaluation = useMemo(() => evaluateVesselColor(data), [data]);
  const targetColor = useMemo(() => new THREE.Color(evaluation.hex), [evaluation.hex]);

  // Smooth per-frame color and emissive glow transitions
  useFrame((_, delta) => {
    if (materialRef.current) {
      materialRef.current.color.lerp(targetColor, Math.min(1, delta * 6));

      // Emissive highlights
      const emissiveIntensity = selected ? 0.75 : hovered ? 0.45 : 0.22;
      materialRef.current.emissive.lerp(targetColor, Math.min(1, delta * 6));
      materialRef.current.emissiveIntensity = THREE.MathUtils.lerp(
        materialRef.current.emissiveIntensity,
        emissiveIntensity,
        Math.min(1, delta * 8)
      );
    }

    if (glowMaterialRef.current && (selected || hovered)) {
      glowMaterialRef.current.color.lerp(targetColor, Math.min(1, delta * 6));
    }
  });

  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
        onHover(true);
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto';
        onHover(false);
      }}
    >
      {/* Outer Glow Halo for Selected or Hovered state */}
      {(selected || hovered) && (
        <mesh geometry={glowGeometry}>
          <meshBasicMaterial
            ref={glowMaterialRef}
            color={evaluation.hex}
            transparent
            opacity={selected ? 0.35 : 0.2}
            side={THREE.BackSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Main Epicardial Coronary Tube */}
      <mesh geometry={tubeGeometry}>
        <meshStandardMaterial
          ref={materialRef}
          color={evaluation.hex}
          roughness={0.3}
          metalness={0.2}
          emissive={evaluation.hex}
          emissiveIntensity={selected ? 0.75 : 0.22}
          polygonOffset
          polygonOffsetFactor={-1.5}
          polygonOffsetUnits={-1.5}
        />
      </mesh>
    </group>
  );
}
