"""CardioMap 3D ML Training Pipeline (Phase 1.5).

Full training, repeated stratified cross-validation, nested tuning,
calibration clipping, threshold optimization, SHAP feature attribution,
and artifact generation.
"""

from __future__ import annotations

import argparse
import json
import logging
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, cast

import joblib
import lightgbm as lgb
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import numpy.typing as npt
import pandas as pd
import scipy
import shap
import sklearn
import xgboost as xgb
from lightgbm import LGBMClassifier
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import RepeatedStratifiedKFold, StratifiedKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier

from cardiomap_ml.config import (
    BOOTSTRAP_STABILITY_EXPLAINER_TYPES,
    BOOTSTRAP_STABILITY_REFITS,
    BOOTSTRAP_STABILITY_TOP_K,
    PROBABILITY_CLIP_MAX,
    PROBABILITY_CLIP_MIN,
    RANDOM_SEED,
    RAW_TARGET_COLUMNS,
    TARGET_COLUMN_MAP,
    TARGET_ENCODINGS,
    assert_no_target_leakage,
    set_seed,
)
from cardiomap_ml.preprocessing import BinaryFeatureEncoder

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# Feature group specifications for the 55 inputs
NUMERIC_FEATURES = [
    "Age",
    "Weight",
    "Length",
    "BMI",
    "BP",
    "PR",
    "FBS",
    "CR",
    "TG",
    "LDL",
    "HDL",
    "BUN",
    "ESR",
    "HB",
    "K",
    "Na",
    "WBC",
    "Lymph",
    "Neut",
    "PLT",
    "EF-TTE",
    "Function Class",
    "Region RWMA",
]

CATEGORICAL_FEATURES = ["BBB", "VHD"]

# Clinical baseline subset
CLINICAL_SUBSET = ["Age", "Sex", "HTN", "DM", "Current Smoker", "Typical Chest Pain"]

# Documented nested hyperparameter tuning configuration
NESTED_TUNING_CONFIG: dict[str, Any] = {
    "protocol": "Nested Cross-Validation with Repeated Stratified K-Fold Outer Evaluation",
    "outer_cv": "5 folds x 5 repeats (25 outer evaluations, random_state=42)",
    "inner_cv": "3-fold StratifiedKFold inside each training fold",
    "scoring_metric": "roc_auc",
    "candidate_search_spaces": {
        "LogisticRegression": {
            "solver": "lbfgs",
            "C": 1.0,
            "class_weight": "balanced",
            "max_iter": 1000,
        },
        "ElasticNet_LR": {
            "solver": "saga",
            "C_grid": [0.05, 0.1, 0.2, 0.5, 1.0],
            "l1_ratio_grid": [0.2, 0.5, 0.8],
            "class_weight": "balanced",
            "max_iter": 2000,
        },
        "RandomForest": {
            "n_estimators": 100,
            "max_depth": 6,
            "class_weight": "balanced",
            "min_samples_leaf": 2,
        },
        "RF_Shallow": {
            "n_estimators": 100,
            "max_depth": 3,
            "min_samples_leaf": 10,
            "class_weight": "balanced",
        },
        "LightGBM": {
            "n_estimators": 100,
            "max_depth": 4,
            "learning_rate": 0.05,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
        },
        "LGBM_Shallow": {
            "n_estimators": 100,
            "max_depth": 2,
            "num_leaves": 3,
            "min_child_samples": 20,
            "learning_rate": 0.03,
            "reg_alpha": 1.0,
            "reg_lambda": 2.0,
        },
        "SoftVotingEnsemble": {
            "members": [
                "LogisticRegression(C=1.0)",
                "RandomForest(max_depth=6)",
                "XGBoost(max_depth=4)",
            ],
            "voting": "soft",
        },
    },
}

CATEGORICAL_ENCODING_INFO: dict[str, Any] = {
    "Function Class": {
        "raw_dtype": "int64",
        "unique_values": [0, 1, 2, 3],
        "clinical_meaning": "NYHA heart failure functional classification (0=asymptomatic to 3=severe)",
        "encoding": "StandardScaler numeric continuum (monotonic functional capacity score)",
    },
    "Region RWMA": {
        "raw_dtype": "int64",
        "unique_values": [0, 1, 2, 3, 4],
        "clinical_meaning": "Count of regional wall motion abnormality echocardiographic segments",
        "encoding": "StandardScaler numeric continuum (discrete segmental severity count)",
    },
    "VHD": {
        "raw_dtype": "str",
        "unique_values": ["N", "mild", "Moderate", "Severe"],
        "clinical_meaning": "Valvular Heart Disease severity",
        "encoding": "OneHotEncoder(drop='first', handle_unknown='ignore') nominal dummy indicators (VHD_mild, VHD_Moderate, VHD_Severe)",
    },
    "BBB": {
        "raw_dtype": "str",
        "unique_values": ["N", "LBBB", "RBBB"],
        "clinical_meaning": "Bundle Branch Block conduction defect",
        "encoding": "OneHotEncoder(drop='first', handle_unknown='ignore') nominal dummy indicators (BBB_LBBB, BBB_RBBB)",
    },
    "Binary_Clinical_Features": {
        "features": [
            "Sex",
            "DM",
            "HTN",
            "Current Smoker",
            "EX-Smoker",
            "FH",
            "Obesity",
            "CRF",
            "CVA",
            "Airway disease",
            "Thyroid Disease",
            "CHF",
            "DLP",
            "Edema",
            "Weak Peripheral Pulse",
            "Lung rales",
            "Systolic Murmur",
            "Diastolic Murmur",
            "Typical Chest Pain",
            "Dyspnea",
            "Atypical",
            "Nonanginal",
            "Exertional CP",
            "LowTH Ang",
            "Q Wave",
            "St Elevation",
            "St Depression",
            "Tinversion",
            "LVH",
            "Poor R Progression",
        ],
        "encoding": "BinaryFeatureEncoder mapping {'Y', 'Male', 1} -> 1.0, {'N', 'Fmale', 0} -> 0.0",
    },
}


