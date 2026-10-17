import * as THREE from 'three';
import type { CoronaryDataConfig, VesselId } from '../types/viewer';

export interface ResampleOptions {
  targetCount: number;
  normalOffset?: number;
  normals?: [number, number, number][];
}

/**
 * Resamples a sequence of 3D points along its arc-length to produce
 * exactly targetCount control points while preserving endpoints.
 */
export function resamplePath(
  points: [number, number, number][],
  targetCount: number,
  options: {
    normalOffset?: number;
    normals?: [number, number, number][];
  } = {}
): [number, number, number][] {
  if (points.length === 0) return [];
  if (points.length === 1 || targetCount <= 1) {
    return Array.from({ length: Math.max(1, targetCount) }, () => [...points[0]]);
  }

  const { normalOffset = 0, normals } = options;

  // 1. Calculate cumulative arc length along input polyline
  const cumulativeLengths: number[] = [0];
  let totalLength = 0;

  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const dz = p2[2] - p1[2];
    const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    totalLength += segLen;
    cumulativeLengths.push(totalLength);
  }

  if (totalLength === 0) {
    return Array.from({ length: targetCount }, () => [...points[0]]);
  }

  // 2. Uniform arc-length sampling
  const step = totalLength / (targetCount - 1);
  const result: [number, number, number][] = [];
  let currentSegment = 0;

  for (let i = 0; i < targetCount; i++) {
    if (i === 0) {
      const p = points[0];
      const n = normals && normals[0] ? normals[0] : [0, 0, 0];
      result.push([
        Number((p[0] + n[0] * normalOffset).toFixed(3)),
        Number((p[1] + n[1] * normalOffset).toFixed(3)),
        Number((p[2] + n[2] * normalOffset).toFixed(3)),
      ]);
      continue;
    }

    if (i === targetCount - 1) {
      const p = points[points.length - 1];
      const n = normals && normals[normals.length - 1] ? normals[normals.length - 1] : [0, 0, 0];
      result.push([
        Number((p[0] + n[0] * normalOffset).toFixed(3)),
        Number((p[1] + n[1] * normalOffset).toFixed(3)),
        Number((p[2] + n[2] * normalOffset).toFixed(3)),
      ]);
      continue;
    }

    const targetDist = i * step;

    while (
      currentSegment < cumulativeLengths.length - 2 &&
      cumulativeLengths[currentSegment + 1] < targetDist
    ) {
      currentSegment++;
    }

    const segStartDist = cumulativeLengths[currentSegment];
    const segEndDist = cumulativeLengths[currentSegment + 1];
    const segLen = segEndDist - segStartDist;
    const t = segLen > 0 ? (targetDist - segStartDist) / segLen : 0;

    const pA = points[currentSegment];
    const pB = points[currentSegment + 1];

    const x = pA[0] + (pB[0] - pA[0]) * t;
    const y = pA[1] + (pB[1] - pA[1]) * t;
    const z = pA[2] + (pB[2] - pA[2]) * t;

    // Interpolate normal if available
    let nx = 0,
      ny = 0,
      nz = 0;
    if (normals && normals[currentSegment] && normals[currentSegment + 1]) {
      const nA = normals[currentSegment];
      const nB = normals[currentSegment + 1];
      nx = nA[0] + (nB[0] - nA[0]) * t;
      ny = nA[1] + (nB[1] - nA[1]) * t;
      nz = nA[2] + (nB[2] - nA[2]) * t;
      const nLen = Math.hypot(nx, ny, nz);
      if (nLen > 0) {
        nx /= nLen;
        ny /= nLen;
        nz /= nLen;
      }
    }

    result.push([
      Number((x + nx * normalOffset).toFixed(3)),
      Number((y + ny * normalOffset).toFixed(3)),
      Number((z + nz * normalOffset).toFixed(3)),
    ]);
  }

  return result;
}

/**
 * Builds standard coronary.json export object.
 * Sets traced: true ONLY when all 3 vessels (LAD, LCX, RCA) have valid paths.
 */
