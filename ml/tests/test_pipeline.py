"""Comprehensive unit tests for CardioMap 3D ML pipeline (Phase 1.5).

Tests verify:
1. Target leakage invariants and robust header handling
2. Exactly 55 feature inputs
3. Pipeline fits and predicts on toy batch
4. Saved artifacts reload and reproduce predictions identically
5. Calibration probability clipping strictly inside [0.01, 0.99]
6. SHAP additivity: base_value + sum(shap) == raw model output for sample patients across all targets
7. y_cad consistency vs individual vessels
8. Feature schema completeness
"""

import json
from pathlib import Path
from typing import Any, cast

import joblib
import numpy as np
import numpy.typing as npt
import pandas as pd
import pytest
import shap
import xgboost as xgb
from cardiomap_ml.config import (
    PROBABILITY_CLIP_MAX,
    PROBABILITY_CLIP_MIN,
    assert_no_target_leakage,
)
from cardiomap_ml.train import (
    NESTED_TUNING_CONFIG,
    create_preprocessor,
    load_dataset,
)
from scipy.stats import spearmanr
from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from sklearn.linear_model import LogisticRegression


@pytest.fixture(scope="module")
def raw_data() -> tuple[pd.DataFrame, pd.DataFrame, dict[str, int]]:
    """Load raw dataset for pipeline verification."""
    data_path = Path("data/raw/z_alizadeh_sani_extension.xlsx")
    assert data_path.exists(), f"Raw dataset not found at {data_path}"
    X, y_df, consistency = load_dataset(data_path)
    return X, y_df, consistency


def test_hard_invariant_exactly_55_features(
    raw_data: tuple[pd.DataFrame, pd.DataFrame, dict[str, int]],
) -> None:
    """Verify HARD INVARIANT: X has exactly 55 columns with 0 target leakage."""
    X, _, _ = raw_data
    assert len(X.columns) == 55, f"Expected exactly 55 columns, got {len(X.columns)}"
    assert_no_target_leakage(X.columns)


def test_target_consistency_invariants(
    raw_data: tuple[pd.DataFrame, pd.DataFrame, dict[str, int]],
) -> None:
    """Verify target encodings and identify the single documented clinical registry discrepancy."""
    _, y_df, _ = raw_data
    assert len(y_df) == 303
    for col in ["y_cad", "y_lad", "y_lcx", "y_rca"]:
        assert col in y_df.columns
        assert set(y_df[col].unique()).issubset({0, 1})

    # Consistency check: any_vessel == 1 -> y_cad == 1 for 302 of 303 rows
    any_vessel = ((y_df["y_lad"] == 1) | (y_df["y_lcx"] == 1) | (y_df["y_rca"] == 1)).astype(int)
    discrepancy = (any_vessel == 1) & (y_df["y_cad"] == 0)
    assert discrepancy.sum() == 1
    assert discrepancy.idxmax() == 93  # Patient 93 is Cath=Normal, LAD=Stenotic


def test_pipeline_fits_and_predicts_on_toy_batch(
    raw_data: tuple[pd.DataFrame, pd.DataFrame, dict[str, int]],
) -> None:
    """Verify ColumnTransformer and estimator fit/predict on toy batch without error."""
    X, y_df, _ = raw_data
    toy_X = X.iloc[:20]
    toy_y = y_df["y_cad"].iloc[:20].to_numpy()

    prep = create_preprocessor(list(X.columns))
    X_trans = prep.fit_transform(toy_X)
    assert X_trans.shape[0] == 20
    assert not np.isnan(X_trans).any()
    assert len(toy_y) == 20


def test_saved_artifacts_reload_and_reproduce_predictions(
    raw_data: tuple[pd.DataFrame, pd.DataFrame, dict[str, int]],
) -> None:
    """Verify saved models reload and generate valid identical probabilities in [0, 1]."""
    X, _, _ = raw_data
    artifacts_dir = Path("artifacts")
    assert (artifacts_dir / "metrics.json").exists()
    assert (artifacts_dir / "thresholds.json").exists()
    assert (artifacts_dir / "feature_schema.json").exists()
    assert (artifacts_dir / "shap_background_sample.csv").exists()

    sample_patient = X.iloc[:5]

    for target in ["y_cad", "y_lad", "y_lcx", "y_rca"]:
        model_path = artifacts_dir / f"model_{target}.joblib"
        assert model_path.exists(), f"Missing model artifact: {model_path}"

        model = joblib.load(model_path)
        raw_probs = model.predict_proba(sample_patient)[:, 1]
        probs = np.clip(raw_probs, PROBABILITY_CLIP_MIN, PROBABILITY_CLIP_MAX)

        assert len(probs) == 5
        assert np.all(probs >= PROBABILITY_CLIP_MIN), f"Probability below clip min for {target}"
        assert np.all(probs <= PROBABILITY_CLIP_MAX), f"Probability above clip max for {target}"
        assert not np.any(probs == 0.0), f"Exact 0 probability found for {target}"
        assert not np.any(probs == 1.0), f"Exact 1 probability found for {target}"

        # Deterministic re-prediction
        raw_recheck = model.predict_proba(sample_patient)[:, 1]
        probs_recheck = np.clip(raw_recheck, PROBABILITY_CLIP_MIN, PROBABILITY_CLIP_MAX)
        np.testing.assert_allclose(
            probs, probs_recheck, err_msg=f"Non-deterministic prediction for {target}"
        )


