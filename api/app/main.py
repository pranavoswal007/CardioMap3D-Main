"""Main FastAPI entrypoint for CardioMap 3D API."""

from __future__ import annotations

import hashlib
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, cast

import joblib
import numpy as np
import pandas as pd
import shap
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .schemas import (
    CutoffThreshold,
    ExplainerMetadata,
    ExplainResponse,
    FeatureExplanation,
    HealthResponse,
    MetricsResponse,
    PhysiologyItem,
    PredictResponse,
    SamplePatient,
    SchemaResponse,
    TargetExplanation,
    TargetPrediction,
)

logger = logging.getLogger(__name__)


def compute_artifact_hash(artifacts_dir: Path) -> str:
    """Compute SHA256 fingerprint over deployed model artifacts and configuration."""
    h = hashlib.sha256()
    for fname in sorted(
        [
            "model_y_cad.joblib",
            "model_y_lad.joblib",
            "model_y_lcx.joblib",
            "model_y_rca.joblib",
            "thresholds.json",
            "feature_schema.json",
        ]
    ):
        fpath = artifacts_dir / fname
        if fpath.exists():
            h.update(fname.encode("utf-8"))
            h.update(fpath.read_bytes())
    return h.hexdigest()[:16]


def build_stability_note(stability_data: dict[str, Any] | None) -> str:
    """Dynamically construct stability note from shap_stability.json provenance without hardcoded numbers."""
    if not stability_data:
        STATE["artifacts_ready"] = False
        STATE["artifacts_error_reason"] = "Missing shap_stability artifact data"
        raise KeyError("Missing shap_stability data; cannot construct stability_note")

    prov = stability_data.get("provenance")
    if not isinstance(prov, dict):
        STATE["artifacts_ready"] = False
        STATE["artifacts_error_reason"] = "Missing 'provenance' object in shap_stability data"
        raise KeyError("Missing 'provenance' object in shap_stability data; cannot construct stability_note")

    for key in ("bootstrap_refits", "top_k", "explainer_types"):
        if key not in prov:
            STATE["artifacts_ready"] = False
            STATE["artifacts_error_reason"] = f"Missing required provenance key '{key}' in shap_stability"
            raise KeyError(f"Missing required provenance key '{key}' in shap_stability; cannot construct stability_note")

    refits = prov["bootstrap_refits"]
    top_k = prov["top_k"]
    explainer_types = prov["explainer_types"]

    return (
        f"Global feature stability evaluated across B={refits} bootstrap refits "
        f"tracking top-{top_k} feature persistence using {explainer_types}. "
        f"Local patient explanations are computed on the deployed calibrated pipeline "
        f"using stratified KernelExplainer in probability points. "
        f"They are a proxy and come from a different explainer than the displayed attributions."
    )


# In-memory artifact state loaded once at startup
STATE: dict[str, Any] = {
    "artifacts_ready": False,
    "models": {},
    "thresholds": {},
    "metrics": {},
    "feature_schema": {},
    "shap_stability": {},
    "shap_background": None,
    "explainers": {},
    "sample_patients": [],
    "explain_cache": {},
    "target_explain_cache": {},
    "predict_cache": {},
    "cache_hits": 0,
    "cache_misses": 0,
    "artifact_hash": "unknown",
}

TARGET_KEYS = ["cad", "lad", "lcx", "rca"]
TARGET_MAP = {
    "cad": "y_cad",
    "lad": "y_lad",
    "lcx": "y_lcx",
    "rca": "y_rca",
}
FORBIDDEN_COLUMNS = {"LAD", "LCX", "RCA", "CATH", "CAD"}
PREDICT_POOL = ThreadPoolExecutor(max_workers=4)


def to_python_primitive(val: Any) -> Any:
    """Convert numpy scalars or pandas objects to native python primitives."""
    if hasattr(val, "item"):
        return val.item()
    return val