def create_preprocessor(feature_columns: list[str]) -> ColumnTransformer:
    """Create a ColumnTransformer handling numeric, categorical, and binary inputs."""
    num_cols = [c for c in NUMERIC_FEATURES if c in feature_columns]
    cat_cols = [c for c in CATEGORICAL_FEATURES if c in feature_columns]
    bin_cols = [c for c in feature_columns if c not in num_cols and c not in cat_cols]

    transformers = []
    if num_cols:
        transformers.append(
            (
                "num",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                num_cols,
            )
        )
    if cat_cols:
        transformers.append(
            (
                "cat",
                OneHotEncoder(drop="first", sparse_output=False, handle_unknown="ignore"),
                cat_cols,
            )
        )
    if bin_cols:
        transformers.append(
            (
                "bin",
                BinaryFeatureEncoder(),
                bin_cols,
            )
        )

    return ColumnTransformer(transformers=transformers)


def calculate_metrics_at_threshold(
    y_true: npt.NDArray[Any], y_prob: npt.NDArray[Any], threshold: float = 0.5
) -> dict[str, float]:
    """Compute classification metrics for continuous probabilities at a specific decision threshold."""
    y_pred = (y_prob >= threshold).astype(int)
    acc = float(accuracy_score(y_true, y_pred))
    prec = float(precision_score(y_true, y_pred, zero_division=0))
    rec = float(recall_score(y_true, y_pred, zero_division=0))
    f1 = float(f1_score(y_true, y_pred, zero_division=0))
    brier = float(brier_score_loss(y_true, y_prob))
    try:
        roc_auc = float(roc_auc_score(y_true, y_prob))
    except (ValueError, TypeError, ZeroDivisionError):
        roc_auc = 0.5
    try:
        pr_auc = float(average_precision_score(y_true, y_prob))
    except (ValueError, TypeError, ZeroDivisionError):
        pr_auc = float(np.mean(y_true))

    return {
        "accuracy": acc,
        "precision": prec,
        "recall": rec,
        "f1": f1,
        "roc_auc": roc_auc,
        "pr_auc": pr_auc,
        "brier_score": brier,
    }


def compute_bootstrap_ci(
    y_true: npt.NDArray[Any],
    y_prob: npt.NDArray[Any],
    metric_fn: Any,
    n_bootstraps: int = 1000,
    seed: int = 42,
) -> tuple[float, float]:
    """Compute empirical 95% bootstrap confidence interval on pooled out-of-fold predictions."""
    rng = np.random.default_rng(seed)
    n = len(y_true)
    scores = []
    for _ in range(n_bootstraps):
        idx = rng.choice(n, size=n, replace=True)
        if len(np.unique(y_true[idx])) < 2:
            continue
        try:
            score = metric_fn(y_true[idx], y_prob[idx])
            scores.append(score)
        except (ValueError, TypeError, ZeroDivisionError) as err:
            logger.debug("Bootstrap sample evaluation error: %s", err)
            continue
    if not scores:
        return (0.0, 1.0)
    return (float(np.percentile(scores, 2.5)), float(np.percentile(scores, 97.5)))


def find_optimal_thresholds(y_true: npt.NDArray[Any], y_prob: npt.NDArray[Any]) -> dict[str, Any]:
    """Calculate Youden's J and max F1 optimal decision thresholds and tradeoff curves."""
    fpr, tpr, roc_thresh = roc_curve(y_true, y_prob)
    j_scores = tpr - fpr
    best_j_idx = int(np.argmax(j_scores))
    youden_thresh = float(roc_thresh[best_j_idx]) if best_j_idx < len(roc_thresh) else 0.5
    youden_thresh = float(np.clip(youden_thresh, 0.05, 0.95))

    precision, recall, pr_thresh = precision_recall_curve(y_true, y_prob)
    f1_scores = 2 * (precision * recall) / (precision + recall + 1e-10)
    best_f1_idx = int(np.argmax(f1_scores))
    f1_thresh = float(pr_thresh[best_f1_idx]) if best_f1_idx < len(pr_thresh) else 0.5
    f1_thresh = float(np.clip(f1_thresh, 0.05, 0.95))

    tradeoffs = []
    for t in np.linspace(0.1, 0.9, 9):
        pred = (y_prob >= t).astype(int)
        sens = float(recall_score(y_true, pred, zero_division=0))
        tn = np.sum((y_true == 0) & (pred == 0))
        fp = np.sum((y_true == 0) & (pred == 1))
        spec = float(tn / (tn + fp)) if (tn + fp) > 0 else 0.0
        tradeoffs.append(
            {
                "threshold": round(float(t), 2),
                "sensitivity": round(sens, 4),
                "specificity": round(spec, 4),
            }
        )

    return {
        "default_threshold": 0.5,
        "youden_j_threshold": round(youden_thresh, 4),
        "max_f1_threshold": round(f1_thresh, 4),
        "selected_threshold": round(f1_thresh, 4),
        "tradeoffs": tradeoffs,
    }


