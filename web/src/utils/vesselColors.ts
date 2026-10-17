import type { VesselData, VesselColorEvaluation } from '../types/viewer';

export const COLOR_GREEN = '#10b981';  // Below cutoff minimum (p = 0)
export const COLOR_YELLOW = '#eab308'; // At cutoff threshold (p = t)
export const COLOR_ORANGE = '#f97316'; // At high threshold (p = tHigh)
export const COLOR_RED = '#ef4444';    // Full red boundary (p >= tRed)
export const COLOR_GRAY = '#64748b';   // Neutral unpredicted state

export const DEFAULT_HIGH_MARGIN = 0.15;
export const RED_MARGIN = 0.20;

/**
 * Linearly interpolate between two 6-digit hex colors.
 */
export function lerpHex(hexA: string, hexB: string, t: number): string {
  const clampT = Math.max(0, Math.min(1, t));
  const cA = parseInt(hexA.replace('#', ''), 16);
  const cB = parseInt(hexB.replace('#', ''), 16);

  const rA = (cA >> 16) & 255;
  const gA = (cA >> 8) & 255;
  const bA = cA & 255;

  const rB = (cB >> 16) & 255;
  const gB = (cB >> 8) & 255;
  const bB = cB & 255;

  const r = Math.round(rA + (rB - rA) * clampT);
  const g = Math.round(gA + (gB - gA) * clampT);
  const b = Math.round(bA + (bB - bA) * clampT);

  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/**
 * Evaluate vessel probability against clinical cutoff thresholds.
 *
 * Strict Color Rule:
 * Let t = threshold, tHigh = t + highMargin, tRed = tHigh + 0.20
 * - p < t: lerp green (#10b981) to yellow (#eab308) [0 to t]
 * - t <= p < tHigh: lerp yellow (#eab308) to orange (#f97316)
 * - p >= tHigh: lerp orange (#f97316) to red (#ef4444), full red at tRed (clamped)
 * - data null: neutral gray (#64748b)
 * Notice: Positive predictions are labeled "above screening cutoff".
 */
export function evaluateVesselColor(data: VesselData): VesselColorEvaluation {
  if (!data || data.probability === null || data.probability === undefined || Number.isNaN(data.probability)) {
    return {
      color: COLOR_GRAY,
      hex: COLOR_GRAY,
      label: 'No prediction yet',
      status: 'no_data',
      t: 0.5,
      tHigh: 0.65,
      tRed: 0.85,
    };
  }

  const p = Math.max(0, Math.min(1, data.probability));
  const t = Math.max(0.01, Math.min(0.99, data.threshold));
  const highMargin = data.highMargin ?? DEFAULT_HIGH_MARGIN;
  const tHigh = t + highMargin;
  const tRed = tHigh + RED_MARGIN;

  if (p < t) {
    const alpha = t > 0 ? p / t : 0;
    const color = lerpHex(COLOR_GREEN, COLOR_YELLOW, alpha);
    return {
      color,
      hex: color,
      label: 'Below screening cutoff',
      status: 'below_cutoff',
      t,
      tHigh,
      tRed,
    };
  }

  if (p < tHigh) {
    const alpha = highMargin > 0 ? (p - t) / highMargin : 0;
    const color = lerpHex(COLOR_YELLOW, COLOR_ORANGE, alpha);
    return {
      color,
      hex: color,
      label: 'Above screening cutoff',
      status: 'above_cutoff',
      t,
      tHigh,
      tRed,
    };
  }

  const alpha = RED_MARGIN > 0 ? (p - tHigh) / RED_MARGIN : 1;
  const color = lerpHex(COLOR_ORANGE, COLOR_RED, Math.min(1, alpha));
  return {
    color,
    hex: color,
    label: 'Above screening cutoff (elevated)',
    status: 'elevated',
    t,
    tHigh,
    tRed,
  };
}