def normalize_input_value(raw_val: Any, feat_info: dict[str, Any]) -> Any:
    """Map human-friendly inputs (e.g. 'Male'/'Female', yes/no, true/false) to dataset format."""
    if raw_val is None:
        return feat_info.get("default")

    feat_type = feat_info.get("type")
    allowed = feat_info.get("allowed_values") or []

    # Biological sex normalization
    if feat_info.get("name") == "Sex":
        str_val = str(raw_val).strip().lower()
        if str_val in ("male", "m"):
            return "Male"
        elif str_val in ("female", "fmale", "f"):
            return "Fmale"

    # Boolean / binary normalization
    if feat_type == "binary":
        if isinstance(raw_val, bool):
            return 1 if raw_val else 0
        if isinstance(raw_val, (int, float)):
            return int(raw_val)
        str_val = str(raw_val).strip().lower()
        if str_val in ("yes", "y", "true", "t", "1", "present", "stenotic", "cad"):
            return "Y" if "Y" in allowed else 1
        elif str_val in ("no", "n", "false", "f", "0", "absent", "normal"):
            return "N" if "N" in allowed else 0

    # Categorical normalization (VHD, BBB)
    if feat_type == "categorical":
        str_val = str(raw_val).strip()
        for a in allowed:
            if str(a).lower() == str_val.lower():
                return a
        return str_val

    # Numeric normalization
    if feat_type in ("numeric", "ordinal"):
        try:
            return float(raw_val)
        except (ValueError, TypeError):
            return feat_info.get("default")

    return raw_val


def load_all_artifacts() -> None:
    """Load trained models, schemas, metrics, thresholds, and SHAP assets into memory."""
    artifacts_dir = settings.artifacts_dir
    logger.info("Loading CardioMap 3D ML artifacts from %s...", artifacts_dir)

    try:
        # 1. Feature schema
        schema_path = artifacts_dir / "feature_schema.json"
        if not schema_path.exists():
            schema_path = settings.base_dir / "ml" / "config" / "feature_schema.json"
        with open(schema_path, encoding="utf-8") as f:
            STATE["feature_schema"] = json.load(f)

        # 2. Thresholds
        with open(artifacts_dir / "thresholds.json", encoding="utf-8") as f:
            STATE["thresholds"] = json.load(f)

        # 3. Metrics
        with open(artifacts_dir / "metrics.json", encoding="utf-8") as f:
            STATE["metrics"] = json.load(f)

        # 4. SHAP stability
        stability_path = artifacts_dir / "shap_stability.json"
        if stability_path.exists():
            with open(stability_path, encoding="utf-8") as f:
                STATE["shap_stability"] = json.load(f)
            build_stability_note(STATE["shap_stability"])
        else:
            raise FileNotFoundError(f"shap_stability.json missing in {artifacts_dir}")

        # 5. SHAP background sample
        bg_path = artifacts_dir / "shap_background_sample.csv"
        if bg_path.exists():
            STATE["shap_background"] = pd.read_csv(bg_path)

        # 6. Models
        for short_name, t_code in TARGET_MAP.items():
            model_file = artifacts_dir / f"model_{t_code}.joblib"
            if model_file.exists():
                calibrated_model = joblib.load(model_file)
                # Optimize single-sample thread dispatch overhead
                for cal in getattr(calibrated_model, "calibrated_classifiers_", []):
                    pipe = cal.estimator
                    clf = pipe.named_steps.get("clf")
                    if hasattr(clf, "n_jobs"):
                        clf.n_jobs = 1
                    if hasattr(clf, "estimators_"):
                        for sub in clf.estimators_:
                            if hasattr(sub, "n_jobs"):
                                sub.n_jobs = 1
                STATE["models"][short_name] = calibrated_model

                # Pre-initialize unified model-agnostic explainer on DEPLOYED calibrated pipeline
                if STATE["shap_background"] is not None:
                    bg_df = STATE["shap_background"]
                    feat_cols = list(STATE["feature_schema"].keys())

                    def make_predict_fn(mod: Any, cols: list[str]) -> Any:
                        return lambda x: mod.predict_proba(
                            x if isinstance(x, pd.DataFrame) else pd.DataFrame(x, columns=cols)
                        )[:, 1]

                    expl = shap.KernelExplainer(make_predict_fn(calibrated_model, feat_cols), bg_df)
                    STATE["explainers"][short_name] = (expl, "probability points")

        # 7. Generate sample patients
        raw_data_path = settings.data_dir / "raw" / "z_alizadeh_sani_extension.xlsx"
        if raw_data_path.exists() and "cad" in STATE["models"]:
            df_raw = pd.read_excel(raw_data_path, sheet_name="Sheet 1 - Table 1")
            X_raw = df_raw.drop(columns=["Cath", "LAD", "LCX", "RCA"])
            probs = np.clip(
                STATE["models"]["cad"].predict_proba(X_raw)[:, 1],
                settings.clip_min,
                settings.clip_max,
            )

            low_idx = np.where(probs < 0.35)[0]
            mod_idx = np.where((probs >= 0.45) & (probs <= 0.65))[0]
            high_idx = np.where(probs > 0.85)[0]

            samples = []
            selected_indices = [
                int(low_idx[0]),
                int(low_idx[1]),
                int(mod_idx[0]),
                int(mod_idx[1]),
                int(high_idx[0]),
                int(high_idx[1]),
            ]
            for idx in selected_indices:
                p_val = float(probs[idx])
                tier = "low" if p_val < 0.35 else ("moderate" if p_val <= 0.65 else "high")
                samples.append(
                    SamplePatient(
                        sample_id=f"sample_patient_{idx}",
                        dataset_row_index=idx,
                        cad_probability=round(p_val, 4),
                        risk_tier=tier,
                        features={
                            k: to_python_primitive(v) for k, v in X_raw.iloc[idx].to_dict().items()
                        },
                    )
                )
            STATE["sample_patients"] = samples

        STATE["artifact_hash"] = compute_artifact_hash(artifacts_dir)
        STATE["artifacts_ready"] = True
        logger.info(
            "All ML artifacts loaded successfully (artifact_hash=%s).", STATE["artifact_hash"]
        )

    except (FileNotFoundError, KeyError, ValueError, RuntimeError) as e:
        logger.error("Failed to load ML artifacts: %s", e)
        STATE["artifacts_ready"] = False


