"""CardioMap 3D Baseline Metrics Table Generator.

Recomputes exact out-of-fold metrics across all 4 targets from cross-validated
probabilities and artifacts/thresholds.json. Updates artifacts/metrics.json
and regenerates markdown tables in docs/model_card.md and docs/evaluation_report.md.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
from lightgbm import LGBMClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    f1_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import RepeatedStratifiedKFold, StratifiedKFold
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

from .config import PROBABILITY_CLIP_MAX, PROBABILITY_CLIP_MIN, RANDOM_SEED
from .train import CLINICAL_SUBSET, create_preprocessor, load_dataset


def compute_paired_bootstrap(
    y: npt.NDArray[Any],
    y_pred_deployed: npt.NDArray[Any],
    y_pred_baseline: npt.NDArray[Any],
    n_resamples: int = 1000,
    seed: int = RANDOM_SEED,
) -> dict[str, Any]:
    """Compute patient-level paired bootstrap (B=1000) of AUC(deployed) - AUC(baseline)."""
    rng = np.random.RandomState(seed)
    n_samples = len(y)
    auc_dep = float(roc_auc_score(y, y_pred_deployed))
    auc_base = float(roc_auc_score(y, y_pred_baseline))
    diff_pt = auc_dep - auc_base

    diffs: list[float] = []
    for _ in range(n_resamples):
        idx = rng.randint(0, n_samples, n_samples)
        if len(np.unique(y[idx])) < 2:
            continue
        auc_d = roc_auc_score(y[idx], y_pred_deployed[idx])
        auc_b = roc_auc_score(y[idx], y_pred_baseline[idx])
        diffs.append(float(auc_d - auc_b))

    arr_diffs = np.array(diffs, dtype=np.float64)
    ci_low = float(np.percentile(arr_diffs, 2.5))
    ci_high = float(np.percentile(arr_diffs, 97.5))
    frac_gt = float(np.mean(arr_diffs > 0))
    excludes_zero = bool(ci_low > 0 or ci_high < 0)

    return {
        "baseline_model": "clinical_subset_lr",
        "clinical_features": list(CLINICAL_SUBSET),
        "deployed_roc_auc": round(auc_dep, 4),
        "baseline_roc_auc": round(auc_base, 4),
        "delta_auc": round(diff_pt, 4),
        "ci_95": [round(ci_low, 4), round(ci_high, 4)],
        "fraction_deployed_superior": round(frac_gt, 4),
        "excludes_zero": excludes_zero,
        "significance": (
            "statistically superior (95% CI excludes 0)"
            if excludes_zero
            else "not significantly different (95% CI includes 0)"
        ),
    }

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def compute_baseline_table(
    data_path: Path = Path("data/raw/z_alizadeh_sani_extension.xlsx"),
    artifacts_dir: Path = Path("artifacts"),
) -> dict[str, Any]:
    """Compute exact out-of-fold metrics and baseline comparison table."""
    logger.info("Computing out-of-fold calibrated probabilities and baseline metrics...")
    X, y_df, _ = load_dataset(data_path)

    thresholds_file = artifacts_dir / "thresholds.json"
    metrics_file = artifacts_dir / "metrics.json"

    with open(thresholds_file, encoding="utf-8") as f:
        thresholds = json.load(f)
    with open(metrics_file, encoding="utf-8") as f:
        metrics = json.load(f)

    factories: dict[str, Any] = {
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
    }

    baseline_table: dict[str, Any] = {}
    targets = ["y_cad", "y_lad", "y_lcx", "y_rca"]

    for target in targets:
        model_name = metrics["targets"][target]["selected_model"]
        y = y_df[target].to_numpy()
        skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)
        oof_cal_raw = np.zeros(len(y), dtype=np.float64)

        for train_idx, val_idx in skf.split(X, y):
            base_m = factories[model_name]()
            base_m.fit(X.iloc[train_idx], y[train_idx])
            cal_sig = CalibratedClassifierCV(estimator=base_m, method="sigmoid", cv=3)
            cal_sig.fit(X.iloc[train_idx], y[train_idx])
            oof_cal_raw[val_idx] = cal_sig.predict_proba(X.iloc[val_idx])[:, 1]

        oof_cal = np.clip(oof_cal_raw, PROBABILITY_CLIP_MIN, PROBABILITY_CLIP_MAX)
        sel_t = float(thresholds[target]["selected_threshold"])

        n_pos = int(np.sum(y))
        n_tot = len(y)
        prev = float(n_pos / n_tot)

        pred_trivial = np.ones_like(y)
        trivial_f1 = float(f1_score(y, pred_trivial, zero_division=0))

        pred_50 = (oof_cal >= 0.5).astype(int)
        f1_50 = float(f1_score(y, pred_50, zero_division=0))
        bal_acc_50 = float(balanced_accuracy_score(y, pred_50))
        acc_50 = float(accuracy_score(y, pred_50))

        pred_t = (oof_cal >= sel_t).astype(int)
        f1_t = float(f1_score(y, pred_t, zero_division=0))
        f1_delta = float(f1_t - trivial_f1)
        bal_acc_t = float(balanced_accuracy_score(y, pred_t))
        sens_t = float(recall_score(y, pred_t, zero_division=0))
        spec_t = float(np.sum((y == 0) & (pred_t == 0)) / np.sum(y == 0))

        roc_info = metrics["targets"][target]["final_deployed_model_metrics"]["roc_auc"]

        # Compute clinical subset LR OOF predictions on RepeatedStratifiedKFold
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
        rskf = RepeatedStratifiedKFold(n_splits=5, n_repeats=5, random_state=RANDOM_SEED)
        oof_clin = np.zeros(len(y), dtype=np.float64)
        for tr, val in rskf.split(X, y):
            lr_clin.fit(X_clin.iloc[tr], y[tr])
            oof_clin[val] += lr_clin.predict_proba(X_clin.iloc[val])[:, 1]
        oof_clin /= 5.0

        paired_boot = compute_paired_bootstrap(
            y, oof_cal, oof_clin, n_resamples=1000, seed=RANDOM_SEED
        )

        baseline_table[target] = {
            "selected_model": model_name,
            "cohort_prevalence": {
                "positives": n_pos,
                "total": n_tot,
                "rate": round(prev, 4),
                "formatted": f"{prev * 100:.2f}% ({n_pos} / {n_tot})",
            },
            "trivial_f1": round(trivial_f1, 4),
            "f1_at_default_50": round(f1_50, 4),
            "operating_cutoff": round(sel_t, 4),
            "f1_at_operating_cutoff": round(f1_t, 4),
            "f1_gain_over_trivial": round(f1_delta, 4),
            "balanced_accuracy_at_cutoff": round(bal_acc_t, 4),
            "balanced_accuracy_at_50": round(bal_acc_50, 4),
            "accuracy_at_50": round(acc_50, 4),
            "sensitivity_at_cutoff": round(sens_t, 4),
            "specificity_at_cutoff": round(spec_t, 4),
            "roc_auc": round(float(roc_info["point_estimate"]), 4),
            "roc_auc_ci_95": [
                round(float(roc_info["ci_95"][0]), 4),
                round(float(roc_info["ci_95"][1]), 4),
            ],
            "paired_bootstrap_vs_clinical_lr": paired_boot,
        }

    return baseline_table


def update_metrics_json(
    baseline_table: dict[str, Any], artifacts_dir: Path = Path("artifacts")
) -> None:
    """Save baseline comparison table into artifacts/metrics.json."""
    metrics_path = artifacts_dir / "metrics.json"
    with open(metrics_path, encoding="utf-8") as f:
        metrics_data = json.load(f)

    metrics_data["baseline_comparison_table"] = baseline_table
    for target, row in baseline_table.items():
        if (
            "paired_bootstrap_vs_clinical_lr" in row
            and "targets" in metrics_data
            and target in metrics_data["targets"]
        ):
            t_obj = metrics_data["targets"][target]
            if "baselines" in t_obj and "clinical_subset_lr" in t_obj["baselines"]:
                t_obj["baselines"]["clinical_subset_lr"]["paired_bootstrap"] = row[
                    "paired_bootstrap_vs_clinical_lr"
                ]

    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics_data, f, indent=2)
    logger.info("Updated %s with baseline_comparison_table and paired bootstrap.", metrics_path)


def generate_paired_bootstrap_markdown_table(table: dict[str, Any]) -> str:
    """Generate Markdown table for paired bootstrap vs 6-feature clinical LR baseline."""
    lines = [
        "| Target | Deployed Model | Deployed Calibrated ROC-AUC | Clinical Baseline ROC-AUC (6 features) | Paired $\\Delta$ AUC [95% CI] | Fraction Deployed > Baseline | Significance Assessment |",
        "| :--- | :--- | :---: | :---: | :---: | :---: | :--- |",
    ]
    for target in ["y_cad", "y_lad", "y_lcx", "y_rca"]:
        row = table[target]
        pb = row.get("paired_bootstrap_vs_clinical_lr", {})
        m_name = row["selected_model"]
        dep_auc = f"{pb.get('deployed_roc_auc', row['roc_auc']):.4f}"
        base_auc = f"{pb.get('baseline_roc_auc', 0.0):.4f}"
        ci_str = f"[{pb.get('ci_95', [0.0, 0.0])[0]:.4f}, {pb.get('ci_95', [0.0, 0.0])[1]:.4f}]"
        delta_str = f"**{pb.get('delta_auc', 0.0):+.4f}** {ci_str}"
        frac_str = f"**{pb.get('fraction_deployed_superior', 0.0) * 100:.1f}%**"
        sig_str = (
            "**Statistically superior** (95% CI excludes 0)"
            if pb.get("excludes_zero")
            else "not significantly different (95% CI includes 0)"
        )
        lines.append(
            f"| **`{target}`** | {m_name} | **{dep_auc}** | {base_auc} | {delta_str} | {frac_str} | {sig_str} |"
        )
    return "\n".join(lines)


def generate_markdown_table_model_card(table: dict[str, Any]) -> str:
    """Generate Markdown table for docs/model_card.md."""
    lines = [
        "| Target | Cohort Prevalence | Trivial Baseline $F_1$ (Flag Everyone) | Model $F_1$ @ Default 0.50 | Model Operating Cutoff ($t$) | Model $F_1$ @ Operating Cutoff ($t$) | $F_1$ Gain over Trivial | Balanced Accuracy | ROC-AUC [95% CI] |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]
    for target in ["y_cad", "y_lad", "y_lcx", "y_rca"]:
        row = table[target]
        prev_str = f"**{row['cohort_prevalence']['formatted']}**"
        triv_f1 = f"{row['trivial_f1']:.4f}"
        f1_50 = f"{row['f1_at_default_50']:.4f}"
        cutoff = f"**{row['operating_cutoff']:.4f}**"
        f1_cut = f"**{row['f1_at_operating_cutoff']:.4f}**"
        gain = f"**+{row['f1_gain_over_trivial']:.4f}**"
        bal_acc = f"{row['balanced_accuracy_at_cutoff']:.4f}"
        auc_str = f"**{row['roc_auc']:.4f}** [{row['roc_auc_ci_95'][0]:.4f}, {row['roc_auc_ci_95'][1]:.4f}]"
        lines.append(
            f"| **`{target}`** | {prev_str} | {triv_f1} | {f1_50} | {cutoff} | {f1_cut} | {gain} | {bal_acc} | {auc_str} |"
        )
    return "\n".join(lines)


def generate_markdown_table_eval_report(table: dict[str, Any]) -> str:
    """Generate Markdown table for docs/evaluation_report.md."""
    lines = [
        "| Target | Cohort Prevalence | Trivial Baseline $F_1$ (Flag Everyone) | Model $F_1$ @ Default 0.50 | Model Operating Cutoff ($t$) | Model $F_1$ @ Operating Cutoff ($t$) | $F_1$ Delta vs Trivial | Balanced Accuracy |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]
    for target in ["y_cad", "y_lad", "y_lcx", "y_rca"]:
        row = table[target]
        prev_str = f"**{row['cohort_prevalence']['formatted']}**"
        triv_f1 = f"{row['trivial_f1']:.4f}"
        f1_50 = f"{row['f1_at_default_50']:.4f}"
        cutoff = f"**{row['operating_cutoff']:.4f}**"
        f1_cut = f"**{row['f1_at_operating_cutoff']:.4f}**"
        gain = f"**+{row['f1_gain_over_trivial']:.4f}**"
        bal_acc = f"{row['balanced_accuracy_at_cutoff']:.4f}"
        lines.append(
            f"| **`{target}`** | {prev_str} | {triv_f1} | {f1_50} | {cutoff} | {f1_cut} | {gain} | {bal_acc} |"
        )
    return "\n".join(lines)


def update_docs(table: dict[str, Any], docs_dir: Path = Path("docs")) -> None:
    """Update docs/model_card.md and docs/evaluation_report.md with regenerated tables."""
    # 1. Update model_card.md
    model_card_path = docs_dir / "model_card.md"
    mc_content = model_card_path.read_text(encoding="utf-8")
    mc_table = generate_markdown_table_model_card(table)

    pattern_mc = re.compile(
        r"\| Target \| Cohort Prevalence \| Trivial Baseline \$F_1\$.*?\n\| \*\*`y_rca`\*\*.*?\n",
        re.DOTALL,
    )
    if pattern_mc.search(mc_content):
        mc_content = pattern_mc.sub(mc_table + "\n", mc_content)
    else:
        logger.warning("Could not find table pattern in %s", model_card_path)

    # Update text numbers in model_card.md (e.g. 0.6020 and 0.6070 -> 0.6491 and 0.6341)
    lcx_f1 = table["y_lcx"]["f1_at_operating_cutoff"]
    rca_f1 = table["y_rca"]["f1_at_operating_cutoff"]
    mc_content = mc_content.replace(
        "lifting $F_1$ to $0.6020$ and $0.6070$",
        f"lifting $F_1$ to ${lcx_f1:.4f}$ and ${rca_f1:.4f}$",
    )

    # Add/Update paired bootstrap table in model_card.md
    pb_table = generate_paired_bootstrap_markdown_table(table)
    pattern_mc_pb = re.compile(
        r"\| Target \| Deployed Model \| Deployed Calibrated ROC-AUC.*?\n\| \*\*`y_rca`\*\*.*?\n",
        re.DOTALL,
    )
    if pattern_mc_pb.search(mc_content):
        mc_content = pattern_mc_pb.sub(pb_table + "\n", mc_content)
    else:
        # Append after the first baseline table
        mc_content = mc_content.replace(
            mc_table,
            mc_table + "\n\n#### Paired Bootstrap Comparison vs. 6-Feature Clinical LR Baseline ($B=1000$, seed=42)\n" + pb_table,
        )

    model_card_path.write_text(mc_content, encoding="utf-8")
    logger.info("Updated %s with regenerated baseline and paired bootstrap tables.", model_card_path)

    # 2. Update evaluation_report.md
    eval_report_path = docs_dir / "evaluation_report.md"
    er_content = eval_report_path.read_text(encoding="utf-8")
    er_table = generate_markdown_table_eval_report(table)

    pattern_er = re.compile(
        r"\| Target \| Cohort Prevalence \| Trivial Baseline \$F_1\$.*?\n\| \*\*`y_rca`\*\*.*?\n",
        re.DOTALL,
    )
    if pattern_er.search(er_content):
        er_content = pattern_er.sub(er_table + "\n", er_content)
    else:
        logger.warning("Could not find table pattern in %s", eval_report_path)

    pattern_er_pb = re.compile(
        r"\| Target \| Deployed Model \| Deployed Calibrated ROC-AUC.*?\n\| \*\*`y_rca`\*\*.*?\n",
        re.DOTALL,
    )
    if pattern_er_pb.search(er_content):
        er_content = pattern_er_pb.sub(pb_table + "\n", er_content)
    else:
        er_content = er_content.replace(
            er_table,
            er_table + "\n\n#### Paired Bootstrap Comparison vs. 6-Feature Clinical LR Baseline ($B=1000$, seed=42)\n" + pb_table,
        )

    eval_report_path.write_text(er_content, encoding="utf-8")
    logger.info("Updated %s with regenerated baseline and paired bootstrap tables.", eval_report_path)


def main() -> None:
    """CLI entrypoint to generate baseline table and update docs and artifacts."""
    table = compute_baseline_table()
    update_metrics_json(table)
    update_docs(table)
    print("\nRegenerated Baseline Comparison Table (from out-of-fold calibrated probabilities):")
    print(json.dumps(table, indent=2))


if __name__ == "__main__":
    main()
