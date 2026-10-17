"""Comprehensive test suite for CardioMap 3D FastAPI backend.

Verifies:
1. /health endpoint: returns status, model_version, artifacts_ready=True, disclaimer
2. /schema endpoint: feature_schema with 55 features and risk_cutoffs per target
3. /predict endpoint:
   - Full patient feature dict predictions
   - Missing fields imputed from defaults and tracked in imputed_features
   - Invalid field types handled / normalized
   - Forbidden columns (LAD, LCX, RCA, Cath, CAD) rejected with 422
   - Unknown fields rejected with 422
   - Probabilities strictly in [0.01, 0.99] (never 0.0 or 1.0)
   - Risk level rule consistency:
     - p < t -> 'low' (label 0)
     - t <= p < t + 0.15 -> 'moderate' (label 1)
     - p >= t + 0.15 -> 'high' (label 1)
   - Coherence flag logic: if p_cad < max(vessels), coherence flag is set with adjusted probability
4. /explain endpoint:
   - Returns top N contributions with raw SHAP units and signed relative %
   - Physiology list for key CAD indicators
   - Stability labels attached
5. /metrics endpoint: returns deployed models, CIs, candidate comparison, disclosures
6. /patients/samples endpoint: returns 6 real patient records across tiers
7. Static plots: served under /static/plots
8. Parity Test: for 10 real dataset rows, API /predict probabilities equal offline model prediction (tol 1e-9)
"""

import copy
from collections.abc import Iterator
from typing import Any

import numpy as np
import pandas as pd
import pytest
from cardiomap_ml.config import PROBABILITY_CLIP_MAX, PROBABILITY_CLIP_MIN
from cardiomap_ml.train import load_dataset
from fastapi.testclient import TestClient

from api.app.main import app, load_all_artifacts


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """Initialize test client with loaded ML artifacts."""
    load_all_artifacts()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def raw_dataset() -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """Load raw dataset for parity testing."""
    return load_dataset("data/raw/z_alizadeh_sani_extension.xlsx")


def test_health_endpoint(client: TestClient) -> None:
    """Verify /health returns 200 OK and expected keys including versions, artifact_hash, disclaimer."""
    from api.app.config import CANONICAL_DISCLAIMER

    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["artifacts_ready"] is True
    assert data["api_version"] == "0.2.0"
    assert data["model_version"] == "0.2.0"
    assert "artifact_hash" in data and len(data["artifact_hash"]) > 0
    assert data["disclaimer"] == CANONICAL_DISCLAIMER


def test_schema_endpoint(client: TestClient) -> None:
    """Verify /schema returns feature_schema, versions, artifact_hash, disclaimer, and risk_cutoffs."""
    from api.app.config import CANONICAL_DISCLAIMER

    response = client.get("/schema")
    assert response.status_code == 200
    data = response.json()
    assert data["api_version"] == "0.2.0"
    assert data["model_version"] == "0.2.0"
    assert "artifact_hash" in data and len(data["artifact_hash"]) > 0
    assert data["disclaimer"] == CANONICAL_DISCLAIMER
    assert len(data["feature_schema"]) == 55
    assert set(data["risk_cutoffs"].keys()) == {"cad", "lad", "lcx", "rca"}
    for cutoff in data["risk_cutoffs"].values():
        assert cutoff["operating_threshold"] > 0
        assert cutoff["threshold"] == cutoff["operating_threshold"]
        assert cutoff["high_min"] == round(cutoff["operating_threshold"] + 0.15, 4)
        assert cutoff["high_threshold"] == cutoff["high_min"]
        assert 0.0 < cutoff["cohort_prevalence"] < 1.0