from collections.abc import AsyncIterator


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Lifespan context manager to load ML artifacts at startup."""
    load_all_artifacts()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.api_version,
    description=settings.disclaimer,
    lifespan=lifespan,
)

# Enable CORS for frontend Vite dev server and production clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static plots from /artifacts as /static/plots
plots_dir = settings.artifacts_dir
if plots_dir.exists():
    app.mount("/static/plots", StaticFiles(directory=str(plots_dir)), name="plots")


@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Safe, formatted error response."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "error_type": "ClientError"},
    )


@app.get("/health", response_model=HealthResponse)
@app.get("/healthz", response_model=HealthResponse)
def health_check() -> HealthResponse:
    """Check API operational health, model version, and artifact readiness."""
    return HealthResponse(
        status="ok",
        app_name=settings.app_name,
        api_version=settings.api_version,
        model_version=settings.model_version,
        artifact_hash=str(STATE.get("artifact_hash", "unknown")),
        artifacts_ready=STATE["artifacts_ready"],
        disclaimer=settings.disclaimer,
    )


@app.get("/schema", response_model=SchemaResponse)
def get_schema() -> SchemaResponse:
    """Return feature schema for the dynamic form and per-target risk cutoffs for the UI legend."""
    if not STATE["artifacts_ready"]:
        raise HTTPException(status_code=503, detail="Model artifacts not ready.")

    thresholds_dict = STATE["thresholds"]
    metrics_dict = STATE["metrics"]

    risk_cutoffs = {}
    for short_name, t_code in TARGET_MAP.items():
        t_data = thresholds_dict.get(t_code, {})
        sel_t = float(t_data.get("selected_threshold", 0.5))
        prev = float(
            metrics_dict.get("targets", {}).get(t_code, {}).get("prevalence", {}).get("rate", 0.5)
        )
        risk_cutoffs[short_name] = CutoffThreshold(
            operating_threshold=round(sel_t, 4),
            threshold=round(sel_t, 4),
            moderate_min=round(sel_t, 4),
            high_min=round(sel_t + settings.risk_level_margin, 4),
            high_threshold=round(sel_t + settings.risk_level_margin, 4),
            cohort_prevalence=round(prev, 4),
        )

    return SchemaResponse(
        api_version=settings.api_version,
        model_version=settings.model_version,
        artifact_hash=str(STATE.get("artifact_hash", "unknown")),
        disclaimer=settings.disclaimer,
        feature_schema=STATE["feature_schema"],
        risk_cutoffs=risk_cutoffs,
        margin=settings.risk_level_margin,
    )


def validate_and_prepare_input(
    patient_data: dict[str, Any],
) -> tuple[pd.DataFrame, list[str], list[str]]:
    """Validate patient features, reject forbidden/unknown fields, impute defaults, and flag out-of-range inputs."""
    schema = STATE["feature_schema"]
    allowed_features = set(schema.keys())

    # Check for forbidden leakage columns
    for key in patient_data:
        cleaned_k = key.strip().upper()
        if cleaned_k in FORBIDDEN_COLUMNS:
            raise HTTPException(
                status_code=422,
                detail=f"Forbidden column detected: '{key}'. Target and post-catheterization columns are strictly disallowed as model inputs.",
            )

    # Check for unknown fields
    unknown_fields = [k for k in patient_data if k not in allowed_features]
    if unknown_fields:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown input feature(s) received: {unknown_fields}. Features must match feature_schema.json.",
        )

    prepared_row = {}
    imputed_fields = []
    warnings = []

    for fname, finfo in schema.items():
        if fname in patient_data and patient_data[fname] is not None:
            raw_v = patient_data[fname]
            norm_v = normalize_input_value(raw_v, finfo)
            prepared_row[fname] = norm_v

            # Range check for numeric features
            if finfo.get("type") in ("numeric", "ordinal") and isinstance(norm_v, (int, float)):
                f_min = finfo.get("min")
                f_max = finfo.get("max")
                if f_min is not None and norm_v < f_min:
                    warnings.append(
                        f"Feature '{fname}' value {norm_v} is below observed cohort minimum {f_min}."
                    )
                elif f_max is not None and norm_v > f_max:
                    warnings.append(
                        f"Feature '{fname}' value {norm_v} is above observed cohort maximum {f_max}."
                    )
        else:
            default_v = finfo.get("default")
            prepared_row[fname] = default_v
            imputed_fields.append(fname)

    df_patient = pd.DataFrame([prepared_row])
    return df_patient, imputed_fields, warnings


def compute_prediction_for_target(short_name: str, df_patient: pd.DataFrame) -> TargetPrediction:
    """Compute calibrated, clipped probability, risk tier, and relative risk for a target."""
    model = STATE["models"][short_name]
    t_code = TARGET_MAP[short_name]
    threshold_info = STATE["thresholds"][t_code]
    sel_t = float(threshold_info["selected_threshold"])
    prev = float(STATE["metrics"]["targets"][t_code]["prevalence"]["rate"])

    raw_prob = float(model.predict_proba(df_patient)[:, 1][0])
    p = float(np.clip(raw_prob, settings.clip_min, settings.clip_max))

    # Strict risk_level rule derived from selected_threshold t
    margin = settings.risk_level_margin
    high_t = sel_t + margin
    if p < sel_t:
        risk_level = "low"
        label = 0
    elif p < high_t:
        risk_level = "moderate"
        label = 1
    else:
        risk_level = "high"
        label = 1

    rel_risk = round(p / prev, 2) if prev > 0 else 1.0

    return TargetPrediction(
        probability=round(p, 4),
        label=label,
        risk_level=risk_level,
        cohort_prevalence=round(prev, 4),
        relative_risk=rel_risk,
        threshold=round(sel_t, 4),
        high_threshold=round(high_t, 4),
    )


@app.post("/predict", response_model=PredictResponse)
def predict_stenosis_risk(patient_features: dict[str, Any]) -> PredictResponse:
    """Predict calibrated CAD and vessel-specific stenosis probabilities with coherence audit."""
    if not STATE["artifacts_ready"]:
        raise HTTPException(status_code=503, detail="Model artifacts not ready.")

    # Input hash cache check
    norm_dict = {k: to_python_primitive(v) for k, v in sorted(patient_features.items())}
    cache_key = hashlib.sha256(json.dumps(norm_dict, sort_keys=True).encode("utf-8")).hexdigest()
    if cache_key in STATE["predict_cache"]:
        STATE["cache_hits"] += 1
        return cast(PredictResponse, STATE["predict_cache"][cache_key])
    STATE["cache_misses"] += 1

    df_patient, imputed_fields, warnings = validate_and_prepare_input(patient_features)

    # 1. Predictions per target in parallel
    targets = ["cad", "lad", "lcx", "rca"]
    preds = list(PREDICT_POOL.map(lambda t: compute_prediction_for_target(t, df_patient), targets))
    pred_map = dict(zip(targets, preds, strict=True))
    cad_pred = pred_map["cad"]
    vessel_preds = {
        "lad": pred_map["lad"],
        "lcx": pred_map["lcx"],
        "rca": pred_map["rca"],
    }

    # 2. Anatomical coherence audit: P(CAD) should ideally >= max(P(vessels))
    max_vessel_prob = max(vp.probability for vp in vessel_preds.values())
    raw_cad_prob = cad_pred.probability
    is_incoherent = bool(raw_cad_prob < max_vessel_prob)
    adjusted_cad_prob = max_vessel_prob if is_incoherent else raw_cad_prob

    coherence_info = {
        "is_incoherent": is_incoherent,
        "raw_cad_probability": round(raw_cad_prob, 4),
        "adjusted_cad_probability": round(adjusted_cad_prob, 4),
        "max_vessel_probability": round(max_vessel_prob, 4),
        "note": (
            "Anatomical coherence adjustment applied: individual vessel probability exceeds raw CAD score."
            if is_incoherent
            else "Predictions anatomically coherent."
        ),
    }

    response = PredictResponse(
        api_version=settings.api_version,
        model_version=settings.model_version,
        cad=cad_pred,
        vessels=vessel_preds,
        coherence=coherence_info,
        imputed_features=imputed_fields,
        warnings=warnings,
        disclaimer=settings.disclaimer,
    )
    if len(STATE["predict_cache"]) >= 500:
        STATE["predict_cache"].pop(next(iter(STATE["predict_cache"])))
    STATE["predict_cache"][cache_key] = response
    return response


@app.post("/explain", response_model=ExplainResponse)
def explain_stenosis_prediction(
    patient_features: dict[str, Any],
    top_n: int = 10,
    targets: str | None = Query(
        default=None, description="Comma-separated subset of targets (allowed: cad, lad, lcx, rca)"
    ),
) -> ExplainResponse:
    """Compute local SHAP feature attributions in raw score and normalized relative contribution %."""
    if not STATE["artifacts_ready"]:
        raise HTTPException(status_code=503, detail="Model artifacts not ready.")

    allowed_targets = ["cad", "lad", "lcx", "rca"]
    if targets is None:
        requested_targets = allowed_targets
    else:
        raw_list = [t.strip().lower() for t in targets.split(",")]
        if not raw_list or any(t == "" for t in raw_list):
            raise HTTPException(
                status_code=422,
                detail="Empty target specified. Allowed targets are: cad, lad, lcx, rca",
            )
        unknown = [t for t in raw_list if t not in allowed_targets]
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid target(s): {', '.join(sorted(set(unknown)))}. Allowed targets are: cad, lad, lcx, rca",
            )
        deduped = set(raw_list)
        requested_targets = [t for t in allowed_targets if t in deduped]

    df_patient, _, _ = validate_and_prepare_input(patient_features)
    schema = STATE["feature_schema"]

    norm_dict = {k: to_python_primitive(v) for k, v in sorted(patient_features.items())}
    patient_hash = hashlib.sha256(json.dumps(norm_dict, sort_keys=True).encode("utf-8")).hexdigest()

    PHYSIOLOGY_FEATURES = {
        "Age": "Demographics",
        "Typical Chest Pain": "Symptoms",
        "Region RWMA": "Echocardiography",
        "EF-TTE": "Echocardiography",
        "HTN": "Cardiovascular History",
        "DM": "Metabolic History",
        "TG": "Lipid Profile",
        "FBS": "Metabolic Lab",
        "Tinversion": "Electrocardiography",
        "ESR": "Inflammatory Biomarkers",
    }

    target_explanations: dict[str, TargetExplanation] = {}
    target_raw_map: dict[str, dict[str, Any]] = {}

    for short_name in requested_targets:
        cache_key = (patient_hash, short_name)
        if cache_key in STATE["target_explain_cache"]:
            STATE["cache_hits"] += 1
            raw_data = STATE["target_explain_cache"][cache_key]
        else:
            STATE["cache_misses"] += 1
            if short_name not in STATE["explainers"]:
                continue
            (explainer, raw_unit) = STATE["explainers"][short_name]
            t_code = TARGET_MAP[short_name]
            feature_names = list(df_patient.columns)

            # Re-seed RNG per target for bit-for-bit determinism across all subsets
            np.random.seed(42)
            try:
                sv = explainer.shap_values(df_patient, nsamples=150, silent=True)
                if isinstance(sv, list):
                    vals = sv[0]
                else:
                    vals = sv[0] if len(sv.shape) == 2 else sv
                base_v = float(explainer.expected_value)
            except (ValueError, TypeError, RuntimeError) as e:
                logger.warning("SHAP calculation fallback for %s: %s", short_name, e)
                vals = np.zeros(len(feature_names))
                base_v = 0.5

            abs_vals = np.abs(vals)
            sum_abs = float(np.sum(abs_vals))
            if sum_abs < 1e-9:
                sum_abs = 1.0

            rel_pcts = (vals / sum_abs) * 100.0
            stability_info = STATE.get("shap_stability", {}).get(t_code, {})

            all_contribs = []
            for i, fname in enumerate(feature_names):
                disp_label = schema.get(fname, {}).get("display_label", fname)
                pat_v = to_python_primitive(df_patient[fname].iloc[0])
                val_shap = float(vals[i])
                val_pct = float(rel_pcts[i])
                direction = "increases_risk" if val_shap > 0 else "decreases_risk"
                f_stab = stability_info.get(fname, {}).get("label", "moderate")
                all_contribs.append(
                    {
                        "feature": fname,
                        "display_label": disp_label,
                        "patient_value": pat_v,
                        "shap_value": round(val_shap, 5),
                        "relative_contribution_pct": round(val_pct, 2),
                        "direction": direction,
                        "stability_label": f_stab,
                        "abs_val": float(abs_vals[i]),
                    }
                )

            raw_data = {
                "base_value": base_v,
                "all_contributions": all_contribs,
                "raw_unit": raw_unit,
            }
            if len(STATE["target_explain_cache"]) >= 2000:
                STATE["target_explain_cache"].pop(next(iter(STATE["target_explain_cache"])))
            STATE["target_explain_cache"][cache_key] = raw_data

        target_raw_map[short_name] = raw_data

        # Sort and select top_n features AFTER cache retrieval
        sorted_contribs = sorted(
            raw_data["all_contributions"], key=lambda c: c["abs_val"], reverse=True
        )
        top_contribs = [
            FeatureExplanation(
                feature=c["feature"],
                display_label=c["display_label"],
                patient_value=c["patient_value"],
                shap_value=c["shap_value"],
                relative_contribution_pct=c["relative_contribution_pct"],
                direction=c["direction"],
                stability_label=c["stability_label"],
            )
            for c in sorted_contribs[:top_n]
        ]
        target_explanations[short_name] = TargetExplanation(
            target=short_name,
            raw_unit=raw_data["raw_unit"],
            base_value=round(raw_data["base_value"], 5),
            contributions=top_contribs,
        )

    # Physiology items are included ONLY when cad is in requested_targets, else null
    physiology_items: list[PhysiologyItem] | None = None
    if "cad" in requested_targets and "cad" in target_raw_map:
        cad_raw = target_raw_map["cad"]
        contrib_map = {c["feature"]: c for c in cad_raw["all_contributions"]}
        phys_list = []
        for phys_feat, cat in PHYSIOLOGY_FEATURES.items():
            if phys_feat in contrib_map:
                c = contrib_map[phys_feat]
                phys_list.append(
                    PhysiologyItem(
                        feature=phys_feat,
                        display_label=c["display_label"],
                        category=cat,
                        patient_value=c["patient_value"],
                        relative_contribution_pct=c["relative_contribution_pct"],
                        direction=c["direction"],
                        stability_label=c["stability_label"],
                    )
                )
        physiology_items = phys_list

    bg_size = len(STATE["shap_background"]) if STATE.get("shap_background") is not None else 30
    explainer_metadata = ExplainerMetadata(
        method="KernelExplainer",
        background_size=int(bg_size),
        nsamples=150,
        unit="probability points",
        note="Attributions are estimated, describe the displayed calibrated probability, and are not causes.",
        stability_note=build_stability_note(STATE.get("shap_stability")),
    )

    return ExplainResponse(
        targets=target_explanations,
        requested_targets=requested_targets,
        physiology=physiology_items,
        explainer=explainer_metadata,
        api_version=settings.api_version,
        model_version=settings.model_version,
        interpretation_note=(
            "Explanations describe the displayed calibrated probability in probability points "
            "and reflect model-learned associations, not causal findings."
        ),
        disclaimer=settings.disclaimer,
    )


@app.get("/metrics", response_model=MetricsResponse)
def get_metrics_report() -> MetricsResponse:
    """Return deployed model performance with 95% CIs, candidate comparison, and baseline benchmarks."""
    if not STATE["artifacts_ready"]:
        raise HTTPException(status_code=503, detail="Model artifacts not ready.")

    metrics_data = STATE["metrics"]
    targets_data = metrics_data.get("targets", {})

    deployed = {}
    candidates = {}
    clinical_baseline = {}

    for t_code, t_info in targets_data.items():
        deployed[t_code] = {
            "selected_model": t_info.get("selected_model"),
            "calibration": t_info.get("calibration"),
            "metrics": t_info.get("final_deployed_model_metrics"),
            "prevalence": t_info.get("prevalence"),
            "operating_threshold": t_info.get("thresholds", {}).get("selected_threshold"),
        }
        candidates[t_code] = t_info.get("candidate_models")
        clinical_baseline[t_code] = t_info.get("baselines", {}).get("clinical_subset_lr")

    disclosures = {
        "fixed_hyperparameters": "All hyperparameters fixed a priori except ElasticNet.",
        "optimism_source": "Candidate selection and decision thresholds tuned on pooled out-of-fold cross-validation.",
        "statistical_tie": "LCX and RCA winners are statistically tied with 6-feature clinical baseline.",
        "single_center_cohort": "Z-Alizadeh Sani cohort (N=303) is a single-center tertiary cardiovascular registry.",
        "rwma_semantics": "Region RWMA is an ordinal segmental count code (0 to 4); no specific anatomical vessel territory is inferred.",
        "explainability": "SHAP reflects model-learned statistical associations, not biological causation.",
    }

    return MetricsResponse(
        deployed_models=deployed,
        candidate_comparison=candidates,
        clinical_baseline_comparison=clinical_baseline,
        nested_tuning_config=metrics_data.get("nested_tuning_config", {}),
        disclosures=disclosures,
    )


@app.get("/patients/samples", response_model=list[SamplePatient])
def get_sample_patients() -> list[SamplePatient]:
    """Return 6 real de-identified patient feature records from dataset (2 low, 2 moderate, 2 high risk)."""
    if not STATE["sample_patients"]:
        raise HTTPException(status_code=503, detail="Sample patients not loaded.")
    return cast(list[SamplePatient], STATE["sample_patients"])
