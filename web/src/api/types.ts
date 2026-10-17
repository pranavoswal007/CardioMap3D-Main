/**
 * Re-export and type aliases derived directly from openapi-typescript generated schema.
 * No arbitrary `any` or loose manual interfaces.
 */
import type { components } from './schema';

export type Schema = components['schemas'];

export type HealthResponse = Schema['HealthResponse'];
export type SchemaResponse = Schema['SchemaResponse'];
export type PredictResponse = Schema['PredictResponse'];
export type ExplainResponse = Schema['ExplainResponse'];
export type MetricsResponse = Schema['MetricsResponse'];
export type SamplePatient = Schema['SamplePatient'];
export type TargetPrediction = Schema['TargetPrediction'];
export type FeatureExplanation = Schema['FeatureExplanation'];
export type ExplainerMetadata = Schema['ExplainerMetadata'];
export type PhysiologyItem = Schema['PhysiologyItem'];
export type CutoffThreshold = Schema['CutoffThreshold'];

export type TargetCode = 'cad' | 'lad' | 'lcx' | 'rca';

export interface FeatureSchemaItem {
  name: string;
  display_label: string;
  type: 'numeric' | 'binary' | 'ordinal' | 'categorical';
  unit?: string | null;
  group?: string | null;
  min?: number | null;
  max?: number | null;
  default?: number | string | null;
  allowed_values?: (string | number)[] | null;
}

export interface MetricPointEstimate {
  point_estimate?: number;
  ci_95?: [number, number];
  inside_ci?: boolean;
}

export interface DeployedTargetModel {
  selected_model?: string;
  calibration?: Record<string, unknown>;
  metrics?: {
    accuracy?: MetricPointEstimate;
    precision?: MetricPointEstimate;
    recall?: MetricPointEstimate;
    f1?: MetricPointEstimate;
    roc_auc?: MetricPointEstimate;
    pr_auc?: MetricPointEstimate;
    brier_score?: MetricPointEstimate;
  };
  prevalence?: {
    positives?: number;
    total?: number;
    rate?: number;
  };
  operating_threshold?: number;
}

export interface ClinicalBaselineTarget {
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1?: number;
  roc_auc?: number;
  pr_auc?: number;
  brier_score?: number;
  paired_bootstrap?: {
    baseline_model?: string;
    clinical_features?: string[];
    deployed_roc_auc?: number;
    baseline_roc_auc?: number;
    delta_auc?: number;
    ci_95?: [number, number];
    fraction_deployed_superior?: number;
    excludes_zero?: boolean;
    significance?: string;
  };
}

export interface CandidateModelInfo {
  metrics?: {
    accuracy?: MetricPointEstimate;
    precision?: MetricPointEstimate;
    recall?: MetricPointEstimate;
    f1?: MetricPointEstimate;
    roc_auc?: MetricPointEstimate;
    pr_auc?: MetricPointEstimate;
    brier_score?: MetricPointEstimate;
  };
  best_params?: Record<string, unknown>;
  calibration_brier?: number;
}