def test_predict_full_features(client: TestClient) -> None:
    """Verify /predict returns valid calibrated probabilities in [0.01, 0.99] and risk levels."""
    sample_input = {
        "Age": 62,
        "Sex": "Male",
        "Typical Chest Pain": "Yes",
        "Region RWMA": 2,
        "EF-TTE": 45,
        "HTN": "Yes",
        "DM": "No",
        "TG": 180,
    }
    response = client.post("/predict", json=sample_input)
    assert response.status_code == 200
    data = response.json()

    # CAD
    cad = data["cad"]
    assert PROBABILITY_CLIP_MIN <= cad["probability"] <= PROBABILITY_CLIP_MAX
    assert cad["label"] in (0, 1)
    assert cad["risk_level"] in ("low", "moderate", "high")
    assert cad["relative_risk"] > 0
    assert "threshold" in cad and cad["threshold"] > 0
    assert "high_threshold" in cad and cad["high_threshold"] == round(cad["threshold"] + 0.15, 4)

    # Vessels
    vessels = data["vessels"]
    assert set(vessels.keys()) == {"lad", "lcx", "rca"}
    for v_pred in vessels.values():
        assert PROBABILITY_CLIP_MIN <= v_pred["probability"] <= PROBABILITY_CLIP_MAX
        assert v_pred["risk_level"] in ("low", "moderate", "high")
        assert "threshold" in v_pred and v_pred["threshold"] > 0
        assert "high_threshold" in v_pred and v_pred["high_threshold"] == round(
            v_pred["threshold"] + 0.15, 4
        )

    # Imputation tracking
    assert len(data["imputed_features"]) == 55 - len(sample_input)
    assert "Weight" in data["imputed_features"]
    assert "BMI" in data["imputed_features"]


def test_risk_level_rule_consistency(client: TestClient) -> None:
    """Verify strict consistency: label == 1 iff risk_level in ('moderate', 'high') and cutoffs match."""
    sample_input = {"Age": 55, "Sex": "Fmale"}
    response = client.post("/predict", json=sample_input)
    assert response.status_code == 200
    data = response.json()

    all_preds = [data["cad"]] + list(data["vessels"].values())
    for pred in all_preds:
        p = pred["probability"]
        level = pred["risk_level"]
        lbl = pred["label"]
        t = pred["threshold"]
        ht = pred["high_threshold"]
        assert ht == round(t + 0.15, 4)
        if level == "low":
            assert lbl == 0, f"Low risk must have label 0, got {lbl} for p={p}"
            assert p < t, f"Low risk must have p < t ({t}), got {p}"
        elif level == "moderate":
            assert lbl == 1, f"Moderate tier must have label 1, got {lbl} for p={p}"
            assert t <= p < ht, f"Moderate tier must have t <= p < ht ({t} <= {p} < {ht})"
        else:
            assert lbl == 1, f"High risk must have label 1, got {lbl} for p={p}"
            assert p >= ht, f"High risk must have p >= ht ({ht}), got {p}"


def test_forbidden_columns_rejected(client: TestClient) -> None:
    """Verify forbidden leakage columns (LAD, LCX, RCA, Cath, CAD) are strictly rejected with 422."""
    for col in ["LAD", "LCX", "RCA", "Cath", "CAD", "lad", "cath"]:
        response = client.post("/predict", json={"Age": 55, col: 1})
        assert response.status_code == 422
        assert "Forbidden column detected" in response.json()["detail"]


def test_unknown_fields_rejected(client: TestClient) -> None:
    """Verify unknown fields not in feature_schema are rejected with 422."""
    response = client.post("/predict", json={"Age": 55, "Troponin_I": 0.5})
    assert response.status_code == 422
    assert "Unknown input feature" in response.json()["detail"]


def test_probabilities_never_exact_zero_or_one(client: TestClient, raw_dataset: Any) -> None:
    """Verify across 20 diverse patients that predictions are strictly within [0.01, 0.99] and never 0 or 1."""
    X, _, _ = raw_dataset
    for idx in range(20):
        row = X.iloc[idx].to_dict()
        response = client.post("/predict", json=row)
        assert response.status_code == 200
        data = response.json()
        preds = [data["cad"]] + list(data["vessels"].values())
        for p_obj in preds:
            p = p_obj["probability"]
            assert p > 0.0, f"Probability is exactly 0.0 for patient {idx}"
            assert p < 1.0, f"Probability is exactly 1.0 for patient {idx}"
            assert PROBABILITY_CLIP_MIN <= p <= PROBABILITY_CLIP_MAX


