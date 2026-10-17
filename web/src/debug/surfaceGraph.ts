export interface SurfaceGraph {
  vertexCount: number;
  rowOffsets: Uint32Array; // size: V + 1
  colIndices: Uint32Array; // size: 2E
  edgeLengths: Float32Array; // size: 2E
  positions: Float32Array; // size: 3V
  normals: Float32Array; // size: 3V
}

export interface PathResult {
  path: number[];
  found: boolean;
  totalLength: number;
  warning?: string;
}

/**
 * Builds a Compressed Sparse Row (CSR) surface adjacency graph from mesh geometry.
 */
export function buildSurfaceGraph(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  normals?: ArrayLike<number>
): SurfaceGraph {
  const vertexCount = positions.length / 3;
  const posArray = new Float32Array(positions);
  const normArray = normals ? new Float32Array(normals) : new Float32Array(positions.length);

  // Map each vertex to its set of unique neighbors
  const neighborSets: Set<number>[] = Array.from({ length: vertexCount }, () => new Set<number>());

  const indexCount = indices.length;
  for (let i = 0; i < indexCount; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];

    if (a !== b) {
      neighborSets[a].add(b);
      neighborSets[b].add(a);
    }
    if (b !== c) {
      neighborSets[b].add(c);
      neighborSets[c].add(b);
    }
    if (c !== a) {
      neighborSets[c].add(a);
      neighborSets[a].add(c);
    }
  }

  // Count total directed edges
  let totalEdges = 0;
  for (let i = 0; i < vertexCount; i++) {
    totalEdges += neighborSets[i].size;
  }

  const rowOffsets = new Uint32Array(vertexCount + 1);
  const colIndices = new Uint32Array(totalEdges);
  const edgeLengths = new Float32Array(totalEdges);

  let edgeOffset = 0;
  for (let i = 0; i < vertexCount; i++) {
    rowOffsets[i] = edgeOffset;
    const neighbors = neighborSets[i];
    const x1 = posArray[i * 3];
    const y1 = posArray[i * 3 + 1];
    const z1 = posArray[i * 3 + 2];

    for (const neighbor of neighbors) {
      colIndices[edgeOffset] = neighbor;
      const x2 = posArray[neighbor * 3];
      const y2 = posArray[neighbor * 3 + 1];
      const z2 = posArray[neighbor * 3 + 2];
      const dx = x1 - x2;
      const dy = y1 - y2;
      const dz = z1 - z2;
      edgeLengths[edgeOffset] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      edgeOffset++;
    }
  }
  rowOffsets[vertexCount] = edgeOffset;

  return {
    vertexCount,
    rowOffsets,
    colIndices,
    edgeLengths,
    positions: posArray,
    normals: normArray,
  };
}

/**
 * Min-Binary Heap for Dijkstra / A*
 */
class MinBinaryHeap {
  private nodes: { vertex: number; priority: number }[] = [];

  push(vertex: number, priority: number) {
    this.nodes.push({ vertex, priority });
    this.bubbleUp(this.nodes.length - 1);
  }

