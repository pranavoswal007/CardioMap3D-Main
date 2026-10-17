# CardioMap 3D Artifacts & Reproducibility Guide

This document describes all machine learning model artifacts, evaluation outputs, reference background datasets, and static diagnostic plots stored in `artifacts/`.

---

## 1. Summary of Artifacts

Total directory footprint: **~8.8 MB** (all individual files $< 3.5\text{ MB}$, well below the 50 MB Git limit).

| Artifact File | Size | Role | Runtime Required? | Generation Source |
| :--- | :--- | :--- | :---: | :--- |
| `model_y_cad.joblib` | 3.2 MB | Overall CAD calibrated pipeline | **Yes** (`/predict`, `/explain`) | `make train` (`seed=42`) |
| `model_y_lad.joblib` | 2.6 MB | LAD stenosis calibrated pipeline | **Yes** (`/predict`, `/explain`) | `make train` (`seed=42`) |
| `model_y_lcx.joblib` | 618 KB | LCX stenosis calibrated pipeline | **Yes** (`/predict`, `/explain`) | `make train` (`seed=42`) |
| `model_y_rca.joblib` | 331 KB | RCA stenosis calibrated pipeline | **Yes** (`/predict`, `/explain`) | `make train` (`seed=42`) |
| `feature_schema.json` | 14 KB | 55-feature clinical input schema | **Yes** (`/schema`, `/predict`, `/explain`) | `ml/config/feature_schema.json` |
| `thresholds.json` | 4.3 KB | Operating cutoffs & tradeoff curves | **Yes** (`/schema`, `/predict`) | `make train` (`seed=42`) |
| `metrics.json` | 117 KB | CV metrics, candidate models, baseline table | **Yes** (`/metrics`) | `make train` + `make metrics-table` |
| `shap_background_sample.csv` | 5.3 KB | Stratified 30-patient background sample | **Yes** (`/explain`) | `make train` (`seed=42`) |
| `shap_background_sample.joblib` | 17 KB | Joblib background serialization | Test suite | `make train` (`seed=42`) |
| `shap_reference_20_patients.joblib` | 18 KB | Reference attributions for fidelity tests | Test suite | `make train` (`seed=42`) |
| `shap_stability.json` | 26 KB | Bootstrap feature ranking persistence | **Yes** (`/explain`) | Phase 1.5 bootstrap refits ($B=20$) |
| `shap_global.json` | 37 KB | Cohort-level SHAP importance | Documentation | `make train` (`seed=42`) |
| `curves_y_cad.png` | 203 KB | ROC, PR, calibration curves (CAD) | **Yes** (Static plot) | `make train` (`seed=42`) |
| `curves_y_lad.png` | 207 KB | ROC, PR, calibration curves (LAD) | **Yes** (Static plot) | `make train` (`seed=42`) |
| `curves_y_lcx.png` | 203 KB | ROC, PR, calibration curves (LCX) | **Yes** (Static plot) | `make train` (`seed=42`) |
| `curves_y_rca.png` | 205 KB | ROC, PR, calibration curves (RCA) | **Yes** (Static plot) | `make train` (`seed=42`) |

---

## 2. Artifact Provenance & How to Regenerate

All primary model and evaluation artifacts can be regenerated from source with fixed random seed 42:

```bash
# 1. Execute reproducible ML training pipeline
make train

# 2. Recompute exact baseline comparison table and update documentation
make metrics-table

# 3. Verify artifact integrity and cutoff consistency across models and schema
make verify-artifacts
```

### Reproducibility Parameters
- **Random Seed**: `42` (`RANDOM_SEED` in `ml/src/cardiomap_ml/config.py`).
- **Data Source**: UCI ML Repository Dataset #411 ("Extension of Z-Alizadeh Sani Dataset", 303 patients, 55 features).
- **CV Protocol**: Repeated Stratified K-Fold ($5 \times 5$, 25 outer evaluations) with inner 3-fold cross-validation for hyperparameter tuning.
- **Probability Calibration**: 5-fold Sigmoid wrapper (`CalibratedClassifierCV(method='sigmoid', cv=5)`).
- **Safety Clipping**: Strict probability bounds $[0.01, 0.99]$.
- **SHAP Explanation Protocol**: Model-agnostic `shap.KernelExplainer` evaluating the calibrated pipeline on the stratified 30-patient background sample in probability points ($N_{\text{samples}} = 150$).

---

## 3. Runtime vs. Disposable Files

### Tracked Runtime Dependencies
All files listed in Section 1 are tracked in git to allow the repository to run immediately upon cloning without requiring an upfront training phase.

### Disposable Checkpoints (Ignored in `.gitignore`)
Temporary checkpoints, uncalibrated prototype dumps, and non-essential binary formats remain ignored:
- `artifacts/*.onnx`
- `artifacts/*.pkl`
- `artifacts/tmp_*`
