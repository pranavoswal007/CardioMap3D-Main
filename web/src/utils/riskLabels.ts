/**
 * Utility functions for user-facing risk classification and statistical honesty.
 */

export interface PairedBootstrapData {
  deployed_roc_auc?: number;
  baseline_roc_auc?: number;
  delta_auc?: number;
  ci_95?: [number, number];
  fraction_deployed_superior?: number;
  excludes_zero?: boolean;
}

/**
 * Single canonical utility for clinical risk display labels.
 * Low tier -> "below screening cutoff"
 * Both positive tiers -> "above screening cutoff" (never the prohibited phrase)
 */
export function getDisplayRiskLabel(riskLevel?: string | null): string {
  if (!riskLevel) {
    return 'below screening cutoff';
  }
  const norm = riskLevel.toLowerCase().trim();
  if (norm === 'low') {
    return 'below screening cutoff';
  }
  // Both positive tiers read "above screening cutoff"
  return 'above screening cutoff';
}

/**
 * Returns tier sub-label as separate small text ("upper band" for the highest tier).
 */
export function getTierBandLabel(riskLevel?: string | null): string | null {
  if (!riskLevel) return null;
  const norm = riskLevel.toLowerCase().trim();
  if (norm === 'high') {
    return 'upper band';
  }
  return null;
}

/**
 * Honest comparison evaluator per Phase 4 / 4.1 contract:
 * - Uses "statistically better" ONLY if a paired comparison exists and 95% CI excludes 0 with delta > 0.
 * - If CI includes 0 -> "not significantly different" (+ " (baseline matched or exceeded)" if base >= dep).
 * - Otherwise neutral wording -> "higher point estimate; confidence intervals overlap".
 * - Never claims "outperforms".
 */
export function formatHonestyComparisonText(pb?: PairedBootstrapData | null): string {
  if (!pb || !pb.ci_95 || pb.delta_auc === undefined) {
    return 'higher point estimate; confidence intervals overlap';
  }
  const [lower, upper] = pb.ci_95;
  const delta = pb.delta_auc;
  const depAuc = pb.deployed_roc_auc ?? 0;
  const baseAuc = pb.baseline_roc_auc ?? 0;

  const excludesZero = lower > 0 || upper < 0 || pb.excludes_zero === true;

  if (excludesZero && delta > 0) {
    return 'statistically better';
  }

  let text = 'not significantly different';
  if (baseAuc >= depAuc) {
    text += ' (baseline matched or exceeded)';
  }
  return text;
}