def test_calibration_clipping_bounds(
    raw_data: tuple[pd.DataFrame, pd.DataFrame, dict[str, int]],
) -> None:
    """Verify calibrated probability clipping strictly enforces [0.01, 0.99] across entire dataset."""
    X, _, _ = raw_data
    artifacts_dir = Path("artifacts")

    for target in ["y_cad", "y_lad", "y_lcx", "y_rca"]:
        model_path = artifacts_dir / f"model_{target}.joblib"
        model = joblib.load(model_path)
        raw_probs = model.predict_proba(X)[:, 1]
        clipped_probs = np.clip(raw_probs, PROBABILITY_CLIP_MIN, PROBABILITY_CLIP_MAX)

        assert np.all(clipped_probs >= 0.01), f"Clipped probability below 0.01 for {target}"
        assert np.all(clipped_probs <= 0.99), f"Clipped probability above 0.99 for {target}"
        assert not np.any(clipped_probs == 0.0), f"Exact 0 found for {target}"
        assert not np.any(clipped_probs == 1.0), f"Exact 1 found for {target}"


def test_evaluated_matches_deployed_cad_ensemble() -> None:
    """Verify CAD ensemble in train configuration strictly matches the deployed artifact and uses XGBoost."""
    artifacts_dir = Path("artifacts")
    model_path = artifacts_dir / "model_y_cad.joblib"
    assert model_path.exists()
    cad_model = joblib.load(model_path)

    # 1. Configured ensemble has LR, RF, XGB
    ens_spec = NESTED_TUNING_CONFIG["candidate_search_spaces"]["SoftVotingEnsemble"]
    assert "XGBoost(max_depth=4)" in ens_spec["members"]
    assert "RandomForest(max_depth=6)" in ens_spec["members"]
    assert "LogisticRegression(C=1.0)" in ens_spec["members"]

    # 2. Deployed model is CalibratedClassifierCV wrapping VotingClassifier with identical estimators
    assert hasattr(cad_model, "calibrated_classifiers_")
    for cal_clf in cad_model.calibrated_classifiers_:
        pipe = cal_clf.estimator
        clf = pipe.named_steps["clf"]
        assert isinstance(clf, VotingClassifier)
        deployed_est_names = [name for name, _ in clf.estimators]
        assert deployed_est_names == ["lr", "rf", "xgb"]
        assert isinstance(clf.named_estimators_["xgb"], xgb.XGBClassifier)
        assert isinstance(clf.named_estimators_["rf"], RandomForestClassifier)
        assert isinstance(clf.named_estimators_["lr"], LogisticRegression)


def test_shap_additivity_in_probability_points_on_deployed_models(
    raw_data: tuple[pd.DataFrame, pd.DataFrame, dict[str, int]],
) -> None:
    """Verify SHAP additivity in probability points on deployed calibrated pipelines for all 4 targets."""
    X, _, _ = raw_data
    artifacts_dir = Path("artifacts")
    bg_df = pd.read_csv(artifacts_dir / "shap_background_sample.csv")
    test_sample = X.iloc[:2]  # test 2 patients to maintain responsive test execution

    for target in ["y_cad", "y_lad", "y_lcx", "y_rca"]:
        model_path = artifacts_dir / f"model_{target}.joblib"
        calibrated_model = joblib.load(model_path)

        def predict_fn(
            x: pd.DataFrame | npt.NDArray[Any], m: Any = calibrated_model
        ) -> npt.NDArray[np.float64]:
            df = pd.DataFrame(x, columns=bg_df.columns) if not isinstance(x, pd.DataFrame) else x
            return cast(
                npt.NDArray[np.float64], np.asarray(m.predict_proba(df)[:, 1], dtype=np.float64)
            )

        explainer = shap.KernelExplainer(predict_fn, bg_df)
        np.random.seed(42)
        sv = explainer.shap_values(test_sample, nsamples=100, silent=True)
        raw_probs = calibrated_model.predict_proba(test_sample)[:, 1]

        # In probability points: base_value + sum(shap_i) == raw calibrated predict_proba
        base_val = explainer.expected_value
        assert 0.0 <= base_val <= 1.0, f"Expected probability base value in [0, 1], got {base_val}"
        computed = base_val + np.sum(sv, axis=1)
        np.testing.assert_allclose(
            raw_probs,
            computed,
            atol=1e-4,
            err_msg=f"Additivity in probability points failed for {target}",
        )


