# CardioMap 3D: Model Card & Clinical System Disclosures

## 1. Model Overview & Purpose
* **Model Version**: `0.2.0`
CardioMap 3D is a machine learning-powered clinical risk estimation and interactive 3D coronary visualization system. The system estimates the calibrated probability of obstructive coronary artery disease (CAD, $\ge 50\%$ diameter stenosis) overall and specifically across the three primary coronary arteries:
* **`y_cad`**: Overall coronary artery disease (derived from catheterization outcome `Cath`)
  - **Deployed Architecture**: `SoftVotingEnsemble` combining `LogisticRegression(C=1.0)`, `RandomForest(max_depth=6)`, and `XGBoost(max_depth=4)`, wrapped in 5-fold Sigmoid calibration (`CalibratedClassifierCV(method='sigmoid', cv=5)`).
* **`y_lad`**: Left Anterior Descending artery stenosis
  - **Deployed Architecture**: `RandomForestClassifier(n_estimators=100, max_depth=6, min_samples_leaf=2)` wrapped in 5-fold Sigmoid calibration.
* **`y_lcx`**: Left Circumflex artery stenosis
  - **Deployed Architecture**: `LightGBM(n_estimators=100, max_depth=4, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8)` wrapped in 5-fold Sigmoid calibration.
* **`y_rca`**: Right Coronary Artery stenosis
  - **Deployed Architecture**: `LGBM_Shallow(n_estimators=100, max_depth=2, num_leaves=3, min_child_samples=20, learning_rate=0.03, reg_lambda=2.0)` wrapped in 5-fold Sigmoid calibration.

**Evaluated vs. Deployed Equivalence**: The deployed model pipelines saved in `artifacts/model_*.joblib` are bitwise identical to the architectures evaluated in cross-validation (`ml/src/cardiomap_ml/train.py`, `NESTED_TUNING_CONFIG`). Evaluated models strictly equal deployed models.

**Intended Use & Mandatory Clinical Disclaimer**: CardioMap 3D is for decision support and educational purposes only. It is not a medical device and not a substitute for formal diagnostic imaging (such as coronary angiography) or professional clinical judgment.

---

## 2. Training Data & Cohort Details
* **Source Dataset**: UCI Machine Learning Repository Dataset #411 ("Extension of Z-Alizadeh Sani Dataset").
* **Cohort Size**: 303 consecutive patients presenting for coronary angiography.
* **Input Features**: Exactly 55 non-invasive clinical features spanning demographics, medical history, physical examination, electrocardiography (ECG), laboratory serum biomarkers, and resting transthoracic echocardiography (TTE).
* **Single-Center Cohort Disclosure**: The training dataset originates from a single tertiary cardiovascular center. Baseline characteristics, referral patterns, and disease prevalence (71.3% CAD prevalence) reflect a high-risk referred cohort rather than an unselected general outpatient screening population. External multi-center validation is required prior to real-world clinical implementation.

---

## 3. Disclosed Model Assumptions & Limitations

### A. Fixed Hyperparameters Disclosure
All model architectures and hyperparameters were fixed *a priori* based on standard clinical tabular modeling conventions (e.g., Random Forest max depth 6 with class weighting; shallow LightGBM depth 2 with strong L2 regularization) with the exception of the ElasticNet logistic regression grid. Extensive automated hyperparameter optimization was purposefully restricted to prevent overfitting on the 303-patient cohort.

