import * as THREE from 'three';

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

/**
 * Converts sRGB [0, 1] to CIELAB [L, a, b] using standard D65 illuminant.
 */
export function rgbToLab(
  rOrColor: number | RGBColor,
  optG?: number,
  optB?: number
): [number, number, number] {
  let r: number, g: number, b: number;
  if (typeof rOrColor === 'object') {
    r = rOrColor.r;
    g = rOrColor.g;
    b = rOrColor.b;
  } else {
    r = rOrColor;
    g = optG ?? 0;
    b = optB ?? 0;
  }

  // sRGB to linear RGB
  const toLinear = (c: number) =>
    c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;

  const lr = toLinear(Math.max(0, Math.min(1, r)));
  const lg = toLinear(Math.max(0, Math.min(1, g)));
  const lb = toLinear(Math.max(0, Math.min(1, b)));

  // Linear RGB to XYZ (D65 illuminant, 2° observer)
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047;
  const y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175) / 1.0;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / 1.08883;

  // XYZ to CIELAB
  const f = (t: number) => (t > 0.00885645 ? Math.cbrt(t) : 7.787037 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bVal = 200 * (fy - fz);

  return [L, a, bVal];
}

/**
 * Standard CIELAB Delta E (CIE76) color difference.
 * Output typically ranges from 0 to ~100+.
 */
export function deltaE(
  lab1: [number, number, number],
  lab2: [number, number, number]
): number {
  const dL = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

export const colorDistanceLab = deltaE;

/**
 * Samples vertex color using BufferAttribute getX/getY/getZ to decode
 * quantized or normalized attributes correctly in rendering color space.
 */
export function sampleVertexColor(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vertexIndex: number
): RGBColor {
  const count = attribute.count;
  if (vertexIndex < 0 || vertexIndex >= count) {
    return { r: 1, g: 1, b: 1 };
  }
  return {
    r: attribute.getX(vertexIndex),
    g: attribute.getY(vertexIndex),
    b: attribute.getZ(vertexIndex),
  };
}

/**
 * Computes per-vertex normalized color distance to target color.
 * Returns Float32Array where each entry is normalized between 0.0 and 1.0 (clamped).
 */
export function computeVertexColorDistances(
  colorAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  targetColor: RGBColor
): Float32Array {
  const count = colorAttribute.count;
  const distances = new Float32Array(count);
  const targetLab = rgbToLab(targetColor.r, targetColor.g, targetColor.b);

  for (let i = 0; i < count; i++) {
    const r = colorAttribute.getX(i);
    const g = colorAttribute.getY(i);
    const b = colorAttribute.getZ(i);
    const vLab = rgbToLab(r, g, b);
    const d = deltaE(targetLab, vLab);
    // Normalize deltaE: deltaE of 0 = 0.0, deltaE of 80+ = 1.0
    distances[i] = Math.min(1.0, Math.max(0.0, d / 80.0));
  }

  return distances;
}

/**
 * Computes boolean mask and selection percentage based on distance threshold.
 */
export function computeMaskFromDistances(
  distances: Float32Array,
  threshold: number
): { mask: Uint8Array; count: number; percentage: number } {
  const total = distances.length;
  const mask = new Uint8Array(total);
  let selectedCount = 0;

  for (let i = 0; i < total; i++) {
    if (distances[i] <= threshold) {
      mask[i] = 1;
      selectedCount++;
    }
  }

  const percentage = total > 0 ? (selectedCount / total) * 100 : 0;
  return { mask, count: selectedCount, percentage };
}