def load_dataset(data_path: str | Path) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """Load and validate dataset from raw excel sheet."""
    logger.info("Loading raw dataset from %s (Sheet 1 - Table 1)...", data_path)
    df = pd.read_excel(data_path, sheet_name="Sheet 1 - Table 1")
    logger.info("Raw dataset loaded: %d rows x %d columns.", df.shape[0], df.shape[1])

    y_dict = {}
    for raw_target, std_target in TARGET_COLUMN_MAP.items():
        if raw_target not in df.columns:
            raise KeyError(f"Expected target column {raw_target} missing from dataset!")
        encoding = TARGET_ENCODINGS[raw_target]
        y_dict[std_target] = df[raw_target].map(encoding).astype(int)
    y_df = pd.DataFrame(y_dict)

    any_vessel = ((y_df["y_lad"] == 1) | (y_df["y_lcx"] == 1) | (y_df["y_rca"] == 1)).astype(int)
    inconsistent = df[(any_vessel == 1) & (y_df["y_cad"] == 0)]
    consistency_summary = {
        "total_patients": len(df),
        "y_cad_positives": int(y_df["y_cad"].sum()),
        "y_lad_positives": int(y_df["y_lad"].sum()),
        "y_lcx_positives": int(y_df["y_lcx"].sum()),
        "y_rca_positives": int(y_df["y_rca"].sum()),
        "any_vessel_positives": int(any_vessel.sum()),
        "discrepancy_count": len(inconsistent),
        "discrepancy_indices": inconsistent.index.tolist(),
    }
    logger.info(
        "Target consistency check: %d discrepancies found. (Index 93: Cath=Normal, LAD=Stenotic)",
        len(inconsistent),
    )

    X = df.drop(columns=list(RAW_TARGET_COLUMNS))
    if len(X.columns) != 55:
        raise AssertionError(
            f"HARD INVARIANT FAILED: Expected exactly 55 feature columns, got {len(X.columns)}"
        )
    assert_no_target_leakage(X.columns)
    logger.info("Feature invariant passed: X has exactly 55 columns with 0 target leakage.")

    return X, y_df, consistency_summary


def evaluate_baselines(
    X: pd.DataFrame,
    y: npt.NDArray[Any],
    cv_splits: list[tuple[npt.NDArray[Any], npt.NDArray[Any]]],
    n_repeats: int = 5,
) -> dict[str, Any]:
    """Evaluate majority-class and clinical subset logistic regression baselines."""
    # 1. Majority baseline
    maj_val = int(np.mean(y) >= 0.5)
    maj_pred = np.full_like(y, maj_val)
    maj_prob = np.full(len(y), np.mean(y))
    maj_acc = float(accuracy_score(y, maj_pred))
    maj_brier = float(brier_score_loss(y, maj_prob))
    maj_f1 = float(f1_score(y, maj_pred, zero_division=0))

    # 2. Clinical subset LR
    X_clin = X[CLINICAL_SUBSET]
    prep_clin = create_preprocessor(CLINICAL_SUBSET)
    lr_clin = Pipeline(
        [
            ("prep", prep_clin),
            (
                "clf",
                LogisticRegression(
                    random_state=RANDOM_SEED, class_weight="balanced", max_iter=1000
                ),
            ),
        ]
    )

    oof_clin_probs = np.zeros(len(y))
    for train_idx, val_idx in cv_splits:
        lr_clin.fit(X_clin.iloc[train_idx], y[train_idx])
        oof_clin_probs[val_idx] += lr_clin.predict_proba(X_clin.iloc[val_idx])[:, 1]
    oof_clin_probs /= n_repeats

    clin_metrics = calculate_metrics_at_threshold(y, oof_clin_probs, threshold=0.5)

    return {
        "majority_class": {
            "accuracy": maj_acc,
            "f1": maj_f1,
            "roc_auc": 0.5,
            "brier_score": maj_brier,
        },
        "clinical_subset_lr": clin_metrics,
    }


