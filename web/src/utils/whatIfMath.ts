/**
 * Mathematical and derivation utilities for What-If exploration.
 */

export function computeDerivedBmi(weightKg: number, lengthCm: number): number {
  if (lengthCm <= 0) return 25.0;
  const heightM = lengthCm / 100;
  return weightKg / (heightM * heightM);
}

export function formatProbabilityDelta(currentP?: number, baselineP?: number): {
  deltaText: string;
  arrow: 'up' | 'down' | 'neutral';
  colorClass: string;
} {
  if (currentP === undefined || baselineP === undefined || isNaN(currentP) || isNaN(baselineP)) {
    return { deltaText: '0.0 pts', arrow: 'neutral', colorClass: 'text-slate-400' };
  }
  const delta = (currentP - baselineP) * 100;
  if (Math.abs(delta) < 0.05) {
    return { deltaText: '0.0 pts', arrow: 'neutral', colorClass: 'text-slate-400' };
  }
  if (delta > 0) {
    return {
      deltaText: `+${delta.toFixed(1)} pts`,
      arrow: 'up',
      colorClass: 'text-rose-400',
    };
  }
  return {
    deltaText: `${delta.toFixed(1)} pts`,
    arrow: 'down',
    colorClass: 'text-emerald-400',
  };
}