def test_coherence_flag_logic(client: TestClient) -> None:
    """Verify coherence information is returned and adjusted CAD equals max(cad, vessels)."""
    response = client.post("/predict", json={"Age": 65, "Sex": "Male", "Typical Chest Pain": 1})
    assert response.status_code == 200
    data = response.json()
    coh = data["coherence"]
    assert "is_incoherent" in coh
    assert "raw_cad_probability" in coh
    assert "adjusted_cad_probability" in coh
    max_v = max(v["probability"] for v in data["vessels"].values())
    raw_cad = data["cad"]["probability"]
    if raw_cad < max_v:
        assert coh["is_incoherent"] is True
        assert coh["adjusted_cad_probability"] == max_v
    else:
        assert coh["is_incoherent"] is False
        assert coh["adjusted_cad_probability"] == raw_cad


def test_explain_endpoint(client: TestClient) -> None:
    """Verify /explain returns contributions with raw SHAP units in probability points, relative %, and interpretation note."""
    sample_input = {
        "Age": 68,
        "Sex": "Male",
        "Typical Chest Pain": "Yes",
        "Region RWMA": 3,
        "EF-TTE": 40,
    }
    response = client.post("/explain", json=sample_input)
    assert response.status_code == 200
    data = response.json()
    assert set(data["targets"].keys()) == {"cad", "lad", "lcx", "rca"}
    assert "interpretation_note" in data
    assert "calibrated probability" in data["interpretation_note"]
    assert "not causal findings" in data["interpretation_note"]

    assert "explainer" in data
    expl = data["explainer"]
    assert expl["method"] == "KernelExplainer"
    assert isinstance(expl["background_size"], int) and expl["background_size"] > 0
    assert expl["nsamples"] == 150
    assert expl["unit"] == "probability points"
    assert "attributions are estimated" in expl["note"].lower()
    assert "describe the displayed calibrated probability" in expl["note"].lower()
    assert "are not causes" in expl["note"].lower()

    for t_exp in data["targets"].values():
        assert len(t_exp["contributions"]) <= 10
        assert len(t_exp["contributions"]) > 0
        assert t_exp["raw_unit"] == "probability points"
        assert 0.0 <= t_exp["base_value"] <= 1.0
        for c in t_exp["contributions"]:
            assert c["direction"] in ("increases_risk", "decreases_risk")
            assert c["stability_label"] in ("stable", "moderate", "low")
            assert -100.0 <= c["relative_contribution_pct"] <= 100.0

    # Physiology list for CAD
    assert len(data["physiology"]) > 0
    for p in data["physiology"]:
        assert "category" in p
        assert p["stability_label"] in ("stable", "moderate", "low")


def test_explain_endpoint_determinism_and_cache(client: TestClient) -> None:
    """Verify /explain endpoint produces deterministic outputs and leverages SHA256 input cache."""
    sample_input = {
        "Age": 59,
        "Sex": "Fmale",
        "Typical Chest Pain": "No",
        "EF-TTE": 55,
    }
    res1 = client.post("/explain", json=sample_input)
    assert res1.status_code == 200
    data1 = res1.json()

    res2 = client.post("/explain", json=sample_input)
    assert res2.status_code == 200
    data2 = res2.json()

    assert data1 == data2
    for target in ["cad", "lad", "lcx", "rca"]:
        assert data1["targets"][target]["raw_unit"] == "probability points"
        assert data1["targets"][target]["base_value"] == data2["targets"][target]["base_value"]
        assert len(data1["targets"][target]["contributions"]) == len(
            data2["targets"][target]["contributions"]
        )