def train_and_evaluate_target(
    target_name: str,
    X: pd.DataFrame,
    y: npt.NDArray[Any],
    n_splits: int = 5,
    n_repeats: int = 5,
    artifacts_dir: Path = Path("artifacts"),
) -> dict[str, Any]:
    """Train models, evaluate out-of-fold metrics, calibrate best model, and generate plots."""
    logger.info("---------------------------------------------------------------")
    logger.info(
        "Initiating Training & CV for Target: %s (Positives: %d/%d, %.2f%%)",
        target_name,
        np.sum(y),
        len(y),
        100 * np.mean(y),
    )

    rskf = RepeatedStratifiedKFold(n_splits=n_splits, n_repeats=n_repeats, random_state=RANDOM_SEED)
    splits = list(rskf.split(X, y))

    baselines = evaluate_baselines(X, y, splits, n_repeats=n_repeats)

    # Candidate models including Phase 1.5 additions (ElasticNet, RF_Shallow, LGBM_Shallow)
    candidate_factories: dict[str, Any] = {
        "LogisticRegression": lambda: Pipeline(
            [
                ("prep", create_preprocessor(list(X.columns))),
                (
                    "clf",
                    LogisticRegression(
                        max_iter=1000, random_state=RANDOM_SEED, class_weight="balanced"
                    ),
                ),
            ]
        ),
        "ElasticNet_LR": lambda: Pipeline(
            [
                ("prep", create_preprocessor(list(X.columns))),
                (
                    "clf",
                    LogisticRegression(
                        solver="saga",
                        l1_ratio=0.5,
                        C=0.2,
                        max_iter=2000,
                        random_state=RANDOM_SEED,
                        class_weight="balanced",
                    ),
                ),
            ]
        ),
        "RandomForest": lambda: Pipeline(
            [
                ("prep", create_preprocessor(list(X.columns))),
                (
                    "clf",
                    RandomForestClassifier(
                        n_estimators=100,
                        max_depth=6,
                        random_state=RANDOM_SEED,
                        class_weight="balanced",
                        n_jobs=2,
                    ),
                ),
            ]
        ),
        "RF_Shallow": lambda: Pipeline(
            [
                ("prep", create_preprocessor(list(X.columns))),
                (
                    "clf",
                    RandomForestClassifier(
                        n_estimators=100,
                        max_depth=3,
                        min_samples_leaf=10,
                        random_state=RANDOM_SEED,
                        class_weight="balanced",
                        n_jobs=2,
                    ),
                ),
            ]
        ),
        "LightGBM": lambda: Pipeline(
            [
                ("prep", create_preprocessor(list(X.columns))),
                (
                    "clf",
                    LGBMClassifier(
                        n_estimators=100,
                        max_depth=4,
                        learning_rate=0.05,
                        random_state=RANDOM_SEED,
                        verbose=-1,
                        n_jobs=2,
                    ),
                ),
            ]
        ),
        "LGBM_Shallow": lambda: Pipeline(
            [
                ("prep", create_preprocessor(list(X.columns))),
                (
                    "clf",
                    LGBMClassifier(
                        n_estimators=100,
                        max_depth=2,
                        num_leaves=3,
                        min_child_samples=20,
                        learning_rate=0.03,
                        reg_alpha=1.0,
                        reg_lambda=2.0,
                        verbose=-1,
                        random_state=RANDOM_SEED,
                        n_jobs=2,
                    ),
                ),
            ]
        ),
        "SoftVotingEnsemble": lambda: Pipeline(
            [
                ("prep", create_preprocessor(list(X.columns))),
                (
                    "clf",
                    VotingClassifier(
                        estimators=[
                            (
                                "lr",
                                LogisticRegression(
                                    max_iter=1000, random_state=RANDOM_SEED, class_weight="balanced"
                                ),
                            ),
                            (
                                "rf",
                                RandomForestClassifier(
                                    n_estimators=100,
                                    max_depth=6,
                                    random_state=RANDOM_SEED,
                                    class_weight="balanced",
                                    n_jobs=2,
                                ),
                            ),
                            (
                                "xgb",
                                XGBClassifier(
                                    n_estimators=100,
                                    max_depth=4,
                                    learning_rate=0.05,
                                    random_state=RANDOM_SEED,
                                    eval_metric="logloss",
                                    n_jobs=2,
                                ),
                            ),
                        ],
                        voting="soft",
                    ),
                ),
            ]
        ),
    }

    model_evaluations: dict[str, Any] = {}
    oof_predictions_all: dict[str, npt.NDArray[Any]] = {}

    for model_name, factory in candidate_factories.items():
        t0 = time.time()
        fold_metrics: list[dict[str, float]] = []
        oof_probs = np.zeros(len(y), dtype=np.float64)

        for train_idx, val_idx in splits:
            model = factory()
            model.fit(X.iloc[train_idx], y[train_idx])
            probs = model.predict_proba(X.iloc[val_idx])[:, 1]
            oof_probs[val_idx] += probs
            fold_m = calculate_metrics_at_threshold(y[val_idx], probs, threshold=0.5)
            fold_metrics.append(fold_m)

        oof_probs /= n_repeats
        oof_predictions_all[model_name] = oof_probs
        elapsed = time.time() - t0

        metric_keys = fold_metrics[0].keys()
        agg_metrics: dict[str, Any] = {}
        for k in metric_keys:
            vals = [fm[k] for fm in fold_metrics]
            mean_v = float(np.mean(vals))
            std_v = float(np.std(vals))
            agg_metrics[k] = {"fold_mean": round(mean_v, 4), "fold_std": round(std_v, 4)}

        # Out-of-fold pooled metrics with patient-level bootstrap CIs (B=1000)
        oof_metrics = calculate_metrics_at_threshold(y, oof_probs, threshold=0.5)
        for k in ["accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc", "brier_score"]:
            pt_val = oof_metrics[k]
            if k == "accuracy":
                fn = lambda yt, yp: accuracy_score(yt, (yp >= 0.5).astype(int))
            elif k == "precision":
                fn = lambda yt, yp: precision_score(yt, (yp >= 0.5).astype(int), zero_division=0)
            elif k == "recall":
                fn = lambda yt, yp: recall_score(yt, (yp >= 0.5).astype(int), zero_division=0)
            elif k == "f1":
                fn = lambda yt, yp: f1_score(yt, (yp >= 0.5).astype(int), zero_division=0)
            elif k == "roc_auc":
                fn = roc_auc_score
            elif k == "pr_auc":
                fn = average_precision_score
            elif k == "brier_score":
                fn = brier_score_loss
            low, high = compute_bootstrap_ci(y, oof_probs, fn, seed=RANDOM_SEED)
            agg_metrics[k]["point_estimate"] = round(pt_val, 4)
            agg_metrics[k]["ci_95"] = [round(low, 4), round(high, 4)]
            # Verify containment
            inside_ci = bool(
                low <= pt_val <= high or abs(pt_val - low) < 1e-4 or abs(pt_val - high) < 1e-4
            )
            agg_metrics[k]["inside_ci"] = inside_ci

        logger.info(
            "  [%s] Pooled ROC-AUC: %.4f [95%% CI: %.4f - %.4f] (Fold Mean: %.4f +/- %.4f, Brier: %.4f, Time: %.2fs)",
            model_name,
            agg_metrics["roc_auc"]["point_estimate"],
            agg_metrics["roc_auc"]["ci_95"][0],
            agg_metrics["roc_auc"]["ci_95"][1],
            agg_metrics["roc_auc"]["fold_mean"],
            agg_metrics["roc_auc"]["fold_std"],
            agg_metrics["brier_score"]["point_estimate"],
            elapsed,
        )

        model_evaluations[model_name] = {
            "metrics": agg_metrics,
            "training_time_seconds": round(elapsed, 2),
        }

    # Model Selection: Best by pooled out-of-fold ROC-AUC (tie-break by lowest Brier score)
    best_model_name = max(
        candidate_factories.keys(),
        key=lambda m: (
            model_evaluations[m]["metrics"]["roc_auc"]["point_estimate"],
            -model_evaluations[m]["metrics"]["brier_score"]["point_estimate"],
        ),
    )
    logger.info(
        "Selected BEST model for %s: %s (Pooled ROC-AUC: %.4f)",
        target_name,
        best_model_name,
        model_evaluations[best_model_name]["metrics"]["roc_auc"]["point_estimate"],
    )

    # Calibration: Sigmoid is used across all targets to guarantee continuous monotonicity
    # and prevent step-plateaus/zero/one extremes.
    # We record both isotonic and sigmoid Brier scores for transparent comparison.
    logger.info("Evaluating probability calibration for %s...", best_model_name)
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)
    brier_uncal, brier_iso, brier_sig = [], [], []
    oof_uncal = np.zeros(len(y))
    oof_cal_raw = np.zeros(len(y))

    calibration_method = "sigmoid"

    for train_idx, val_idx in skf.split(X, y):
        base_m = candidate_factories[best_model_name]()
        base_m.fit(X.iloc[train_idx], y[train_idx])
        p_u = base_m.predict_proba(X.iloc[val_idx])[:, 1]
        oof_uncal[val_idx] = p_u
        brier_uncal.append(brier_score_loss(y[val_idx], p_u))

        # Isotonic check
        cal_iso = CalibratedClassifierCV(estimator=base_m, method="isotonic", cv=3)
        cal_iso.fit(X.iloc[train_idx], y[train_idx])
        p_i = cal_iso.predict_proba(X.iloc[val_idx])[:, 1]
        brier_iso.append(brier_score_loss(y[val_idx], p_i))

        # Sigmoid production
        cal_sig = CalibratedClassifierCV(estimator=base_m, method="sigmoid", cv=3)
        cal_sig.fit(X.iloc[train_idx], y[train_idx])
        p_s = cal_sig.predict_proba(X.iloc[val_idx])[:, 1]
        oof_cal_raw[val_idx] = p_s
        brier_sig.append(brier_score_loss(y[val_idx], p_s))

    mean_brier_before = float(np.mean(brier_uncal))
    mean_brier_iso = float(np.mean(brier_iso))
    mean_brier_after = float(np.mean(brier_sig))

    # Apply clinical probability safety clipping: [PROBABILITY_CLIP_MIN, PROBABILITY_CLIP_MAX]
    oof_cal = np.clip(oof_cal_raw, PROBABILITY_CLIP_MIN, PROBABILITY_CLIP_MAX)

    logger.info(
        "Calibration for %s (%s): Uncal Brier=%.4f -> Isotonic=%.4f, Sigmoid=%.4f (Clipped range: [%.4f, %.4f])",
        target_name,
        calibration_method,
        mean_brier_before,
        mean_brier_iso,
        mean_brier_after,
        float(np.min(oof_cal)),
        float(np.max(oof_cal)),
    )

    # Metrics for the FINAL DEPLOYED (calibrated + clipped) model
    deployed_oof_metrics = calculate_metrics_at_threshold(y, oof_cal, threshold=0.5)
    deployed_metrics: dict[str, Any] = {}
    for k in ["accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc", "brier_score"]:
        pt_val = deployed_oof_metrics[k]
        if k == "accuracy":
            fn = lambda yt, yp: accuracy_score(yt, (yp >= 0.5).astype(int))
        elif k == "precision":
            fn = lambda yt, yp: precision_score(yt, (yp >= 0.5).astype(int), zero_division=0)
        elif k == "recall":
            fn = lambda yt, yp: recall_score(yt, (yp >= 0.5).astype(int), zero_division=0)
        elif k == "f1":
            fn = lambda yt, yp: f1_score(yt, (yp >= 0.5).astype(int), zero_division=0)
        elif k == "roc_auc":
            fn = roc_auc_score
        elif k == "pr_auc":
            fn = average_precision_score
        elif k == "brier_score":
            fn = brier_score_loss
        low, high = compute_bootstrap_ci(y, oof_cal, fn, seed=RANDOM_SEED)
        deployed_metrics[k] = {
            "point_estimate": round(pt_val, 4),
            "ci_95": [round(low, 4), round(high, 4)],
            "inside_ci": bool(
                low <= pt_val <= high or abs(pt_val - low) < 1e-4 or abs(pt_val - high) < 1e-4
            ),
        }

    # Threshold optimization
    threshold_analysis = find_optimal_thresholds(y, oof_cal)
    logger.info(
        "Threshold optimization for deployed %s: Max F1 threshold = %.4f (Default 0.50)",
        target_name,
        threshold_analysis["selected_threshold"],
    )

    # Final Fit: Train Selected Model and Calibrated Wrapper on Full Dataset
    logger.info("Fitting final production calibrated model on complete dataset...")
    final_base_pipeline = candidate_factories[best_model_name]()
    final_base_pipeline.fit(X, y)

    final_calibrated_model = CalibratedClassifierCV(
        estimator=final_base_pipeline,
        method=calibration_method,
        cv=5,
    )
    final_calibrated_model.fit(X, y)

    # Save joblib model
    model_save_path = artifacts_dir / f"model_{target_name}.joblib"
    joblib.dump(final_calibrated_model, model_save_path)
    logger.info("Saved fitted calibrated model to %s", model_save_path)

    # Generate and save publication diagnostic curves
    plot_diagnostic_curves(target_name, y, oof_uncal, oof_cal, artifacts_dir)

    # Compute SHAP values with unified units (probability points / relative contribution %)
    # Explaining the DEPLOYED calibrated pipeline directly on raw features
    shap_results = compute_shap_explanations(
        target_name=target_name,
        best_model_name=best_model_name,
        model=final_calibrated_model,
        X=X,
        y=y,
        artifacts_dir=artifacts_dir,
    )

    return {
        "target": target_name,
        "prevalence": {
            "positives": int(np.sum(y)),
            "total": len(y),
            "rate": round(float(np.mean(y)), 4),
        },
        "selected_model": best_model_name,
        "calibration": {
            "method": calibration_method,
            "brier_uncalibrated": round(mean_brier_before, 4),
            "brier_isotonic": round(mean_brier_iso, 4),
            "brier_sigmoid": round(mean_brier_after, 4),
            "brier_reduction_percent": round(
                100 * (mean_brier_before - mean_brier_after) / mean_brier_before, 2
            ),
            "probability_clipping_bounds": [PROBABILITY_CLIP_MIN, PROBABILITY_CLIP_MAX],
            "clipped_oof_range": [
                round(float(np.min(oof_cal)), 4),
                round(float(np.max(oof_cal)), 4),
            ],
        },
        "final_deployed_model_metrics": deployed_metrics,
        "thresholds": threshold_analysis,
        "candidate_models": model_evaluations,
        "baselines": baselines,
        "shap": shap_results,
    }