  pop(): { vertex: number; priority: number } | undefined {
    if (this.nodes.length === 0) return undefined;
    const top = this.nodes[0];
    const bottom = this.nodes.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  get size(): number {
    return this.nodes.length;
  }

  private bubbleUp(n: number) {
    const element = this.nodes[n];
    while (n > 0) {
      const parentN = ((n + 1) >> 1) - 1;
      const parent = this.nodes[parentN];
      if (element.priority >= parent.priority) break;
      this.nodes[parentN] = element;
      this.nodes[n] = parent;
      n = parentN;
    }
  }

  private sinkDown(n: number) {
    const length = this.nodes.length;
    const element = this.nodes[n];
    while (true) {
      const child2N = (n + 1) << 1;
      const child1N = child2N - 1;
      let swap: number | null = null;
      let swapPriority = element.priority;

      if (child1N < length) {
        const child1 = this.nodes[child1N];
        if (child1.priority < swapPriority) {
          swap = child1N;
          swapPriority = child1.priority;
        }
      }

      if (child2N < length) {
        const child2 = this.nodes[child2N];
        if (child2.priority < swapPriority) {
          swap = child2N;
        }
      }

      if (swap === null) break;
      this.nodes[n] = this.nodes[swap];
      this.nodes[swap] = element;
      n = swap;
    }
  }
}

/**
 * Computes shortest path along mesh edges with magnetic color weighting.
 * Edge cost = euclidean length * (1 + k * normalizedColorDistance).
 * If k = 0, edge cost = euclidean length (pure geodesic on mesh edges).
 */
export function findShortestPath(
  graph: SurfaceGraph,
  startIndex: number,
  endIndex: number,
  colorDistances: Float32Array | null,
  k: number = 12
): PathResult {
  if (startIndex === endIndex) {
    return { path: [startIndex], found: true, totalLength: 0 };
  }

  const V = graph.vertexCount;
  if (startIndex < 0 || startIndex >= V || endIndex < 0 || endIndex >= V) {
    return {
      path: [Math.max(0, startIndex), Math.max(0, endIndex)],
      found: false,
      totalLength: 0,
      warning: 'Invalid vertex index for shortest path computation',
    };
  }

  const dist = new Float64Array(V);
  dist.fill(Infinity);
  const prev = new Int32Array(V);
  prev.fill(-1);
  const visited = new Uint8Array(V);

  const heap = new MinBinaryHeap();
  dist[startIndex] = 0;
  heap.push(startIndex, 0);

  let targetFound = false;

  while (heap.size > 0) {
    const current = heap.pop()!;
    const u = current.vertex;

    if (visited[u]) continue;
    visited[u] = 1;

    if (u === endIndex) {
      targetFound = true;
      break;
    }

    const startEdge = graph.rowOffsets[u];
    const endEdge = graph.rowOffsets[u + 1];

    for (let e = startEdge; e < endEdge; e++) {
      const v = graph.colIndices[e];
      if (visited[v]) continue;

      const len = graph.edgeLengths[e];
      const colorDist = colorDistances ? colorDistances[v] : 0;
      const weightMultiplier = 1.0 + Math.max(0, k) * colorDist;
      const cost = len * weightMultiplier;
      const newDist = dist[u] + cost;

      if (newDist < dist[v]) {
        dist[v] = newDist;
        prev[v] = u;
        heap.push(v, newDist);
      }
    }
  }

  if (!targetFound) {
    // Disconnected fallback: straight direct segment between vertices
    return {
      path: [startIndex, endIndex],
      found: false,
      totalLength: Math.hypot(
        graph.positions[startIndex * 3] - graph.positions[endIndex * 3],
        graph.positions[startIndex * 3 + 1] - graph.positions[endIndex * 3 + 1],
        graph.positions[startIndex * 3 + 2] - graph.positions[endIndex * 3 + 2]
      ),
      warning: 'Disconnected components or no mesh path; using straight fallback',
    };
  }

  // Reconstruct path
  const path: number[] = [];
  let curr = endIndex;
  let totalLength = 0;

  while (curr !== -1) {
    path.push(curr);
    const p = prev[curr];
    if (p !== -1) {
      const dx = graph.positions[curr * 3] - graph.positions[p * 3];
      const dy = graph.positions[curr * 3 + 1] - graph.positions[p * 3 + 1];
      const dz = graph.positions[curr * 3 + 2] - graph.positions[p * 3 + 2];
      totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    curr = p;
  }
  path.reverse();

  return {
    path,
    found: true,
    totalLength,
  };
}

/**
 * Snaps a 3D point to the nearest vertex in the graph.
 */
export function snapPointToNearestVertex(
  graph: SurfaceGraph,
  targetPoint: [number, number, number],
  candidateIndices?: number[]
): number {
  const [tx, ty, tz] = targetPoint;
  const positions = graph.positions;

  if (candidateIndices && candidateIndices.length > 0) {
    let bestIdx = candidateIndices[0];
    let bestDistSq = Infinity;
    for (const idx of candidateIndices) {
      const dx = positions[idx * 3] - tx;
      const dy = positions[idx * 3 + 1] - ty;
      const dz = positions[idx * 3 + 2] - tz;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = idx;
      }
    }
    return bestIdx;
  }

  let bestIdx = 0;
  let bestDistSq = Infinity;
  const V = graph.vertexCount;
  for (let i = 0; i < V; i++) {
    const dx = positions[i * 3] - tx;
    const dy = positions[i * 3 + 1] - ty;
    const dz = positions[i * 3 + 2] - tz;
    const dSq = dx * dx + dy * dy + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = i;
    }
  }

  return bestIdx;
}
