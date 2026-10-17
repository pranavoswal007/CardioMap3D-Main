import * as THREE from 'three';

export const DEFAULT_MODEL_SIZE = 2.4;
export const MAX_CONFIGURED_TUBE_RADIUS = 0.04;
export const UNTRACED_MAX_RADIUS_FRACTION = 0.006; // 0.6% of model size

/**
 * Computes effective vessel tube radius.
 * When traced is false, clamps radius to at most 0.6% of model size.
 * When traced is true, clamps radius to configured maximum (0.04).
 */
export function getEffectiveTubeRadius(
  configRadius: number,
  isTraced: boolean,
  modelSize: number = DEFAULT_MODEL_SIZE
): number {
  const maxUntraced = modelSize * UNTRACED_MAX_RADIUS_FRACTION;
  if (!isTraced) {
    return Math.min(configRadius, maxUntraced);
  }
  return Math.min(configRadius, MAX_CONFIGURED_TUBE_RADIUS);
}

/**
 * Builds a smooth tapered tube geometry along a 3D CatmullRom spline curve.
 * Tapers smoothly from ostium (proximal origin) to distal termination.
 */
export function createTaperedTubeGeometry(
  curve: THREE.Curve<THREE.Vector3>,
  tubularSegments = 64,
  startRadius = 0.055,
  endRadius = 0.025,
  radialSegments = 12
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    const p = curve.getPointAt(u);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r = THREE.MathUtils.lerp(startRadius, endRadius, u);

    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments;
      const theta = v * Math.PI * 2;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);

      const normal = new THREE.Vector3()
        .addScaledVector(N, cos)
        .addScaledVector(B, sin)
        .normalize();

      const vertex = new THREE.Vector3().copy(p).addScaledVector(normal, r);

      vertices.push(vertex.x, vertex.y, vertex.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(u, v);
    }
  }

  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = (i + 1) * (radialSegments + 1) + j;
      const c = (i + 1) * (radialSegments + 1) + (j + 1);
      const d = i * (radialSegments + 1) + (j + 1);

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}