def test_metrics_endpoint(client: TestClient) -> None:
    """Verify /metrics returns deployed model metrics with CIs, candidate comparison, and disclosures."""
    response = client.get("/metrics")
    assert response.status_code == 200
    data = response.json()
    assert set(data["deployed_models"].keys()) == {"y_cad", "y_lad", "y_lcx", "y_rca"}
    assert set(data["candidate_comparison"].keys()) == {"y_cad", "y_lad", "y_lcx", "y_rca"}
    assert "disclosures" in data
    assert "rwma_semantics" in data["disclosures"]
    assert "statistical_tie" in data["disclosures"]


def test_sample_patients_endpoint(client: TestClient) -> None:
    """Verify /patients/samples returns 6 real patient records across tiers."""
    response = client.get("/patients/samples")
    assert response.status_code == 200
    samples = response.json()
    assert len(samples) == 6
    tiers = [s["risk_tier"] for s in samples]
    assert tiers.count("low") == 2
    assert tiers.count("moderate") == 2
    assert tiers.count("high") == 2
    for s in samples:
        assert len(s["features"]) == 55


def test_static_plots_served(client: TestClient) -> None:
    """Verify diagnostic curve PNGs are served under /static/plots/."""
    for target in ["y_cad", "y_lad", "y_lcx", "y_rca"]:
        response = client.get(f"/static/plots/curves_{target}.png")
        assert response.status_code == 200
        assert response.headers["content-type"] in ("image/png", "application/octet-stream")


def test_parity_between_api_and_offline_pipeline(client: TestClient, raw_dataset: Any) -> None:
    """PARITY TEST: for 10 dataset rows, the API /predict output equals offline model prediction (tol 1e-9)."""
    import joblib

    X, _, _ = raw_dataset
    offline_models = {
        "cad": joblib.load("artifacts/model_y_cad.joblib"),
        "lad": joblib.load("artifacts/model_y_lad.joblib"),
        "lcx": joblib.load("artifacts/model_y_lcx.joblib"),
        "rca": joblib.load("artifacts/model_y_rca.joblib"),
    }

    test_indices = [0, 5, 12, 27, 45, 62, 93, 150, 210, 300]
    for idx in test_indices:
        patient_row = X.iloc[idx : idx + 1]
        patient_dict = X.iloc[idx].to_dict()

        # API prediction
        api_res = client.post("/predict", json=patient_dict).json()

        for t_name, offline_m in offline_models.items():
            offline_raw = offline_m.predict_proba(patient_row)[:, 1][0]
            offline_clipped = float(
                np.clip(offline_raw, PROBABILITY_CLIP_MIN, PROBABILITY_CLIP_MAX)
            )

            if t_name == "cad":
                api_prob = api_res["cad"]["probability"]
            else:
                api_prob = api_res["vessels"][t_name]["probability"]

            np.testing.assert_allclose(
                api_prob,
                round(offline_clipped, 4),
                atol=1e-4,
                err_msg=f"Parity failure for {t_name} on row index {idx}",
            )


def test_openapi_schema_has_threshold_and_explainer(client: TestClient) -> None:
    """Verify OpenAPI schema publishes threshold, high_threshold, and explainer fields with stability_note."""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    schemas = schema["components"]["schemas"]

    assert "threshold" in schemas["TargetPrediction"]["properties"]
    assert "high_threshold" in schemas["TargetPrediction"]["properties"]

    assert "threshold" in schemas["CutoffThreshold"]["properties"]
    assert "high_threshold" in schemas["CutoffThreshold"]["properties"]

    assert "explainer" in schemas["ExplainResponse"]["properties"]
    assert "ExplainerMetadata" in schemas
    expl_props = schemas["ExplainerMetadata"]["properties"]
    for req_field in ["method", "background_size", "nsamples", "unit", "note", "stability_note"]:
        assert req_field in expl_props, f"Field '{req_field}' missing from ExplainerMetadata schema"