export function buildExportConfig(
  vesselPoints: Record<VesselId, [number, number, number][]>,
  baseConfig?: any
): { config: CoronaryDataConfig; isAllTraced: boolean } {
  const hasLAD = (vesselPoints.lad?.length ?? 0) >= 2;
  const hasLCX = (vesselPoints.lcx?.length ?? 0) >= 2;
  const hasRCA = (vesselPoints.rca?.length ?? 0) >= 2;
  const isAllTraced = hasLAD && hasLCX && hasRCA;

  let vesselList: any[] = [];
  if (baseConfig?.vessels && Array.isArray(baseConfig.vessels)) {
    vesselList = baseConfig.vessels;
  } else if (baseConfig?.vessels && typeof baseConfig.vessels === 'object') {
    vesselList = Object.keys(baseConfig.vessels).map((key) => ({
      id: key as VesselId,
      ...baseConfig.vessels[key],
    }));
  } else {
    vesselList = [
      {
        id: 'lad' as VesselId,
        displayName: 'Left Anterior Descending',
        shortName: 'LAD',
        description: 'Courses along the anterior interventricular sulcus to the apex.',
        radius: 0.055,
        cameraFocus: [0.1, 0.1, 1.8],
        points: [],
      },
      {
        id: 'lcx' as VesselId,
        displayName: 'Left Circumflex Artery',
        shortName: 'LCX',
        description: 'Travels along the left atrioventricular groove toward the lateral and posterior myocardium.',
        radius: 0.05,
        cameraFocus: [-1.2, 0.1, 0.4],
        points: [],
      },
      {
        id: 'rca' as VesselId,
        displayName: 'Right Coronary Artery',
        shortName: 'RCA',
        description: 'Descends within the right atrioventricular sulcus around the acute cardiac margin to the posterior crux.',
        radius: 0.052,
        cameraFocus: [1.2, 0.1, 0.4],
        points: [],
      },
    ];
  }

  const config: CoronaryDataConfig = {
    version: baseConfig?.version || '1.0.0',
    traced: isAllTraced,
    comment:
      baseConfig?.comment ||
      'Config-driven anatomical coronary artery spline geometries for 3D visualization. Territory descriptions follow standard clinical cardiac anatomy without reference to clinical dataset indices.',
    vessels: vesselList.map((v) => ({
      ...v,
      points: vesselPoints[v.id as VesselId] || v.points || [],
    })),
  };

  return { config, isAllTraced };
}

/**
 * Round-trip surface verification test:
 * Checks whether exported points lie on the mesh surface within tolerance plus the normal offset.
 */
export function verifyPointsOnSurface(
  meshOrPositions: THREE.Mesh | Float32Array,
  points: [number, number, number][],
  normalOffset: number,
  tolerance: number = 0.05
): { valid: boolean; maxError: number; errors: number[] } {
  let meshPositions: Float32Array;
  if (meshOrPositions instanceof Float32Array) {
    meshPositions = meshOrPositions;
  } else if ('geometry' in meshOrPositions && meshOrPositions.geometry) {
    meshPositions = meshOrPositions.geometry.attributes.position.array as Float32Array;
  } else {
    throw new Error('Invalid mesh or positions buffer provided to verifyPointsOnSurface');
  }

  const V = meshPositions.length / 3;
  let maxError = 0;
  const errors: number[] = [];

  for (const pt of points) {
    let minDist = Infinity;
    for (let i = 0; i < V; i++) {
      const vx = meshPositions[i * 3];
      const vy = meshPositions[i * 3 + 1];
      const vz = meshPositions[i * 3 + 2];
      const dist = Math.hypot(pt[0] - vx, pt[1] - vy, pt[2] - vz);
      if (dist < minDist) {
        minDist = dist;
      }
    }
    // Expected distance from mesh vertex is approximately normalOffset
    const err = Math.abs(minDist - normalOffset);
    errors.push(err);
    if (err > maxError) {
      maxError = err;
    }
  }

  return {
    valid: maxError <= tolerance,
    maxError,
    errors,
  };
}