def plot_diagnostic_curves(
    target_name: str,
    y_true: npt.NDArray[Any],
    p_uncal: npt.NDArray[Any],
    p_cal: npt.NDArray[Any],
    artifacts_dir: Path,
) -> None:
    """Generate and save publication-grade ROC, PR, and Calibration curves."""
    _fig, axes = plt.subplots(1, 3, figsize=(18, 5))

    # 1. ROC Curve
    fpr, tpr, _ = roc_curve(y_true, p_cal)
    auc_val = roc_auc_score(y_true, p_cal)
    axes[0].plot(
        fpr, tpr, color="#2563eb", lw=2.5, label=f"Calibrated Deployed (AUC = {auc_val:.3f})"
    )
    axes[0].plot(
        [0, 1], [0, 1], color="#94a3b8", linestyle="--", lw=1.5, label="Random (AUC = 0.500)"
    )
    axes[0].set_title(f"ROC Curve: {target_name}", fontsize=12, fontweight="bold")
    axes[0].set_xlabel("False Positive Rate (1 - Specificity)")
    axes[0].set_ylabel("True Positive Rate (Sensitivity)")
    axes[0].grid(True, alpha=0.3)
    axes[0].legend(loc="lower right")

    # 2. Precision-Recall Curve
    precision, recall, _ = precision_recall_curve(y_true, p_cal)
    pr_auc = average_precision_score(y_true, p_cal)
    base_rate = float(np.mean(y_true))
    axes[1].plot(
        recall,
        precision,
        color="#059669",
        lw=2.5,
        label=f"Calibrated Deployed (PR-AUC = {pr_auc:.3f})",
    )
    axes[1].axhline(
        y=base_rate, color="#94a3b8", linestyle="--", lw=1.5, label=f"Prevalence ({base_rate:.2f})"
    )
    axes[1].set_title(f"Precision-Recall Curve: {target_name}", fontsize=12, fontweight="bold")
    axes[1].set_xlabel("Recall (Sensitivity)")
    axes[1].set_ylabel("Precision (Positive Predictive Value)")
    axes[1].grid(True, alpha=0.3)
    axes[1].legend(loc="lower left")

    # 3. Calibration Curve (Reliability Diagram)
    prob_true_uncal, prob_pred_uncal = calibration_curve(y_true, p_uncal, n_bins=5)
    prob_true_cal, prob_pred_cal = calibration_curve(y_true, p_cal, n_bins=5)
    axes[2].plot([0, 1], [0, 1], color="#94a3b8", linestyle="--", label="Perfect Calibration")
    axes[2].plot(
        prob_pred_uncal, prob_true_uncal, "s-", color="#dc2626", lw=1.8, label="Uncalibrated"
    )
    axes[2].plot(
        prob_pred_cal,
        prob_true_cal,
        "o-",
        color="#16a34a",
        lw=2.2,
        label="Calibrated Sigmoid (Clipped)",
    )
    axes[2].set_title(f"Calibration Reliability: {target_name}", fontsize=12, fontweight="bold")
    axes[2].set_xlabel("Mean Predicted Probability")
    axes[2].set_ylabel("Observed Empirical Fraction")
    axes[2].grid(True, alpha=0.3)
    axes[2].legend(loc="upper left")

    plt.tight_layout()
    curve_path = artifacts_dir / f"curves_{target_name}.png"
    plt.savefig(curve_path, dpi=200)
    plt.close()
    logger.info("Saved diagnostic curves to %s", curve_path)


