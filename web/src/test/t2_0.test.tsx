import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import fs from 'fs';
import path from 'path';

import {
  buildSurfaceGraph,
  findShortestPath,
  snapPointToNearestVertex,
} from '../debug/surfaceGraph';
import {
  rgbToLab,
  colorDistanceLab,
  computeMaskFromDistances,
} from '../debug/colorDistance';
import {
  resamplePath,
  buildExportConfig,
  verifyPointsOnSurface,
} from '../debug/pathSimplifier';
import { evaluateVesselColor } from '../utils/vesselColors';

describe('T2-0: Artery Trace Assistant Test Suite', () => {
  // 1. Adjacency on a small synthetic mesh
  it('builds CSR vertex adjacency correctly on a small synthetic mesh', () => {
    // 2-triangle quad:
    // v0: (0, 0, 0), v1: (1, 0, 0), v2: (0, 1, 0), v3: (1, 1, 0)
    // Triangle 1: 0, 1, 2
    // Triangle 2: 1, 3, 2
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 1, 0,
    ]);
    const indices = new Uint32Array([0, 1, 2, 1, 3, 2]);

    const graph = buildSurfaceGraph(positions, indices);

    expect(graph.vertexCount).toBe(4);
    // CSR rowOffsets has length vertexCount + 1 = 5
    expect(graph.rowOffsets.length).toBe(5);

    // v0 neighbors: 1, 2
    const v0Neighbors = graph.colIndices.slice(graph.rowOffsets[0], graph.rowOffsets[1]);
    expect(Array.from(v0Neighbors).sort()).toEqual([1, 2]);

    // v1 neighbors: 0, 2, 3
    const v1Neighbors = graph.colIndices.slice(graph.rowOffsets[1], graph.rowOffsets[2]);
    expect(Array.from(v1Neighbors).sort()).toEqual([0, 2, 3]);

    // v2 neighbors: 0, 1, 3
    const v2Neighbors = graph.colIndices.slice(graph.rowOffsets[2], graph.rowOffsets[3]);
    expect(Array.from(v2Neighbors).sort()).toEqual([0, 1, 3]);

    // v3 neighbors: 1, 2
    const v3Neighbors = graph.colIndices.slice(graph.rowOffsets[3], graph.rowOffsets[4]);
    expect(Array.from(v3Neighbors).sort()).toEqual([1, 2]);

    // Check snapping: point (0.9, 0.05, 0) snaps to v1
    const nearest = snapPointToNearestVertex(graph, [0.9, 0.05, 0]);
    expect(nearest).toBe(1);
  });

  // 2. Dijkstra prefers colored vertices when k > 0 and equals geodesic when k = 0
  it('Dijkstra prefers colored vertices when k > 0 and equals geodesic when k = 0', () => {
    // Diamond mesh with NO direct (0, 3) edge:
    // v0: Start (0, 0, 0)
    // v1: Top path vertex (1, 0.2, 0)     -> top path 0-1-3 distance: 2 * sqrt(1 + 0.04) ≈ 2.0396
    // v2: Bottom path vertex (1, -0.1, 0) -> bottom path 0-2-3 distance: 2 * sqrt(1 + 0.01) ≈ 2.0100 (shorter!)
    // v3: End (2, 0, 0)
    const positions = new Float32Array([
      0, 0, 0,       // v0
      1, 0.2, 0,     // v1 (Top)
      1, -0.1, 0,    // v2 (Bottom - shorter geodesic)
      2, 0, 0,       // v3
    ]);
    // Triangles (0, 1, 2) and (1, 3, 2).
    // Edges are: (0, 1), (0, 2), (1, 2), (1, 3), (2, 3).
    // Vertex 0 connects only to 1 and 2. Vertex 3 connects only to 1 and 2.
    const indices = new Uint32Array([
      0, 1, 2,
      1, 3, 2,
    ]);

    const graph = buildSurfaceGraph(positions, indices);

    // Color distances normalized [0, 1]:
    // v1 (top) has low distance = 0.0 (matches artery color perfectly)
    // v2 (bottom) has high distance = 1.0 (far from artery color)
    const colorDistances = new Float32Array([0.0, 0.0, 1.0, 0.0]);

    // Case A: k = 0 (pure geodesic shortest path)
    // Geodesic path: 0 -> 2 -> 3 (length 2.010 < 2.0396)
    const geodesicResult = findShortestPath(graph, 0, 3, colorDistances, 0);
    expect(geodesicResult.path).toEqual([0, 2, 3]);
    expect(geodesicResult.warning).toBeUndefined();

    // Case B: k = 12 (magnetic path tracing)
    // Top cost: 2.0396 * (1 + 12 * 0) = 2.0396
    // Bottom cost: 2.0100 * (1 + 12 * 1) = 26.13
    // Magnetic path should strictly prefer v1!
    const magneticResult = findShortestPath(graph, 0, 3, colorDistances, 12);
    expect(magneticResult.path).toEqual([0, 1, 3]);
    expect(magneticResult.warning).toBeUndefined();
  });

  // 3. Disconnected fallback
  it('falls back to straight surface interpolation with warning when vertices are disconnected', () => {
    // Two disconnected triangles:
    // Triangle A: v0, v1, v2
    // Triangle B: v3, v4, v5
    const positions = new Float32Array([
      0, 0, 0,  1, 0, 0,  0, 1, 0,
      10, 0, 0, 11, 0, 0, 10, 1, 0,
    ]);
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
    const graph = buildSurfaceGraph(positions, indices);

    const result = findShortestPath(graph, 0, 3, null, 12);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('Disconnected');
    // Returns fallback straight segment between v0 and v3
    expect(result.path).toEqual([0, 3]);
  });

  // 4. Simplification returns N points and preserves endpoints
  it('resamples path to exactly N control points while preserving endpoints', () => {
    const inputPoints: [number, number, number][] = [
      [0, 0, 0],
      [1, 0.5, 0.2],
      [2, 0.8, 0.5],
      [3, 0.5, 0.8],
      [4, 0, 1],
    ];

    const N = 18;
    const resampled = resamplePath(inputPoints, N, { normalOffset: 0 });

    expect(resampled.length).toBe(N);
    // Preserves start
    expect(resampled[0][0]).toBeCloseTo(0, 2);
    expect(resampled[0][1]).toBeCloseTo(0, 2);
    expect(resampled[0][2]).toBeCloseTo(0, 2);

    // Preserves end
    expect(resampled[N - 1][0]).toBeCloseTo(4, 2);
    expect(resampled[N - 1][1]).toBeCloseTo(0, 2);
    expect(resampled[N - 1][2]).toBeCloseTo(1, 2);
  });

  // 5. JSON format and round trip
  it('builds export config matching coronary.json format and validates surface round trip', () => {
    const baseConfig = {
      version: '1.0.0',
      traced: false,
      comment: 'Config-driven anatomical coronary artery spline geometries',
      vessels: [
        { id: 'lad', displayName: 'Left Anterior Descending', shortName: 'LAD', radius: 0.055, points: [[0, 0, 0]] },
        { id: 'lcx', displayName: 'Left Circumflex', shortName: 'LCX', radius: 0.05, points: [[0, 0, 0]] },
        { id: 'rca', displayName: 'Right Coronary Artery', shortName: 'RCA', radius: 0.052, points: [[0, 0, 0]] },
      ],
    };

    // When not all 3 vessels have >= 2 points, traced remains false
    const partialPoints: Record<string, [number, number, number][]> = {
      lad: [[0, 0, 0], [1, 1, 1]],
      lcx: [[0, 0, 0]],
      rca: [],
    };
    const partialExport = buildExportConfig(partialPoints as any, baseConfig as any);
    expect(partialExport.isAllTraced).toBe(false);
    expect(partialExport.config.traced).toBe(false);

    // When all 3 vessels have >= 2 points, traced becomes true
    const completePoints: Record<string, [number, number, number][]> = {
      lad: [[0, 0, 0], [1, 1, 1], [2, 2, 2]],
      lcx: [[3, 3, 3], [4, 4, 4]],
      rca: [[5, 5, 5], [6, 6, 6]],
    };
    const completeExport = buildExportConfig(completePoints as any, baseConfig as any);
    expect(completeExport.isAllTraced).toBe(true);
    expect(completeExport.config.traced).toBe(true);
    expect(completeExport.config.vessels.find((v) => v.id === 'lad')?.points.length).toBe(3);

    // Round trip surface tolerance check on a synthetic mesh
    // Create a flat mesh in xy plane at z = 0
    const geom = new THREE.PlaneGeometry(10, 10, 10, 10);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());

    // Sample points at z = 0.02 (normal offset 0.02 along +z)
    const testPoints: [number, number, number][] = [
      [0, 0, 0.02],
      [1, 1, 0.02],
      [2, 0, 0.02],
    ];

    const roundTrip = verifyPointsOnSurface(mesh, testPoints, 0.02, 0.005);
    expect(roundTrip.valid).toBe(true);
    expect(roundTrip.maxError).toBeLessThan(0.005);
  });

  // 6. Mask thresholding and color distance
  it('correctly calculates CIELAB distance and computes vertex mask from threshold', () => {
    // Red color
    const labRed = rgbToLab({ r: 1, g: 0, b: 0 });
    // Same red color has distance 0
    expect(colorDistanceLab(labRed, labRed)).toBeCloseTo(0, 3);

    // Blue color
    const labBlue = rgbToLab({ r: 0, g: 0, b: 1 });
    const distRedBlue = colorDistanceLab(labRed, labBlue);
    expect(distRedBlue).toBeGreaterThan(50); // High CIELAB deltaE

    // Mask thresholding: 5 vertices
    const distances = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const { mask, count, percentage } = computeMaskFromDistances(distances, 0.25);

    expect(count).toBe(2);
    expect(percentage).toBe(40.0);
    expect(mask[0]).toBe(1);
    expect(mask[1]).toBe(1);
    expect(mask[2]).toBe(0);
    expect(mask[3]).toBe(0);
    expect(mask[4]).toBe(0);
  });

  // 7. Color rule cases unchanged (below t, at t, t+0.15, t+0.35, null)
  it('ensures vesselColors evaluation cases remain strictly unchanged', () => {
    // null
    const resNull = evaluateVesselColor(null);
    expect(resNull.status).toBe('no_data');
    expect(resNull.hex).toBe('#64748b');

    // zero probability (p = 0.0, threshold = 0.5)
    const resZero = evaluateVesselColor({ probability: 0.0, threshold: 0.5 });
    expect(resZero.status).toBe('below_cutoff');
    expect(resZero.hex).toBe('#10b981');
    expect(resZero.label).toBe('Below screening cutoff');

    // below t (e.g. p = 0.30, threshold = 0.50)
    const resBelow = evaluateVesselColor({ probability: 0.3, threshold: 0.5 });
    expect(resBelow.status).toBe('below_cutoff');
    expect(resBelow.label).toBe('Below screening cutoff');

    // at t (e.g. p = 0.50, threshold = 0.50)
    const resAt = evaluateVesselColor({ probability: 0.5, threshold: 0.5 });
    expect(resAt.status).toBe('above_cutoff');
    expect(resAt.hex).toBe('#eab308');
    expect(resAt.label).toBe('Above screening cutoff');

    // t + 0.15 (e.g. p = 0.65, threshold = 0.50)
    const resHigh = evaluateVesselColor({ probability: 0.65, threshold: 0.5 });
    expect(resHigh.status).toBe('elevated');
    expect(resHigh.hex).toBe('#f97316');
    expect(resHigh.label).toBe('Above screening cutoff (elevated)');

    // t + 0.35 (e.g. p = 0.85, threshold = 0.50)
    const resVeryHigh = evaluateVesselColor({ probability: 0.85, threshold: 0.5 });
    expect(resVeryHigh.status).toBe('elevated');
    expect(resVeryHigh.hex).toBe('#ef4444');
    expect(resVeryHigh.label).toBe('Above screening cutoff (elevated)');
  });

  // 8. Banned clinical phrases audit
  it('ensures banned clinical phrases are absent from web/src', () => {
    const srcDir = path.resolve(__dirname, '..');
    const forbidden1 = ['moderate', 'risk'].join(' ');
    const forbidden2 = ['well', 'above'].join(' ');

    function scanDir(dir: string): string[] {
      let results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__fixtures__' && entry.name !== 'node_modules') {
            results = results.concat(scanDir(fullPath));
          }
        } else if (/\.(tsx?|css|html|json)$/.test(entry.name) && entry.name !== 'phase4.test.tsx' && entry.name !== 'phase3_5.test.tsx') {
          const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
          if (content.includes(forbidden1) || content.includes(forbidden2)) {
            results.push(fullPath);
          }
        }
      }
      return results;
    }

    const matches = scanDir(srcDir);
    expect(matches).toEqual([]);
  });

  // 9. Debug code absent from the main chunk
  it('verifies debug trace code is isolated and absent from main entry bundle', () => {
    const distAssetsDir = path.resolve(__dirname, '../../dist/assets');
    if (!fs.existsSync(distAssetsDir)) {
      // Build directory not created yet in dev test run
      return;
    }

    const files = fs.readdirSync(distAssetsDir);
    const mainChunk = files.find((f) => /^index-[a-zA-Z0-9_-]+\.js$/.test(f));
    expect(mainChunk).toBeDefined();

    if (mainChunk) {
      const content = fs.readFileSync(path.join(distAssetsDir, mainChunk), 'utf8');
      // Main chunk should not contain the magnetic trace assistant unique UI strings
      expect(content).not.toContain('Artery Trace Assistant');
      expect(content).not.toContain('Pick artery color');
    }
  });
});