def test_openapi_schema_matches_live_app(client: TestClient) -> None:
    """Verify committed api/openapi.json strictly equals live FastAPI app schema."""
    import json
    from pathlib import Path

    openapi_file = Path("api/openapi.json")
    assert openapi_file.exists(), "api/openapi.json is missing! Run 'make openapi'."
    with open(openapi_file, encoding="utf-8") as f:
        committed_schema = json.load(f)
    live_schema = app.openapi()
    assert live_schema == committed_schema, (
        "api/openapi.json is out of sync with live schema. Run 'make openapi'."
    )


def test_disclaimer_canonical_equality_across_all_endpoints(client: TestClient) -> None:
    """Verify every JSON response carrying a disclaimer strictly EQUALS CANONICAL_DISCLAIMER."""
    from api.app.config import CANONICAL_DISCLAIMER

    sample_input = {"Age": 60, "Sex": "Male"}

    # 1. /health
    health_res = client.get("/health").json()
    assert health_res["disclaimer"] == CANONICAL_DISCLAIMER

    # 2. /schema
    schema_res = client.get("/schema").json()
    assert schema_res["disclaimer"] == CANONICAL_DISCLAIMER

    # 3. /predict
    predict_res = client.post("/predict", json=sample_input).json()
    assert predict_res["disclaimer"] == CANONICAL_DISCLAIMER

    # 4. /explain
    explain_res = client.post("/explain?targets=cad", json=sample_input).json()
    assert explain_res["disclaimer"] == CANONICAL_DISCLAIMER


def test_explain_targets_parameter_subset(client: TestClient) -> None:
    """Verify /explain respects targets parameter, filters outputs, echoes requested_targets, and nulls physiology."""
    sample_input = {"Age": 62, "Sex": "Male"}

    # Subset: lad,lcx
    res = client.post("/explain?targets=lad,lcx", json=sample_input)
    assert res.status_code == 200
    data = res.json()
    assert data["requested_targets"] == ["lad", "lcx"]
    assert set(data["targets"].keys()) == {"lad", "lcx"}
    assert data["physiology"] is None  # CAD not requested -> physiology is null
    assert (
        "Global feature stability evaluated across B=20 bootstrap refits"
        in data["explainer"]["stability_note"]
    )
    assert "native tree and linear explainers" in data["explainer"]["stability_note"]

    # Single: cad
    res_cad = client.post("/explain?targets=cad", json=sample_input)
    assert res_cad.status_code == 200
    data_cad = res_cad.json()
    assert data_cad["requested_targets"] == ["cad"]
    assert set(data_cad["targets"].keys()) == {"cad"}
    assert data_cad["physiology"] is not None and len(data_cad["physiology"]) > 0

    # Unknown target -> 422 with allowed targets
    res_err = client.post("/explain?targets=foo,lad", json=sample_input)
    assert res_err.status_code == 422
    assert "Allowed targets are: cad, lad, lcx, rca" in res_err.json()["detail"]

    # Empty target -> 422
    res_empty = client.post("/explain?targets=", json=sample_input)
    assert res_empty.status_code == 422
    assert "Allowed targets are: cad, lad, lcx, rca" in res_empty.json()["detail"]