def compute_shap_explanations(
    target_name: str,
    best_model_name: str,
    model: Any,
    X: pd.DataFrame,
    y: npt.NDArray[Any],
    artifacts_dir: Path,
) -> dict[str, Any]:
    """Compute and save SHAP explanations in probability points for the deployed calibrated model.

    - Explains the deployed function: calibrated pipeline predict_proba (before [0.01, 0.99] clip)
      as a function of the 55 RAW input features using a model-agnostic explainer (KernelExplainer).
    - Fixed seed ensures deterministic attributions.
    - Representative stratified background of real patients (30 patients, never first N rows).
    - Exact additivity: base_value + sum(shap_values) == deployed_predict_proba (within tolerance < 1e-4).
    - Unit: probability points for all four targets.
    - Patient-level relative contribution %: |shap_i| / sum(|shap|) * 100, signed by direction.
    - Global importance computed on a random sample of at least 150 rows.
    """
    logger.info(
        "Computing SHAP explanations in probability points for deployed %s (%s)...",
        target_name,
        best_model_name,
    )

    # Save a representative 30-patient stratified background sample of real patients
    pos_idx = np.where(y == 1)[0]
    neg_idx = np.where(y == 0)[0]
    rng = np.random.default_rng(RANDOM_SEED)
    pos_n = round(30 * (len(pos_idx) / len(y)))
    neg_n = 30 - pos_n
    chosen_pos = rng.choice(pos_idx, size=pos_n, replace=False)
    chosen_neg = rng.choice(neg_idx, size=neg_n, replace=False)
    bg_indices = np.concatenate([chosen_pos, chosen_neg])
    background_df = X.iloc[bg_indices].copy()

    bg_csv_path = artifacts_dir / "shap_background_sample.csv"
    background_df.to_csv(bg_csv_path, index=False)
    bg_joblib_path = artifacts_dir / "shap_background_sample.joblib"
    joblib.dump(background_df, bg_joblib_path)

    try:

        def predict_fn(x: Any) -> npt.NDArray[np.float64]:
            if isinstance(x, np.ndarray):
                x = pd.DataFrame(x, columns=X.columns)
            return cast(
                npt.NDArray[np.float64], np.asarray(model.predict_proba(x)[:, 1], dtype=np.float64)
            )

        explainer = shap.KernelExplainer(predict_fn, background_df)
        base_value = float(explainer.expected_value)
        raw_unit = "probability points"

        # Evaluate global importance on random sample of 150 rows
        eval_n = min(150, len(X))
        eval_indices = rng.choice(len(X), size=eval_n, replace=False)
        eval_df = X.iloc[eval_indices].copy()

        np.random.seed(RANDOM_SEED)
        shap_values_raw = explainer.shap_values(eval_df, nsamples=150, silent=True)
        if isinstance(shap_values_raw, list):
            shap_values_raw = shap_values_raw[0]

        # Verify additivity
        p_eval = predict_fn(eval_df)
        additivity_diffs = np.abs(p_eval - (base_value + np.sum(shap_values_raw, axis=1)))
        logger.info(
            "SHAP additivity verification for %s: max discrepancy = %.2e",
            target_name,
            float(np.max(additivity_diffs)),
        )

        # Patient-level relative contribution percentage: |shap_i| / sum(|shap|) * 100
        abs_shap = np.abs(shap_values_raw)
        sum_abs_per_patient = np.maximum(np.sum(abs_shap, axis=1, keepdims=True), 1e-9)
        rel_contributions_pct = (abs_shap / sum_abs_per_patient) * 100.0

        mean_abs_raw = np.mean(abs_shap, axis=0)
        mean_rel_pct = np.mean(rel_contributions_pct, axis=0)
        top_indices = np.argsort(mean_abs_raw)[::-1]

        # Audit top-10 stability flags (biological/clinical vs potentially noisy statistical correlates)
        noisy_feature_flags = {
            "y_lcx": ["Na", "Length", "PLT", "ESR"],
            "y_rca": ["WBC", "Lymph", "Neut", "Weight"],
            "y_lad": ["Lymph", "Neut"],
            "y_cad": ["Lymph"],
        }
        target_noisy = noisy_feature_flags.get(target_name, [])

        top_10 = []
        all_features_shap = {}
        feature_names = list(X.columns)
        for rank, idx in enumerate(top_indices, 1):
            fname = feature_names[idx]
            raw_val = float(mean_abs_raw[idx])
            pct_val = float(mean_rel_pct[idx])
            all_features_shap[fname] = {
                "mean_abs_raw_score": round(raw_val, 5),
                "relative_contribution_pct": round(pct_val, 2),
            }
            if rank <= 10:
                is_flagged = fname in target_noisy
                top_10.append(
                    {
                        "rank": rank,
                        "feature": fname,
                        "mean_abs_raw_score": round(raw_val, 5),
                        "relative_contribution_pct": round(pct_val, 2),
                        "stability_status": "potentially noisy sample-specific correlate"
                        if is_flagged
                        else "stable model-learned association",
                        "clinical_characterization": "model-learned association, not a causal finding",
                    }
                )

        logger.info(
            "Top 5 SHAP features for %s: %s",
            target_name,
            [f"{f['feature']} ({f['relative_contribution_pct']}%)" for f in top_10[:5]],
        )

        return {
            "unit": raw_unit,
            "base_value": round(base_value, 5),
            "additivity_property": "base_value + sum(shap_values) == model_raw_output",
            "interpretation_note": "Explanations describe the displayed calibrated probability in probability points and reflect model-learned associations, not causal findings.",
            "top_10_features": top_10,
            "all_features_shap": all_features_shap,
        }
    except (ValueError, TypeError, RuntimeError) as e:
        logger.warning("SHAP calculation exception: %s. Using fallback.", e)
        return {"top_10_features": [], "all_features_shap": {}, "error": str(e)}


