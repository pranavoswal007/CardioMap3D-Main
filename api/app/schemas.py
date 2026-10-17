"""Pydantic v2 schemas for CardioMap 3D API."""

from typing import Any

from pydantic import BaseModel, Field

from .config import API_VERSION, CANONICAL_DISCLAIMER, MODEL_VERSION


class HealthResponse(BaseModel):
    """Health check status response."""

    status: str = Field(default="ok", description="API operational status")
    app_name: str
    api_version: str = Field(default=API_VERSION, description="API interface specification version")
    model_version: str = Field(
        default=MODEL_VERSION, description="Underlying ML model release version"
    )
    artifact_hash: str = Field(description="SHA256 fingerprint of deployed ML artifacts")
    artifacts_ready: bool = Field(description="Whether trained ML model artifacts exist and loaded")
    disclaimer: str = Field(default=CANONICAL_DISCLAIMER, description=CANONICAL_DISCLAIMER)


class CutoffThreshold(BaseModel):
    """Threshold cutoffs for risk tier classification and UI legend display."""

    operating_threshold: float = Field(
        description="Selected operating cutoff t (Youden's J or Max F1)"
    )
    threshold: float = Field(
        description="Selected operating decision threshold (= operating_threshold)"
    )
    moderate_min: float = Field(description="Lower bound for moderate tier (= t)")
    high_min: float = Field(description="Lower bound for high tier (= t + 0.15)")
    high_threshold: float = Field(description="High risk threshold (= t + 0.15)")
    cohort_prevalence: float = Field(
        description="Prevalence of positive outcome in training cohort"
    )


class SchemaResponse(BaseModel):
    """Feature schema response for dynamic UI forms and risk cutoffs for UI legends."""

    api_version: str = Field(default=API_VERSION, description="API interface specification version")
    model_version: str = Field(
        default=MODEL_VERSION, description="Underlying ML model release version"
    )
    artifact_hash: str = Field(description="SHA256 fingerprint of deployed ML artifacts")
    disclaimer: str = Field(default=CANONICAL_DISCLAIMER, description=CANONICAL_DISCLAIMER)
    feature_schema: dict[str, Any] = Field(description="Full 55-feature schema dictionary")
    risk_cutoffs: dict[str, CutoffThreshold] = Field(
        description="Per-target risk level thresholds and margins"
    )
    margin: float = Field(
        default=0.15, description="Margin above operating threshold defining High risk"
    )


class TargetPrediction(BaseModel):
    """Target prediction score, label, risk tier, and relative risk."""

    probability: float = Field(
        ge=0.01, le=0.99, description="Calibrated risk probability clipped to [0.01, 0.99]"
    )
    label: int = Field(description="Binary classification label (1 = Elevated Risk, 0 = Low Risk)")
    risk_level: str = Field(description="'low', 'moderate', or 'high'")
    cohort_prevalence: float = Field(description="Baseline cohort prevalence rate")
    relative_risk: float = Field(
        description="Relative risk ratio (probability / cohort_prevalence)"
    )
    threshold: float = Field(
        description="Selected operating decision threshold separating Low from Moderate tier"
    )
    high_threshold: float = Field(description="High risk threshold (threshold + high margin)")


class PredictResponse(BaseModel):
    """Multi-vessel CAD prediction response with coherence and imputation audit."""

    cad: TargetPrediction = Field(description="Overall CAD prediction")
    vessels: dict[str, TargetPrediction] = Field(
        description="Individual coronary artery vessel predictions (lad, lcx, rca)"
    )
    coherence: dict[str, Any] = Field(
        description="Anatomical coherence audit between overall CAD and vessels"
    )
    imputed_features: list[str] = Field(
        description="List of omitted feature names that were filled using schema defaults"
    )
    warnings: list[str] = Field(description="Validation warnings for out-of-range clinical inputs")
    api_version: str = Field(default=API_VERSION, description="API interface specification version")
    model_version: str = Field(
        default=MODEL_VERSION, description="Underlying ML model release version"
    )
    disclaimer: str = Field(default=CANONICAL_DISCLAIMER, description=CANONICAL_DISCLAIMER)


class FeatureExplanation(BaseModel):
    """Local SHAP feature attribution entry."""

    feature: str = Field(description="Raw feature identifier")
    display_label: str = Field(description="Human-readable display name")
    patient_value: Any = Field(description="Input value provided for the patient")
    shap_value: float = Field(description="SHAP attribution value in model raw score units")
    relative_contribution_pct: float = Field(
        description="Normalized signed relative contribution percentage"
    )
    direction: str = Field(description="'increases_risk' or 'decreases_risk'")
    stability_label: str = Field(
        description="'stable', 'moderate', or 'low' persistence across bootstrap resamples"
    )


class TargetExplanation(BaseModel):
    """Per-target explainability breakdown."""

    target: str
    raw_unit: str = Field(
        default="probability points",
        description="Measurement unit for raw SHAP values (probability points)",
    )
    base_value: float = Field(description="Expected base score across reference background")
    contributions: list[FeatureExplanation] = Field(description="Top N local feature attributions")


class PhysiologyItem(BaseModel):
    """Physiological factor contribution to overall CAD."""

    feature: str
    display_label: str
    category: str
    patient_value: Any
    relative_contribution_pct: float
    direction: str
    stability_label: str


class ExplainerMetadata(BaseModel):
    """Metadata describing the explanation method, sampling parameters, and clinical interpretation."""

    method: str = Field(default="KernelExplainer", description="Model-agnostic explainer method")
    background_size: int = Field(
        default=30, description="Size of stratified background reference sample"
    )
    nsamples: int = Field(
        default=150, description="Number of Monte Carlo feature perturbation samples per patient"
    )
    unit: str = Field(default="probability points", description="Attribution unit")
    note: str = Field(
        default="Attributions are estimated, describe the displayed calibrated probability, and are not causes.",
        description="Clinical interpretation note",
    )
    stability_note: str = Field(
        description="Disclosure for bootstrap stability labels dynamically constructed from provenance",
    )


class ExplainResponse(BaseModel):
    """Full SHAP explainability response."""

    targets: dict[str, TargetExplanation] = Field(
        description="Explanations per target (cad, lad, lcx, rca)"
    )
    requested_targets: list[str] = Field(
        description="Canonical list of targets requested and explained"
    )
    physiology: list[PhysiologyItem] | None = Field(
        default=None,
        description="Key physiological measurement attributions for CAD (populated only when cad is requested, null otherwise)",
    )
    explainer: ExplainerMetadata = Field(
        description="Explanation method, background sample size, and sampling parameters"
    )
    api_version: str = Field(default=API_VERSION, description="API interface specification version")
    model_version: str = Field(
        default=MODEL_VERSION, description="Underlying ML model release version"
    )
    interpretation_note: str = Field(
        default="Explanations describe the displayed calibrated probability in probability points and reflect model-learned associations, not causal findings.",
        description="Clinical interpretation disclosure",
    )
    disclaimer: str = Field(default=CANONICAL_DISCLAIMER, description=CANONICAL_DISCLAIMER)


class SamplePatient(BaseModel):
    """Real de-identified patient sample from dataset."""

    sample_id: str
    dataset_row_index: int
    cad_probability: float
    risk_tier: str
    features: dict[str, Any]


class MetricsResponse(BaseModel):
    """Complete performance metrics, candidate comparison, and baseline benchmarks."""

    deployed_models: dict[str, Any]
    candidate_comparison: dict[str, Any]
    clinical_baseline_comparison: dict[str, Any]
    nested_tuning_config: dict[str, Any]
    disclosures: dict[str, str]