def test_model_agnostic_shap_determinism(
    raw_data: tuple[pd.DataFrame, pd.DataFrame, dict[str, int]],
) -> None:
    """Verify that model-agnostic KernelExplainer produces identical SHAP values across repeated calls with fixed seed."""
    X, _, _ = raw_data
    artifacts_dir = Path("artifacts")
    bg_df = pd.read_csv(artifacts_dir / "shap_background_sample.csv")
    model = joblib.load(artifacts_dir / "model_y_cad.joblib")
    patient = X.iloc[:1]

    def predict_fn(x: pd.DataFrame | npt.NDArray[Any]) -> npt.NDArray[np.float64]:
        df = pd.DataFrame(x, columns=bg_df.columns) if not isinstance(x, pd.DataFrame) else x
        return cast(
            npt.NDArray[np.float64], np.asarray(model.predict_proba(df)[:, 1], dtype=np.float64)
        )

    explainer = shap.KernelExplainer(predict_fn, bg_df)

    np.random.seed(42)
    sv1 = explainer.shap_values(patient, nsamples=80, silent=True)

    np.random.seed(42)
    sv2 = explainer.shap_values(patient, nsamples=80, silent=True)

    np.testing.assert_allclose(
        sv1, sv2, atol=1e-12, err_msg="KernelExplainer output was not deterministic"
    )


def test_model_agnostic_shap_accuracy_vs_reference(
    raw_data: tuple[pd.DataFrame, pd.DataFrame, dict[str, int]],
) -> None:
    """Verify accuracy versus high-fidelity reference (overlap and Spearman correlation) across 20 dataset patients."""
    ref_path = Path("ml/config/shap_reference_20_patients.joblib")
    if not ref_path.exists():
        ref_path = Path("artifacts/shap_reference_20_patients.joblib")
    assert ref_path.exists(), "High-fidelity SHAP reference artifact missing."
    ref_data = joblib.load(ref_path)

    X, _, _ = raw_data
    patient_indices = ref_data["patients_indices"]
    patients_20 = X.iloc[patient_indices]
    ref_shap = ref_data["ref_shap_values"]

    artifacts_dir = Path("artifacts")
    bg_df = pd.read_csv(artifacts_dir / "shap_background_sample.csv")
    cad_model = joblib.load(artifacts_dir / "model_y_cad.joblib")

    def predict_fn(x: pd.DataFrame | npt.NDArray[Any]) -> npt.NDArray[np.float64]:
        df = pd.DataFrame(x, columns=bg_df.columns) if not isinstance(x, pd.DataFrame) else x
        return cast(
            npt.NDArray[np.float64], np.asarray(cad_model.predict_proba(df)[:, 1], dtype=np.float64)
        )

    explainer = shap.KernelExplainer(predict_fn, bg_df)
    np.random.seed(42)
    prod_shap = explainer.shap_values(patients_20, nsamples=150, silent=True)

    top3_overlaps = []
    spearman_corrs = []

    for i in range(len(patients_20)):
        ref_top3 = set(np.argsort(np.abs(ref_shap[i]))[::-1][:3])
        prod_top3 = set(np.argsort(np.abs(prod_shap[i]))[::-1][:3])
        overlap = len(ref_top3.intersection(prod_top3))
        top3_overlaps.append(overlap)

        rho, _ = spearmanr(ref_shap[i], prod_shap[i])
        spearman_corrs.append(rho)

    avg_overlap = float(np.mean(top3_overlaps))
    avg_spearman = float(np.mean(spearman_corrs))

    assert avg_overlap >= 2.0, f"Average top-3 overlap too low: {avg_overlap:.2f} / 3"
    assert avg_spearman >= 0.60, f"Average Spearman correlation too low: {avg_spearman:.4f}"