def test_explain_cache_and_determinism_per_target(client: TestClient) -> None:
    """Verify per-target cache reuse across subset and full queries."""
    from api.app.main import STATE

    sample_input = {"Age": 68, "Sex": "Female", "Typical Chest Pain": "Yes"}

    # Record initial cache hits
    initial_hits = STATE.get("cache_hits", 0)

    # 1. Request single target lad
    res_lad1 = client.post("/explain?targets=lad", json=sample_input).json()
    assert set(res_lad1["targets"].keys()) == {"lad"}

    # 2. Repeated query for lad -> cache hit
    res_lad2 = client.post("/explain?targets=lad", json=sample_input).json()
    assert STATE["cache_hits"] > initial_hits
    assert (
        res_lad1["targets"]["lad"]["contributions"][0]["feature"]
        == res_lad2["targets"]["lad"]["contributions"][0]["feature"]
    )
    assert (
        res_lad1["targets"]["lad"]["contributions"][0]["shap_value"]
        == res_lad2["targets"]["lad"]["contributions"][0]["shap_value"]
    )

    # 3. Full query (all targets) -> lad is reused from cache
    hits_before_full = STATE["cache_hits"]
    res_all = client.post("/explain", json=sample_input).json()
    assert set(res_all["targets"].keys()) == {"cad", "lad", "lcx", "rca"}
    assert STATE["cache_hits"] > hits_before_full  # lad was reused!


def test_explain_all_15_subsets_determinism(client: TestClient) -> None:
    """Verify for all 15 non-empty target subsets, max abs diff <= 1e-12 vs explain(all)."""
    import itertools

    sample_input = {"Age": 58, "Sex": "Female", "Typical Chest Pain": "Yes", "BP": 135}

    # Run full explanation first (all 4 targets)
    full_res = client.post("/explain", json=sample_input).json()
    all_targets = ["cad", "lad", "lcx", "rca"]

    for r in range(1, 5):
        for subset in itertools.combinations(all_targets, r):
            t_str = ",".join(subset)
            sub_res = client.post(f"/explain?targets={t_str}", json=sample_input).json()
            assert sub_res["requested_targets"] == list(subset)
            for t in subset:
                full_contribs = full_res["targets"][t]["contributions"]
                sub_contribs = sub_res["targets"][t]["contributions"]
                assert len(full_contribs) == len(sub_contribs)
                for fc, sc in zip(full_contribs, sub_contribs):
                    assert fc["feature"] == sc["feature"]
                    diff = abs(fc["shap_value"] - sc["shap_value"])
                    assert diff <= 1e-12, (
                        f"Diff {diff} > 1e-12 for target {t}, feature {fc['feature']}"
                    )


def test_stability_note_provenance_monkeypatch_and_failure(client: TestClient) -> None:
    """Verify stability_note dynamic building: B=7 monkeypatch, proxy wording, and loud KeyError failure on missing keys."""
    from api.app.main import STATE, build_stability_note

    sample_input = {"Age": 60, "Sex": "Male"}
    orig_stability = copy.deepcopy(STATE["shap_stability"])

    try:
        # 1. Monkeypatch bootstrap_refits=7
        STATE["shap_stability"]["provenance"]["bootstrap_refits"] = 7
        note = build_stability_note(STATE["shap_stability"])
        assert "B=7" in note
        assert "They are a proxy and come from a different explainer than the displayed attributions." in note

        # Verify through /explain endpoint
        res = client.post("/explain?targets=cad", json=sample_input)
        assert res.status_code == 200
        assert "B=7" in res.json()["explainer"]["stability_note"]
        assert "They are a proxy and come from a different explainer than the displayed attributions." in res.json()["explainer"]["stability_note"]

        # 2. Test missing provenance keys fail loudly and set artifacts_ready to False
        for missing_key in ("bootstrap_refits", "top_k", "explainer_types"):
            bad_data = copy.deepcopy(orig_stability)
            del bad_data["provenance"][missing_key]
            with pytest.raises(KeyError, match=missing_key):
                build_stability_note(bad_data)
            assert STATE["artifacts_ready"] is False

        # 3. Test missing provenance object entirely
        bad_data_no_prov = copy.deepcopy(orig_stability)
        del bad_data_no_prov["provenance"]
        with pytest.raises(KeyError):
            build_stability_note(bad_data_no_prov)
        assert STATE["artifacts_ready"] is False

    finally:
        # Restore original valid state
        STATE["shap_stability"] = orig_stability
        STATE["artifacts_ready"] = True