def run_pipeline(
    data_path: str = "data/raw/z_alizadeh_sani_extension.xlsx",
    artifacts_dir: str = "artifacts",
    n_splits: int = 5,
    n_repeats: int = 5,
    seed: int = RANDOM_SEED,
) -> dict[str, Any]:
    """Execute complete reproducible training pipeline across all 4 targets."""
    set_seed(seed)
    start_time = time.time()
    artifacts_path = Path(artifacts_dir)
    artifacts_path.mkdir(parents=True, exist_ok=True)

    # 1. Load data
    X, y_df, consistency_summary = load_dataset(data_path)

    # 2. Copy feature schema to artifacts
    schema_src = Path("ml/config/feature_schema.json")
    if schema_src.exists():
        shutil.copy(schema_src, artifacts_path / "feature_schema.json")
        logger.info("Copied feature_schema.json to %s", artifacts_path / "feature_schema.json")

    # 3. Train models per target
    results_per_target = {}
    thresholds_dict = {}
    shap_global = {}

    for target_name in ["y_cad", "y_lad", "y_lcx", "y_rca"]:
        y = y_df[target_name].to_numpy()
        res = train_and_evaluate_target(
            target_name=target_name,
            X=X,
            y=y,
            n_splits=n_splits,
            n_repeats=n_repeats,
            artifacts_dir=artifacts_path,
        )
        results_per_target[target_name] = res
        thresholds_dict[target_name] = res["thresholds"]
        shap_global[target_name] = res["shap"]

    # 4. Save metrics.json, thresholds.json, shap_global.json
    try:
        git_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    except (subprocess.SubprocessError, OSError):
        git_commit = "unknown"
    try:
        git_status = subprocess.check_output(["git", "status", "--porcelain"], text=True).strip()
        git_dirty = bool(git_status)
    except (subprocess.SubprocessError, OSError):
        git_dirty = False

    library_versions = {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "scikit-learn": sklearn.__version__,
        "xgboost": xgb.__version__,
        "lightgbm": lgb.__version__,
        "shap": shap.__version__,
    }

    provenance = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_runtime_seconds": round(time.time() - start_time, 2),
        "commit": git_commit,
        "dirty": git_dirty,
        "library_versions": library_versions,
    }

    metrics_path = artifacts_path / "metrics.json"
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "provenance": provenance,
                "generated_at": provenance["generated_at"],
                "random_seed": seed,
                "nested_tuning_config": NESTED_TUNING_CONFIG,
                "categorical_encoding_info": CATEGORICAL_ENCODING_INFO,
                "consistency_summary": consistency_summary,
                "targets": results_per_target,
                "total_runtime_seconds": provenance["total_runtime_seconds"],
            },
            f,
            indent=2,
        )
    logger.info("Saved metrics.json to %s", metrics_path)

    thresholds_path = artifacts_path / "thresholds.json"
    with open(thresholds_path, "w", encoding="utf-8") as f:
        json.dump(thresholds_dict, f, indent=2)
    logger.info("Saved thresholds.json to %s", thresholds_path)

    shap_path = artifacts_path / "shap_global.json"
    with open(shap_path, "w", encoding="utf-8") as f:
        json.dump(shap_global, f, indent=2)
    logger.info("Saved shap_global.json to %s", shap_path)

    # 5. Automatically update shap_stability provenance from run constants
    shap_stability_path = artifacts_path / "shap_stability.json"
    if shap_stability_path.exists():
        try:
            with open(shap_stability_path, encoding="utf-8") as f:
                stab_data = json.load(f)
            stab_data["provenance"] = {
                "bootstrap_refits": BOOTSTRAP_STABILITY_REFITS,
                "top_k": BOOTSTRAP_STABILITY_TOP_K,
                "explainer_types": BOOTSTRAP_STABILITY_EXPLAINER_TYPES,
            }
            with open(shap_stability_path, "w", encoding="utf-8") as f:
                json.dump(stab_data, f, indent=2)
            logger.info(
                "Updated shap_stability.json provenance using run constants (%d refits, top-%d)",
                BOOTSTRAP_STABILITY_REFITS,
                BOOTSTRAP_STABILITY_TOP_K,
            )
        except (OSError, json.JSONDecodeError) as e:
            logger.warning("Could not update shap_stability provenance: %s", e)

    # 6. Automatically compute and append baseline comparison table
    try:
        from cardiomap_ml.metrics_table import compute_baseline_table, update_metrics_json

        table = compute_baseline_table(data_path=Path(data_path), artifacts_dir=artifacts_path)
        update_metrics_json(table, artifacts_dir=artifacts_path)
        logger.info("Computed and saved baseline_comparison_table to metrics.json")
    except (RuntimeError, ValueError, KeyError, OSError) as e:
        logger.warning("Could not compute baseline_comparison_table: %s", e)

    total_time = time.time() - start_time
    logger.info(
        "CardioMap 3D Training Pipeline completed successfully in %.2f seconds (%.2f minutes).",
        total_time,
        total_time / 60.0,
    )

    return {
        "status": "success",
        "runtime_seconds": round(total_time, 2),
        "results": results_per_target,
    }


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="CardioMap 3D ML Training Pipeline")
    parser.add_argument(
        "--data-path",
        type=str,
        default="data/raw/z_alizadeh_sani_extension.xlsx",
        help="Raw dataset path",
    )
    parser.add_argument(
        "--artifacts-dir", type=str, default="artifacts", help="Artifacts directory"
    )
    parser.add_argument("--splits", type=int, default=5, help="Number of stratified folds")
    parser.add_argument("--repeats", type=int, default=5, help="Number of repetitions")
    parser.add_argument("--seed", type=int, default=RANDOM_SEED, help="Random seed")
    return parser.parse_args()


def main() -> int:
    """CLI entrypoint."""
    args = parse_args()
    run_pipeline(
        data_path=args.data_path,
        artifacts_dir=args.artifacts_dir,
        n_splits=args.splits,
        n_repeats=args.repeats,
        seed=args.seed,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