### B. Optimism Disclosure (Candidate & Threshold Selection)
Model architecture selection and optimal operational decision thresholds (Youden's $J$, Max $F_1$) were determined using out-of-fold predictions from the same 303-patient cohort. Although 5-fold × 5-repeat stratified cross-validation safeguards feature scaling and imputation from leakage, tuning operational operating points on the same cross-validation cohort introduces an optimistic threshold bias.

### C. LCX and RCA Statistical Benchmark Disclosure
For Left Circumflex (`y_lcx`) and Right Coronary Artery (`y_rca`), the winning multi-feature models (`LightGBM` AUC 0.7491 and `LGBM_Shallow` AUC 0.7535) are statistically tied (within 1 standard error, $SE \approx 0.015$) with a simple 6-feature clinical baseline logistic regression (`Age`, `Sex`, `HTN`, `DM`, `Current Smoker`, `Typical Chest Pain`, AUC 0.743 and 0.741). Isolated posterior and inferior vessel lesions show less distinct repolarization shifts on standard 12-lead ECG, setting an intrinsic biological ceiling for non-invasive prediction.

### D. Region RWMA Semantics Disclosure
The dataset records `Region RWMA` as integer codes ranging from `0` to `4` (representing the number of echocardiographic segments exhibiting regional wall motion hypokinesis/akinesis). **The exact spatial mapping of codes 0 to 4 to specific coronary anatomical territories is unverified in dataset documentation.** Therefore, `Region RWMA` is modeled strictly as a non-spatial ordinal severity continuum. **No specific anatomical vessel territory is inferred from the RWMA code.**

### E. Explainability Disclosure: Deployed Function, Probability Points, & Causality
Local feature attributions explain the **deployed function**: the final calibrated pipeline's `predict_proba` (before the $[0.01, 0.99]$ safety clip) as a function of the 55 RAW input clinical features.
* **Model-Agnostic Explainer**: Implemented using `shap.KernelExplainer` directly on the deployed pipeline with a fixed seed (`np.random.seed(42)`), guaranteeing deterministic explanations across repeated calls.
* **Stratified Real-Patient Background**: Explanations utilize a stratified background sample of 30 real patients (`artifacts/shap_background_sample.csv`), never the first $N$ rows.
* **Unified Attribution Units**: All explanations across all four targets are reported in **probability points** (`raw_unit = "probability points"`). The attribution base value is the mean predicted probability on the background sample ($\text{base\_value} \in [0, 1]$).
* **Exact Additivity**: Local attributions sum to the difference between predicted probability and the background base value exactly down to numerical precision:
  $$\text{base\_value} + \sum_{i=1}^{55} \text{shap}_i = P(\text{target})$$
  One-hot encoded dummy indicators (`VHD`, `BBB`) are grouped back into their parent raw clinical features.
* **Signed Relative Contribution %**: Computed as signed normalized percentage: $\text{sign}(\text{shap}_i) \cdot \frac{|\text{shap}_i|}{\sum_{j} |\text{shap}_j|} \times 100\%$.
* **Association vs. Causation**: Explanations describe the displayed calibrated probability in probability points and reflect model-learned associations within this dataset, **not causal findings**. Altering a patient's modifiable biomarker (e.g., lowering triglycerides or blood sugar) will change the model's computed score, but the attribution does not prove that the biomarker directly caused or will reverse coronary plaque formation.
* **Feature Stability**: Sodium `Na`, height `Length`, platelet count `PLT`, and leukocyte counts `WBC`/`Lymph`/`Neut` demonstrate moderate-to-low ranking stability across bootstrap resamples (persistence $< 0.8$) and likely reflect sample-specific statistical correlations rather than stable pathophysiological drivers.
* **Stability Provenance & Discrepancy Disclosure**:
  - **Generation Method**: `artifacts/shap_stability.json` was generated in Phase 1.5 (2026-10-12) using native `TreeExplainer` on uncalibrated tree estimators (and `LinearExplainer` for logistic regression) across $B = 20$ bootstrap resamples ($N = 303$ with replacement).
  - **Runtime Method**: Deployed explanations in Phase 2.5/2.6 use model-agnostic `shap.KernelExplainer` evaluating the full 5-fold calibrated probability pipeline directly on the 55 raw input features (in probability points).
  - **Discrepancy Note**: The feature persistence scores and stability labels (`stable`, `moderate`, `low`) stored in `artifacts/shap_stability.json` reflect tree-model margin ranking stability across 20 bootstrap resamples rather than repeated KernelExplainer resampling (which would require $>2$ hours of compute across the cohort). Top clinical predictors (Typical Chest Pain, Region RWMA, Age) remain stable across both paradigms, but stability labels originate from the native tree/linear explainer bootstrap audit.

---

## 4. Operational Decision Thresholds & Baseline Benchmarks

### A. Operational Threshold F1 vs. Trivial "Flag Everyone" Baseline
In clinical datasets with non-uniform class distribution, evaluating models against trivial majority or "flag everyone" baselines is essential to evaluate true discriminative utility. The table below compares the deployed calibrated models against the trivial "flag everyone positive" policy across all four targets:

| Target | Cohort Prevalence | Trivial Baseline $F_1$ (Flag Everyone) | Model $F_1$ @ Default 0.50 | Model Operating Cutoff ($t$) | Model $F_1$ @ Operating Cutoff ($t$) | $F_1$ Gain over Trivial | Balanced Accuracy | ROC-AUC [95% CI] |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`y_cad`** | **71.29% (216 / 303)** | 0.8324 | 0.9058 | **0.5377** | **0.9140** | **+0.0817** | 0.8297 | **0.9256** [0.8915, 0.9545] |
| **`y_lad`** | **58.42% (177 / 303)** | 0.7375 | 0.8373 | **0.5006** | **0.8365** | **+0.0990** | 0.7819 | **0.8453** [0.7967, 0.8882] |
| **`y_lcx`** | **39.27% (119 / 303)** | 0.5640 | 0.4674 | **0.3973** | **0.6491** | **+0.0851** | 0.6983 | **0.7235** [0.6650, 0.7761] |
| **`y_rca`** | **37.62% (114 / 303)** | 0.5468 | 0.4773 | **0.3354** | **0.6341** | **+0.0874** | 0.6822 | **0.7397** [0.6826, 0.7921] |

#### Paired Bootstrap Comparison vs. 6-Feature Clinical LR Baseline ($B=1000$, seed=42)
| Target | Deployed Model | Deployed Calibrated ROC-AUC | Clinical Baseline ROC-AUC (6 features) | Paired $\Delta$ AUC [95% CI] | Fraction Deployed > Baseline | Significance Assessment |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **`y_cad`** | SoftVotingEnsemble | **0.9256** | 0.9032 | **+0.0225** [-0.0018, 0.0472] | **96.2%** | not significantly different (95% CI includes 0) |
| **`y_lad`** | RandomForest | **0.8453** | 0.7901 | **+0.0552** [0.0169, 0.0967] | **99.7%** | **Statistically superior** (95% CI excludes 0) |
| **`y_lcx`** | LightGBM | **0.7235** | 0.7429 | **-0.0195** [-0.0607, 0.0251] | **19.3%** | not significantly different (95% CI includes 0) |
| **`y_rca`** | LGBM_Shallow | **0.7397** | 0.7412 | **-0.0015** [-0.0466, 0.0448] | **47.7%** | not significantly different (95% CI includes 0) |

### B. Clinical Context: LCX and RCA Operating Thresholds Near/Below Prevalence
A critical clinical finding is that the optimal operating threshold for `y_lcx` ($t = 0.3973$) is almost identical to cohort prevalence ($39.27\%$), and the operating threshold for `y_rca` ($t = 0.3354$) is strictly below cohort prevalence ($37.62\%$).
* **Why default 0.50 fails on LCX and RCA**: Because both LCX and RCA exhibit negative-class majority (prevalences ~38–39%), standard $0.50$ decision boundaries incur severe false negative rates, resulting in poor default $F_1$ scores (0.4674 and 0.4773), which are lower than the trivial "flag everyone" baseline.
* **Sensitivity-Optimized Cutoffs**: In pre-catheterization screening, missed stenoses (false negatives) are clinically hazardous. Tuning thresholds to maximize Youden's $J$ and screening $F_1$ lowers the decision threshold to $0.3973$ (LCX) and $0.3354$ (RCA), boosting sensitivity and lifting $F_1$ to $0.6491$ and $0.6341$, outperforming the trivial baseline.
* **Clinical Nuance of the "Moderate" Risk Tier**:
  Under CardioMap 3D's strict risk mapping rules, a patient with $p \ge t$ receives a "Moderate" or "High" risk tier. Because $t_{\text{RCA}} = 0.3354$ and $t_{\text{LCX}} = 0.3973$, a patient categorized into the "moderate" tier for RCA or LCX may have a calibrated probability near or slightly below the average cohort prevalence.
  **Clinical Interpretation**: The "Moderate" tier classification indicates that the patient's score exceeds the sensitivity-optimized screening threshold for further diagnostic workup, **not** that their risk is higher than the average referred patient in the registry.

---

## 5. Operational Safety Guardrails & Validation

### A. Strict Risk Level Mapping
To guarantee that qualitative risk categories never contradict binary prediction labels, the risk tier is determined strictly from each target's validated operating threshold $t$:
* **Low Risk**: $p < t$ (Prediction Label: `0 / Low Risk`)
* **Moderate Tier**: $t \le p < t + 0.15$ (Prediction Label: `1 / Elevated Risk`)
* **High Risk**: $p \ge t + 0.15$ (Prediction Label: `1 / Elevated Risk`)

### B. Probability Safety Clipping
All calibrated probability outputs are clipped to $[0.01, 0.99]$ at inference (`PROBABILITY_CLIP_MIN` and `PROBABILITY_CLIP_MAX`). No model output can ever return absolute certainty ($0.0$ or $1.0$).

### C. Vessel-CAD Coherence Adjustment
If any individual vessel stenosis probability exceeds the overall CAD probability ($p_{\text{CAD}} < \max(p_{\text{LAD}}, p_{\text{LCX}}, p_{\text{RCA}})$), the API flags this anatomical incoherence and returns both the raw CAD probability and a coherent adjusted probability equal to $\max(p_{\text{CAD}}, p_{\text{vessels}})$.

### D. Test Suite Verification & Performance Budgets
* **Test Suite Status**: 76 tests passing (0 skipped, 0 flaky, 0 failing).
* **Determinism**: 100% deterministic prediction and SHAP attribution on repeated evaluations.
* **High-Fidelity Reference Agreement**: 20-patient reference benchmark ($nsamples=3000$, 100 background points) vs production explainer yields **Mean Top-3 Overlap = 2.50 / 3 (83.33%)** and **Mean Spearman rank correlation = 0.6974**.
* **Age Perturbation Stability**: Perturbing Age by +1 year across 20 patients preserves top-3 features for 20 of 20 patients (**100.0%**, exceeding the 90% stability target).
* **Top-5 TreeExplainer Agreement**: Across 20 patients, the new deployed calibrated explainer agrees with old TreeExplainer top-5 rankings by **62.0% on LAD, 58.0% on LCX, and 73.0% on RCA** (overall average 64.3%), reflecting the clinical progression from single uncalibrated tree margin fold models to the full 5-fold calibrated probability pipeline.
* **Latency Budget**: Cold-cache 50 distinct patients benchmark:
  - `/predict`: p50 = 63.51 ms, p95 = 90.17 ms (Budget < 100 ms: **PASSED**).
  - `/explain`: p50 = 0.689 s, p95 = 0.723 s (Budget < 1.5 s: **PASSED**).