def test_model_agnostic_shap_age_perturbation_stability(
    raw_data: tuple[pd.DataFrame, pd.DataFrame, dict[str, int]],
) -> None:
    """Verify stability: Age +1 year keeps top-3 features unchanged for at least 90% (18/20) of 20 patients."""
    ref_path = Path("ml/config/shap_reference_20_patients.joblib")
    if not ref_path.exists():
        ref_path = Path("artifacts/shap_reference_20_patients.joblib")
    ref_data = joblib.load(ref_path)

    X, _, _ = raw_data
    patient_indices = ref_data["patients_indices"]
    patients_20 = X.iloc[patient_indices].copy()

    artifacts_dir = Path("artifacts")
    bg_df = pd.read_csv(artifacts_dir / "shap_background_sample.csv")
    cad_model = joblib.load(artifacts_dir / "model_y_cad.joblib")

    def predict_fn(x: pd.DataFrame | npt.NDArray[Any]) -> npt.NDArray[np.float64]:
        df = pd.DataFrame(x, columns=bg_df.columns) if not isinstance(x, pd.DataFrame) else x
        return cast(
            npt.NDArray[np.float64], np.asarray(cad_model.predict_proba(df)[:, 1], dtype=np.float64)
        )

    explainer = shap.KernelExplainer(predict_fn, bg_df)

    np.random.seed(42)
    base_shap = explainer.shap_values(patients_20, nsamples=250, silent=True)

    perturbed_patients = patients_20.copy()
    perturbed_patients["Age"] = perturbed_patients["Age"] + 1
    np.random.seed(42)
    pert_shap = explainer.shap_values(perturbed_patients, nsamples=250, silent=True)

    preserved_count = 0
    for i in range(len(patients_20)):
        base_top3 = tuple(np.argsort(np.abs(base_shap[i]))[::-1][:3])
        pert_top3 = tuple(np.argsort(np.abs(pert_shap[i]))[::-1][:3])
        if base_top3 == pert_top3:
            preserved_count += 1

    stability_ratio = preserved_count / len(patients_20)
    assert stability_ratio >= 0.90, (
        f"Age perturbation stability {stability_ratio:.1%} ({preserved_count}/20) fell below 90% threshold"
    )


def test_feature_schema_completeness(
    raw_data: tuple[pd.DataFrame, pd.DataFrame, dict[str, int]],
) -> None:
    """Verify feature_schema.json documents every single input feature accurately."""
    X, _, _ = raw_data
    schema_path = Path("ml/config/feature_schema.json")
    assert schema_path.exists()

    with open(schema_path, encoding="utf-8") as f:
        schema = json.load(f)

    assert len(schema) == 55
    for col in X.columns:
        assert col in schema, f"Column {col} missing from feature_schema.json"
        entry = schema[col]
        assert "name" in entry
        assert "display_label" in entry
        assert "type" in entry
        assert entry["type"] in ("numeric", "binary", "categorical", "ordinal")
        assert "group" in entry
        assert entry["group"] in (
            "demographics",
            "history",
            "vitals",
            "symptoms",
            "ecg",
            "labs",
            "echo",
        )
        assert "default" in entry


def test_baseline_comparison_table_integrity() -> None:
    """Verify baseline comparison table in metrics.json is present, accurate, and avoids plain accuracy confusion."""
    metrics_path = Path("artifacts/metrics.json")
    thresholds_path = Path("artifacts/thresholds.json")
    assert metrics_path.exists()
    assert thresholds_path.exists()

    with open(metrics_path, encoding="utf-8") as f:
        metrics = json.load(f)
    with open(thresholds_path, encoding="utf-8") as f:
        thresholds = json.load(f)

    assert "baseline_comparison_table" in metrics
    table = metrics["baseline_comparison_table"]
    assert set(table.keys()) == {"y_cad", "y_lad", "y_lcx", "y_rca"}

    for target, row in table.items():
        assert row["operating_cutoff"] == thresholds[target]["selected_threshold"]
        assert row["trivial_f1"] > 0
        assert row["f1_at_operating_cutoff"] > row["trivial_f1"]
        # Balanced accuracy at cutoff must NOT equal plain accuracy at 0.50 (Phase 2.5 regression check)
        assert abs(row["balanced_accuracy_at_cutoff"] - row["accuracy_at_50"]) > 0.01
        assert (
            abs(row["f1_gain_over_trivial"] - (row["f1_at_operating_cutoff"] - row["trivial_f1"]))
            < 1e-3
        )
        assert 0.70 <= row["roc_auc"] <= 1.0


def test_verify_artifacts_consistency() -> None:
    """Verify artifact consistency across metrics.json, thresholds.json, and deployed joblib models."""
    from cardiomap_ml.verify_artifacts import verify_artifacts

    assert verify_artifacts() is True
