/**
 * FIXTURE: Test fixtures for CardioMap 3D web test suite.
 * Labelled FIXTURE: Strictly for test consumption, NEVER imported by app source code.
 */
import type { SchemaResponse, PredictResponse, ExplainResponse } from '../api/types';
import type { PairedBootstrapData } from '../utils/riskLabels';

export const SCHEMA_FIXTURE: SchemaResponse = {
  api_version: '0.2.0',
  model_version: '0.2.0',
  artifact_hash: 'a1b2c3d4e5f60718',
  disclaimer:
    'CardioMap 3D is for decision support and educational purposes only. It is not a medical device and not a substitute for formal diagnostic imaging (such as coronary angiography) or professional clinical judgment.',
  margin: 0.15,
  risk_cutoffs: {
    y_cad: {
      operating_threshold: 0.5377,
      threshold: 0.5377,
      moderate_min: 0.5377,
      high_min: 0.6877,
      high_threshold: 0.6877,
      cohort_prevalence: 0.7129,
    },
  },
  feature_schema: {
    Age: {
      name: 'Age',
      display_label: 'Age',
      type: 'numeric',
      unit: 'years',
      group: 'demographics',
      min: 30,
      max: 86,
      default: 58,
      allowed_values: null,
    },
    Sex: {
      name: 'Sex',
      display_label: 'Sex',
      type: 'categorical',
      unit: null,
      group: 'demographics',
      min: null,
      max: null,
      default: 'Male',
      allowed_values: ['Male', 'Female'],
    },
    DM: {
      name: 'DM',
      display_label: 'Diabetes Mellitus',
      type: 'binary',
      unit: null,
      group: 'history',
      min: null,
      max: null,
      default: 0,
      allowed_values: [0, 1],
    },
    'Region RWMA': {
      name: 'Region RWMA',
      display_label: 'Regional Wall Motion Abnormality (RWMA)',
      type: 'ordinal',
      unit: 'segments (0-4)',
      group: 'echo',
      min: 0,
      max: 4,
      default: 0,
      allowed_values: [0, 1, 2, 3, 4],
    },
  },
};

export const PREDICT_FIXTURE: PredictResponse = {
  cad: {
    probability: 0.8591,
    label: 1,
    risk_level: 'high',
    cohort_prevalence: 0.7129,
    relative_risk: 1.21,
    threshold: 0.5377,
    high_threshold: 0.6877,
  },
  vessels: {
    lad: {
      probability: 0.6488,
      label: 1,
      risk_level: 'moderate',
      cohort_prevalence: 0.5842,
      relative_risk: 1.11,
      threshold: 0.5006,
      high_threshold: 0.6506,
    },
    lcx: {
      probability: 0.2588,
      label: 0,
      risk_level: 'low',
      cohort_prevalence: 0.3927,
      relative_risk: 0.66,
      threshold: 0.3973,
      high_threshold: 0.5473,
    },
    rca: {
      probability: 0.1813,
      label: 0,
      risk_level: 'low',
      cohort_prevalence: 0.3762,
      relative_risk: 0.48,
      threshold: 0.3354,
      high_threshold: 0.4854,
    },
  },
  coherence: {
    is_incoherent: false,
    raw_cad_probability: 0.8591,
    adjusted_cad_probability: 0.8591,
    max_vessel_probability: 0.6488,
    note: 'Predictions anatomically coherent.',
  },
  imputed_features: ['Weight', 'Length'],
  warnings: [],
  api_version: '0.2.0',
  model_version: '0.2.0',
  disclaimer:
    'CardioMap 3D is for decision support and educational purposes only. It is not a medical device and not a substitute for formal diagnostic imaging (such as coronary angiography) or professional clinical judgment.',
};

export const PREDICT_INCOHERENT_FIXTURE: PredictResponse = {
  ...PREDICT_FIXTURE,
  cad: {
    ...PREDICT_FIXTURE.cad,
    probability: 0.35,
  },
  coherence: {
    is_incoherent: true,
    raw_cad_probability: 0.35,
    adjusted_cad_probability: 0.6488,
    max_vessel_probability: 0.6488,
    note: 'CAD probability (0.350) below branch LAD (0.649).',
  },
};

export const EXPLAIN_FIXTURE: ExplainResponse = {
  targets: {
    cad: {
      target: 'cad',
      raw_unit: 'probability points',
      base_value: 0.7129,
      contributions: [
        {
          feature: 'Typical Chest Pain',
          display_label: 'Typical Chest Pain',
          patient_value: 1,
          shap_value: 0.1245,
          relative_contribution_pct: 28.5,
          direction: 'increases_risk',
          stability_label: 'stable',
        },
        {
          feature: 'Age',
          display_label: 'Age',
          patient_value: 62,
          shap_value: 0.0821,
          relative_contribution_pct: 18.2,
          direction: 'increases_risk',
          stability_label: 'stable',
        },
        {
          feature: 'EF-TTE',
          display_label: 'Ejection Fraction',
          patient_value: 55,
          shap_value: -0.0543,
          relative_contribution_pct: 12.1,
          direction: 'decreases_risk',
          stability_label: 'moderate',
        },
      ],
    },
  },
  requested_targets: ['cad'],
  physiology: [
    {
      feature: 'Typical Chest Pain',
      display_label: 'Typical Chest Pain',
      category: 'symptom',
      patient_value: 1,
      relative_contribution_pct: 28.5,
      direction: 'increases_risk',
      stability_label: 'stable',
    },
  ],
  explainer: {
    method: 'KernelExplainer',
    background_size: 30,
    nsamples: 150,
    unit: 'probability points',
    note: 'Attributions are estimated, describe the displayed calibrated probability, and are not causes.',
    stability_note:
      'Global feature stability evaluated across B=20 bootstrap refits tracking top-10 feature persistence using native tree and linear explainers. Local patient explanations are computed on the deployed calibrated pipeline using stratified KernelExplainer in probability points. They are a proxy and come from a different explainer than the displayed attributions.',
  },
  api_version: '0.2.0',
  model_version: '0.2.0',
  interpretation_note:
    'Explanations describe the displayed calibrated probability in probability points and reflect model-learned associations, not causal findings.',
  disclaimer:
    'CardioMap 3D is for decision support and educational purposes only. It is not a medical device and not a substitute for formal diagnostic imaging (such as coronary angiography) or professional clinical judgment.',
};

export const BOOTSTRAP_FIXTURES: Record<string, PairedBootstrapData> = {
  y_cad: {
    deployed_roc_auc: 0.9256,
    baseline_roc_auc: 0.9032,
    delta_auc: 0.0225,
    ci_95: [-0.0018, 0.0472],
    fraction_deployed_superior: 0.962,
    excludes_zero: false,
  },
  y_lad: {
    deployed_roc_auc: 0.8453,
    baseline_roc_auc: 0.7901,
    delta_auc: 0.0552,
    ci_95: [0.0169, 0.0967],
    fraction_deployed_superior: 0.997,
    excludes_zero: true,
  },
  y_lcx: {
    deployed_roc_auc: 0.7235,
    baseline_roc_auc: 0.7429,
    delta_auc: -0.0195,
    ci_95: [-0.0607, 0.0251],
    fraction_deployed_superior: 0.193,
    excludes_zero: false,
  },
  y_rca: {
    deployed_roc_auc: 0.7397,
    baseline_roc_auc: 0.7412,
    delta_auc: -0.0015,
    ci_95: [-0.0466, 0.0448],
    fraction_deployed_superior: 0.477,
    excludes_zero: false,
  },
};
