import * as THREE from 'three';
import { buildSurfaceGraph, findShortestPath, type SurfaceGraph, type PathResult } from './surfaceGraph';

export interface GraphBuildStats {
  vertexCount: number;
  edgeCount: number;
  buildTimeMs: number;
}

let cachedGraph: SurfaceGraph | null = null;
let cachedMeshUuid: string | null = null;
let cachedStats: GraphBuildStats | null = null;

/**
 * Builds or retrieves the cached CSR surface graph for a mesh.
 * Tracks and reports build time in milliseconds.
 */
export function getOrCreateSurfaceGraph(mesh: THREE.Mesh): {
  graph: SurfaceGraph;
  stats: GraphBuildStats;
} {
  if (cachedGraph && cachedMeshUuid === mesh.uuid && cachedStats) {
    return { graph: cachedGraph, stats: cachedStats };
  }

  const t0 = performance.now();
  const geom = mesh.geometry;
  const posAttr = geom.attributes.position;
  const normAttr = geom.attributes.normal;
  const index = geom.index;

  const positions = posAttr ? (posAttr.array as Float32Array) : new Float32Array(0);
  const normals = normAttr ? (normAttr.array as Float32Array) : undefined;

  let indices: ArrayLike<number>;
  if (index) {
    indices = index.array;
  } else {
    // Non-indexed: 0, 1, 2, ...
    const count = posAttr.count;
    const gen = new Uint32Array(count);
    for (let i = 0; i < count; i++) gen[i] = i;
    indices = gen;
  }

  const graph = buildSurfaceGraph(positions, indices, normals);
  const t1 = performance.now();
  const buildTimeMs = Number((t1 - t0).toFixed(2));

  const stats: GraphBuildStats = {
    vertexCount: graph.vertexCount,
    edgeCount: graph.colIndices.length / 2,
    buildTimeMs,
  };

  cachedGraph = graph;
  cachedMeshUuid = mesh.uuid;
  cachedStats = stats;

  return { graph, stats };
}

/**
 * Searches the shortest magnetic path between waypoints.
 * Measures timing and returns path result.
 */
export function computeMagneticPath(
  graph: SurfaceGraph,
  startIndex: number,
  endIndex: number,
  colorDistances: Float32Array | null,
  k: number = 12
): { result: PathResult; searchTimeMs: number } {
  const t0 = performance.now();
  const result = findShortestPath(graph, startIndex, endIndex, colorDistances, k);
  const t1 = performance.now();
  return { result, searchTimeMs: Number((t1 - t0).toFixed(2)) };
}
