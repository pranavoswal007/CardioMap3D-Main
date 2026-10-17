/**
 * Development-only latency logging utility for What-If interactions.
 * Measures slider-to-recolor latency and computes p50 / p95 statistics.
 */

declare global {
  interface Window {
    __WHATIF_LATENCIES__?: number[];
  }
}

const latencies: number[] = [];

export function recordWhatIfLatency(latencyMs: number): void {
  latencies.push(latencyMs);
  if (typeof window !== 'undefined') {
    window.__WHATIF_LATENCIES__ = latencies;
  }
  if (process.env.NODE_ENV !== 'production') {
    console.debug(`[WhatIf Latency] ${latencyMs.toFixed(2)} ms (samples: ${latencies.length})`);
  }
}

export function getWhatIfLatencyStats(): {
  count: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
} {
  if (latencies.length === 0) {
    return { count: 0, p50: 0, p95: 0, min: 0, max: 0, mean: 0 };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const count = sorted.length;
  const p50Index = Math.floor(count * 0.5);
  const p95Index = Math.min(count - 1, Math.floor(count * 0.95));
  const sum = sorted.reduce((acc, val) => acc + val, 0);

  return {
    count,
    p50: sorted[p50Index],
    p95: sorted[p95Index],
    min: sorted[0],
    max: sorted[count - 1],
    mean: sum / count,
  };
}

export function resetWhatIfLatencies(): void {
  latencies.length = 0;
  if (typeof window !== 'undefined') {
    window.__WHATIF_LATENCIES__ = [];
  }
}
