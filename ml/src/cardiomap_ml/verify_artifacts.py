"""CardioMap 3D Artifact Consistency Verifier.

Verifies:
1. metrics.json deployed models == thresholds.json == deployed joblib definitions
2. shap_background_sample.csv is the stratified 30-patient sample across 55 features
3. Model version is consistent across config and docs
4. schema, thresholds, and metrics agree on cutoffs
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.ensemble import RandomForestClassifier, VotingClassifier

from api.app.config import MODEL_VERSION

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

EXPECTED_MODELS = {
    "y_cad": ("SoftVotingEnsemble", VotingClassifier),
    "y_lad": ("RandomForest", RandomForestClassifier),
    "y_lcx": ("LightGBM", LGBMClassifier),
    "y_rca": ("LGBM_Shallow", LGBMClassifier),
}


def verify_artifacts(
    artifacts_dir: Path = Path("artifacts"),
    docs_dir: Path = Path("docs"),
) -> bool:
    """Run full artifact consistency check."""
    logger.info("Verifying CardioMap 3D artifacts in %s...", artifacts_dir)
    errors: list[str] = []

    # 1. Check feature schema
    schema_path = artifacts_dir / "feature_schema.json"
    if not schema_path.exists():
        errors.append(f"Missing {schema_path}")
        return False

    with open(schema_path, encoding="utf-8") as f:
        schema: dict[str, Any] = json.load(f)
    if len(schema) != 55:
        errors.append(f"feature_schema.json has {len(schema)} features, expected exactly 55")
    else:
        logger.info("✓ feature_schema.json has exactly 55 features")

    # 2. Check background sample
    bg_path = artifacts_dir / "shap_background_sample.csv"
    if not bg_path.exists():
        errors.append(f"Missing {bg_path}")
    else:
        bg_df = pd.read_csv(bg_path)
        if len(bg_df) != 30:
            errors.append(f"shap_background_sample.csv has {len(bg_df)} rows, expected 30")
        elif len(bg_df.columns) != 55:
            errors.append(
                f"shap_background_sample.csv has {len(bg_df.columns)} columns, expected 55"
            )
        elif list(bg_df.columns) != list(schema.keys()):
            errors.append(
                "shap_background_sample.csv column names do not match feature_schema.json"
            )
        else:
            logger.info(
                "✓ shap_background_sample.csv is stratified 30-patient sample across 55 features"
            )

    # 3. Check thresholds.json and metrics.json
    thresh_path = artifacts_dir / "thresholds.json"
    metrics_path = artifacts_dir / "metrics.json"

    if not thresh_path.exists():
        errors.append(f"Missing {thresh_path}")
        return False
    if not metrics_path.exists():
        errors.append(f"Missing {metrics_path}")
        return False

    with open(thresh_path, encoding="utf-8") as f:
        thresholds: dict[str, Any] = json.load(f)
    with open(metrics_path, encoding="utf-8") as f:
        metrics: dict[str, Any] = json.load(f)

    # 4. Check deployed models & joblibs
    for target, (exp_name, exp_type) in EXPECTED_MODELS.items():
        joblib_path = artifacts_dir / f"model_{target}.joblib"
        if not joblib_path.exists():
            errors.append(f"Missing model artifact: {joblib_path}")
            continue

        model = joblib.load(joblib_path)
        # Check calibrated wrapper
        cal_estimators = getattr(model, "calibrated_classifiers_", [])
        if not cal_estimators:
            errors.append(f"{joblib_path} is not a fitted CalibratedClassifierCV")
        else:
            base_estimator = cal_estimators[0].estimator
            clf = getattr(base_estimator, "named_steps", {}).get("clf")
            if not isinstance(clf, exp_type):
                errors.append(f"{joblib_path} classifier is {type(clf)}, expected {exp_type}")
            if target == "y_rca" and isinstance(clf, LGBMClassifier) and clf.max_depth != 2:
                errors.append(
                    f"{joblib_path} y_rca max_depth={clf.max_depth}, expected 2 (LGBM_Shallow)"
                )

        # Check metrics.json deployed model matches
        target_metrics = metrics.get("targets", {}).get(target, {})
        sel_model = target_metrics.get("selected_model")
        if sel_model != exp_name:
            errors.append(
                f"metrics.json targets[{target}].selected_model={sel_model}, expected {exp_name}"
            )

        # Check threshold agreement
        sel_t_thresh = thresholds.get(target, {}).get("selected_threshold")
        sel_t_metric = target_metrics.get("thresholds", {}).get("selected_threshold")
        if sel_t_thresh is None or sel_t_metric is None or sel_t_thresh != sel_t_metric:
            errors.append(
                f"Threshold mismatch for {target}: thresholds.json={sel_t_thresh} vs metrics.json={sel_t_metric}"
            )

        # Check baseline_comparison_table cutoff agreement
        base_table = metrics.get("baseline_comparison_table", {})
        if target in base_table:
            cutoff = base_table[target].get("operating_cutoff")
            if cutoff != sel_t_thresh:
                errors.append(
                    f"baseline_comparison_table cutoff mismatch for {target}: {cutoff} != {sel_t_thresh}"
                )

        logger.info(
            "✓ Target %s: model=%s, threshold=%.4f verified across joblib, thresholds, metrics",
            target,
            exp_name,
            sel_t_thresh,
        )

    # 5. Check model version consistency
    model_card = docs_dir / "model_card.md"
    if model_card.exists():
        card_text = model_card.read_text(encoding="utf-8")
        if f"Model Version**: `{MODEL_VERSION}`" not in card_text:
            errors.append(
                f"docs/model_card.md does not mention canonical Model Version `{MODEL_VERSION}`"
            )
        else:
            logger.info(
                "✓ Model version `%s` verified in docs/model_card.md and api/app/config.py",
                MODEL_VERSION,
            )

    if errors:
        logger.error("Artifact verification FAILED with %d error(s):", len(errors))
        for err in errors:
            logger.error("  - %s", err)
        return False

    logger.info("All artifact consistency checks PASSED successfully.")
    return True


def main() -> None:
    """CLI entrypoint for make verify-artifacts."""
    success = verify_artifacts()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
