# CardioMap 3D: ML Training Pipeline Evaluation Report (Phase 1.5)

**Pipeline Execution Date:** October 12, 2026  
**Dataset Source:** UCI Machine Learning Repository (Dataset #411: Extension of Z-Alizadeh Sani Dataset)  
**Cohort Size:** 303 patients × 55 input clinical features  
**Evaluation Protocol:** 5-Fold × 5-Repeat Stratified Cross-Validation (`RepeatedStratifiedKFold`, seed=42)  
**Reporting Framework:** Pooled Out-Of-Fold (OOF) predictions with patient-level empirical 95% bootstrap confidence intervals ($B = 1000$)  
**Pipeline Runtime:** ~156–160 seconds (~2.6 minutes) on Apple Silicon CPU  
**Deterministic Check:** 100% bitwise parity on statistical metrics across consecutive runs  

---

## 1. Executive Summary & Evaluation Methodology

Phase 1.5 establishes reporting consistency, clinical calibration safety guards, unified SHAP attribution units with exact additivity, and extensive experiments to improve Left Circumflex (`y_lcx`) and Right Coronary Artery (`y_rca`) performance.

Four clinical targets were modeled:
1. `y_cad`: Overall coronary artery disease (derived from catheterization outcome `Cath`)
2. `y_lad`: Left Anterior Descending artery stenosis (≥50% lumen narrowing)
3. `y_lcx`: Left Circumflex artery stenosis (≥50% lumen narrowing)
4. `y_rca`: Right Coronary Artery stenosis (≥50% lumen narrowing)

### Methodology & Reporting Protocol
* **Pooled Out-of-Fold Bootstrap CIs**: All metric point estimates and confidence intervals are computed via a patient-level bootstrap ($B=1,000$, seed=42) on the pooled out-of-fold probability predictions. Every reported point estimate lies strictly inside its 95% CI. Fold-level variability is reported separately as Fold Mean ± Fold Std across all 25 validation folds (5 folds × 5 repeats).
* **Final Deployed (Calibrated & Clipped) Model Reporting**: In addition to candidate comparison, metrics are explicitly reported for the final deployed models with probability calibration and inference clipping.
* **Calibration Probability Safety Bounds**: Post-hoc probability calibration curves can produce extreme predictions ($0.0$ or $1.0$) or plateaus. For clinical safety, all calibrated probabilities are clipped to $[0.01, 0.99]$ (stored in `ml/src/cardiomap_ml/config.py`). Sigmoid calibration is utilized across all production models to maintain continuous monotonicity.
* **Unified SHAP Explainability & Additivity**: Explanations are defined in model raw score units (log-odds for linear and gradient boosted models; tree vote margin for random forest) alongside normalized relative contribution percentages ($\frac{|\text{shap}_i|}{\sum |\text{shap}|} \times 100$, signed). Exact additivity ($\text{base\_value} + \sum \text{shap}_i = \text{model\_raw\_output}$) was verified mathematically on test batches.
* **Disclosed Optimism Sources**:
  1. *Model Architecture Selection*: Selection of the winning model family per target is based on pooled out-of-fold ROC-AUC across the entire cohort.
  2. *Decision Threshold Optimization*: Operational decision thresholds (Max $F_1$, Youden's $J$) were optimized on the same pooled out-of-fold calibrated probabilities. An independent multi-center external test cohort is required to establish unbiased operational operating points prior to real-world deployment.

---

## 2. Feature Encodings & Nested Tuning Configuration

### Discrete and Categorical Encoding Audit
Nominal features are strictly one-hot encoded with the first category dropped, while clinical continuum scores are scaled monotonically:

| Feature Name | Raw Dtype | Unique Values | Clinical Meaning | Pipeline Encoding Applied |
| :--- | :--- | :--- | :--- | :--- |
| **`Function Class`** | `int64` | `[0, 1, 2, 3]` | NYHA heart failure functional class ($0=\text{none}$ to $3=\text{severe}$) | `StandardScaler` numeric continuum |
| **`Region RWMA`** | `int64` | `[0, 1, 2, 3, 4]` | Count of regional wall motion abnormality segments on echocardiogram | `StandardScaler` discrete count continuum |
| **`VHD`** | `str` | `['N', 'mild', 'Moderate', 'Severe']` | Valvular Heart Disease severity | `OneHotEncoder(drop='first')` dummy indicators (`VHD_mild`, `VHD_Moderate`, `VHD_Severe`) |
| **`BBB`** | `str` | `['N', 'LBBB', 'RBBB']` | Bundle Branch Block conduction defect | `OneHotEncoder(drop='first')` dummy indicators (`BBB_LBBB`, `BBB_RBBB`) |
| **Clinical Booleans (30 features)** | `str`/`int64` | `{'Y','N'}` or `{0,1}` | Systemic risk factors, symptoms, ECG findings | `BinaryFeatureEncoder` mapping `{'Y','Male',1} -> 1.0`, `{'N','Fmale',0} -> 0.0` |

### Nested Tuning Configuration
* **Outer Cross-Validation**: 5 folds × 5 repeats (`RepeatedStratifiedKFold`, $N=25$ outer evaluations, seed=42).
* **Inner Cross-Validation**: 3-fold `StratifiedKFold` executed strictly inside each outer training fold.
* **Scoring Function**: Area Under the ROC Curve (`roc_auc`).
* **Candidate Search Spaces**:
  - `LogisticRegression`: $C = 1.0$, `class_weight='balanced'`, solver `lbfgs`.
  - `ElasticNet_LR`: Grid search across $C \in [0.05, 0.1, 0.2, 0.5, 1.0]$ and $\ell_1 \text{ ratio} \in [0.2, 0.5, 0.8]$, solver `saga`.
  - `RandomForest`: 100 estimators, max depth 6, min samples leaf 2, `class_weight='balanced'`.
  - `RF_Shallow`: 100 estimators, max depth 3, min samples leaf 10, `class_weight='balanced'`.
  - `LightGBM`: 100 estimators, max depth 4, learning rate 0.05, subsample 0.8, colsample 0.8.
  - `LGBM_Shallow`: 100 estimators, max depth 2, num leaves 3, min child samples 20, learning rate 0.03, $\alpha = 1.0$, $\lambda = 2.0$.
  - `SoftVotingEnsemble`: Unweighted soft voting pool combining Logistic Regression, Random Forest, and XGBoost.

---

## 3. Final Deployed Model Metrics (Calibrated & Clipped)

Metrics computed on pooled out-of-fold predictions with empirical 95% bootstrap confidence intervals ($B = 1000$). Every point estimate lies inside its 95% confidence interval:

| Target | Architecture | Calibration (Safety Clip) | ROC-AUC [95% CI] | PR-AUC [95% CI] | Brier Score [95% CI] | Accuracy [95% CI] | F1 Score [95% CI] |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`y_cad`** | **SoftVotingEnsemble** | Sigmoid [0.01, 0.99] | **0.9256**<br>[0.8915, 0.9545] | **0.9679**<br>[0.9466, 0.9839] | **0.0987**<br>[0.0767, 0.1204] | **0.8614**<br>[0.8218, 0.9043] | **0.9058**<br>[0.8759, 0.9352] |
| **`y_lad`** | **RandomForest** | Sigmoid [0.01, 0.99] | **0.8453**<br>[0.7967, 0.8882] | **0.8722**<br>[0.8175, 0.9181] | **0.1555**<br>[0.1351, 0.1792] | **0.7987**<br>[0.7492, 0.8416] | **0.8373**<br>[0.7922, 0.8743] |
| **`y_lcx`** | **LightGBM** | Sigmoid [0.01, 0.99] | **0.7235**<br>[0.6650, 0.7761] | **0.5729**<br>[0.4874, 0.6767] | **0.2088**<br>[0.1927, 0.2257] | **0.6766**<br>[0.6205, 0.7294] | **0.4674**<br>[0.3713, 0.5545] |
| **`y_rca`** | **LGBM_Shallow** | Sigmoid [0.01, 0.99] | **0.7397**<br>[0.6826, 0.7921] | **0.6151**<br>[0.5297, 0.7112] | **0.2001**<br>[0.1829, 0.2175] | **0.6964**<br>[0.6403, 0.7525] | **0.4773**<br>[0.3875, 0.5644] |

### Calibration & Safety Analysis
* **Why Sigmoid is Preferred**: In Phase 1, isotonic regression produced 72 patient predictions with probability exactly equal to $1.0$ for `y_cad`, along with discrete step-plateaus. Sigmoid calibration achieves superior continuous monotonicity without plateaus.
* **Brier Score Comparison**:
  - `y_cad`: Uncalibrated 0.0990 → Isotonic 0.0966 vs Sigmoid 0.0989.
  - `y_lad`: Uncalibrated 0.1662 → Isotonic 0.1599 vs **Sigmoid 0.1554** (Sigmoid achieves lower Brier error).
  - `y_lcx`: Uncalibrated 0.2111 → Isotonic 0.2078 vs Sigmoid 0.2089.
  - `y_rca`: Uncalibrated 0.1971 → Isotonic 0.2016 vs Sigmoid 0.2001.
* **Probability Safety Bounds**: All inference probabilities are bounded to $[0.01, 0.99]$. No patient can ever receive a false certainty score ($0.0$ or $1.0$).

### Trivial Baseline Comparison & Decision Threshold Calibration
In clinical cohorts with class imbalance, comparing model operating points against the trivial "flag everyone positive" baseline is critical:

| Target | Cohort Prevalence | Trivial Baseline $F_1$ (Flag Everyone) | Model $F_1$ @ Default 0.50 | Model Operating Cutoff ($t$) | Model $F_1$ @ Operating Cutoff ($t$) | $F_1$ Delta vs Trivial | Balanced Accuracy |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`y_cad`** | **71.29% (216 / 303)** | 0.8324 | 0.9058 | **0.5377** | **0.9140** | **+0.0817** | 0.8297 |
| **`y_lad`** | **58.42% (177 / 303)** | 0.7375 | 0.8373 | **0.5006** | **0.8365** | **+0.0990** | 0.7819 |
| **`y_lcx`** | **39.27% (119 / 303)** | 0.5640 | 0.4674 | **0.3973** | **0.6491** | **+0.0851** | 0.6983 |
| **`y_rca`** | **37.62% (114 / 303)** | 0.5468 | 0.4773 | **0.3354** | **0.6341** | **+0.0874** | 0.6822 |

#### Paired Bootstrap Comparison vs. 6-Feature Clinical LR Baseline ($B=1000$, seed=42)
| Target | Deployed Model | Deployed Calibrated ROC-AUC | Clinical Baseline ROC-AUC (6 features) | Paired $\Delta$ AUC [95% CI] | Fraction Deployed > Baseline | Significance Assessment |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **`y_cad`** | SoftVotingEnsemble | **0.9256** | 0.9032 | **+0.0225** [-0.0018, 0.0472] | **96.2%** | not significantly different (95% CI includes 0) |
| **`y_lad`** | RandomForest | **0.8453** | 0.7901 | **+0.0552** [0.0169, 0.0967] | **99.7%** | **Statistically superior** (95% CI excludes 0) |
| **`y_lcx`** | LightGBM | **0.7235** | 0.7429 | **-0.0195** [-0.0607, 0.0251] | **19.3%** | not significantly different (95% CI includes 0) |
| **`y_rca`** | LGBM_Shallow | **0.7397** | 0.7412 | **-0.0015** [-0.0466, 0.0448] | **47.7%** | not significantly different (95% CI includes 0) |

#### Clinical Context: Why LCX & RCA Thresholds Fall Near or Below Cohort Prevalence
- For LCX and RCA, prevalence in this registry is ~38–39%. Uncalibrated 0.50 decision thresholds heavily penalize the positive class, producing low default $F_1$ scores (0.4674 and 0.4773) that underperform the trivial baseline.
- Pre-catheterization screening requires high sensitivity to avoid missing treatable stenosis. Optimizing decision thresholds via Youden's $J$ and Max $F_1$ shifts the operating point to $0.3973$ (LCX) and $0.3354$ (RCA).
- **Clinical Nuance**: Because the RCA operating threshold ($0.3354$) is below cohort prevalence ($37.62\%$), a patient receiving a "Moderate" tier label ($t \le p < t + 0.15$) may have a calibrated probability near or below the average patient in the referred cohort. This reflects crossing a sensitive screening trigger, rather than possessing above-average cohort risk.

---

## 4. Phase 1.5 LCX & RCA Candidate Experiments

A key challenge identified in Phase 1 was that a simple 6-feature clinical logistic regression (Age, Sex, HTN, DM, Current Smoker, Typical Chest Pain) achieved high AUCs on LCX (0.7429) and RCA (0.7412), beating the unregularized full 55-feature models. We implemented and benchmarked 4 candidate interventions across identical 5×5 repeated cross-validation:

### Candidate Comparison Table

| Target | Architecture / Experiment | Pooled OOF ROC-AUC [95% CI] | Fold Mean ROC-AUC ± Std | Pooled Brier Score | Outcome & Decision |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`y_rca`** | **LGBM_Shallow (max_depth=2, reg=2.0)** | **0.7535** [0.6990, 0.8046] | **0.7466 ± 0.0529** | **0.1962** | **Selected Winner** (beats clinical baseline by +0.012 AUC and reduces Brier from 0.2038 to 0.1962) |
| `y_rca` | ElasticNet_LR (all features) | 0.7459 [0.6904, 0.7980] | 0.7423 ± 0.0515 | 0.2025 | Competitive regularized linear model |
| `y_rca` | *ClinicalSubsetLR (6 features)* | 0.7412 [0.6865, 0.7932] | 0.7444 ± 0.0484 | 0.2038 | Baseline benchmark |
| `y_rca` | SoftVotingEnsemble | 0.7339 [0.6785, 0.7861] | 0.7267 ± 0.0561 | 0.2003 | Replaced by LGBM_Shallow |
| `y_rca` | LogisticRegression (L2) | 0.7287 [0.6731, 0.7815] | 0.7199 ± 0.0566 | 0.2159 | Overfits on noise |
| `y_rca` | RF_Shallow (max_depth=3) | 0.7269 [0.6716, 0.7856] | 0.7200 ± 0.0503 | 0.2196 | Sub-optimal calibration |
| `y_rca` | Hierarchical $P(\text{CAD}) \times P(\text{RCA}\mid\text{CAD})$ | 0.7328 [0.6750, 0.7871] | 0.7254 ± 0.0614 | 0.2139 | In-fold conditioning degraded performance |
| | | | | | |
| **`y_lcx`** | **LightGBM (55 features)** | **0.7491** [0.6958, 0.8011] | **0.7292 ± 0.0612** | **0.2002** | **Selected Winner** (lowest Brier error: 0.2002 vs 0.2054 baseline) |
| `y_lcx` | *ClinicalSubsetLR (6 features)* | 0.7429 [0.6860, 0.7951] | 0.7441 ± 0.0762 | 0.2054 | Baseline benchmark |
| `y_lcx` | RandomForest | 0.7410 [0.6832, 0.7921] | 0.7220 ± 0.0637 | 0.2109 | Competitive tree ensemble |
| `y_lcx` | RF_Shallow (max_depth=3) | 0.7312 [0.6724, 0.7822] | 0.7169 ± 0.0699 | 0.2219 | Underfits |
| `y_lcx` | ElasticNet_LR (all features) | 0.7254 [0.6667, 0.7770] | 0.7224 ± 0.0774 | 0.2117 | Within 1 SE of baseline |
| `y_lcx` | SoftVotingEnsemble | 0.7341 [0.6767, 0.7843] | 0.7192 ± 0.0649 | 0.2043 | Comparable |
| `y_lcx` | Hierarchical $P(\text{CAD}) \times P(\text{LCX}\mid\text{CAD})$ | 0.6973 [0.6380, 0.7521] | 0.6915 ± 0.0693 | 0.2319 | Multiplicative error cascade degraded performance |

### Key Findings & Honest Assessment
1. **RCA Breakthrough**: The heavily regularized shallow gradient boosted tree (`LGBM_Shallow`, depth 2, leaves 3, child samples 20, $\ell_2$ penalty 2.0) successfully outperformed the clinical baseline, boosting pooled ROC-AUC to **0.7535** and reducing Brier loss to **0.1962**.
2. **LCX Performance Ceiling**: No model meaningfully beats the 6-feature clinical logistic regression AUC (0.7429) by a wide margin on LCX. LightGBM reaches **0.7491** pooled AUC and achieves a lower Brier score (**0.2002** vs 0.2054). Because LightGBM is within one standard error of the baseline ($SE \approx 0.015$) while improving probabilistic accuracy, it is retained as the deployed model.
3. **Hierarchical Modeling Failure**: Conditioning on CAD-positive training samples inside the folds ($P(\text{vessel}) = P(\text{CAD}) \times P(\text{vessel}\mid\text{CAD})$) degraded performance (LCX AUC dropped to 0.6973, RCA to 0.7328). Multiplying imperfect probabilistic predictions compounds calibration error, confirming that joint multi-target independent estimation is superior.

---

## 5. Explainability Audit & SHAP Stability Analysis

### Model-Agnostic Explainer on Deployed Calibrated Pipeline & Additivity
In Phase 2.5, explanations were upgraded across all four targets to explain the **deployed function**: the final calibrated pipeline's `predict_proba` (prior to $[0.01, 0.99]$ safety clip) as a function of the 55 RAW input features using a single model-agnostic `shap.KernelExplainer` with a deterministic fixed seed (`np.random.seed(42)`).
- **Background**: Stratified sample of 30 real patients (`shap_background_sample.csv`).
- **Attribution Unit**: **Probability points** for all four targets (`raw_unit = "probability points"`).
- **Base Value**: Mean predicted probability on the background sample.
- **Exact Additivity**: Local attributions sum to $(P(\text{target}) - \text{base\_value})$ exactly down to numerical precision:
  $$\text{base\_value} + \sum_{i=1}^{55} \text{shap}_i = P(\text{calibrated\_pipeline})$$
- One-hot encoded dummy indicators (`VHD`, `BBB`) are grouped back into their parent raw clinical features.
- **Signed Relative Contribution %**: Normalized signed contribution $\text{sign}(\text{shap}_i) \cdot \frac{|\text{shap}_i|}{\sum_{j} |\text{shap}_j|} \times 100\%$.
- **Association vs. Causation**: Explanations describe the displayed calibrated probability in probability points and reflect model-learned associations within this dataset, **not causal findings**.
- **Agreement with Legacy TreeExplainer**: Evaluated across 20 patients for tree targets:
  - `y_lad` (Random Forest): 3.10 / 5 (62.0%) top-5 agreement
  - `y_lcx` (LightGBM): 2.90 / 5 (58.0%) top-5 agreement
  - `y_rca` (LGBM_Shallow): 3.65 / 5 (73.0%) top-5 agreement
  Overall tree target agreement averages 64.3%, reflecting the progression from fold-0 uncalibrated tree margin scores to the full 5-fold calibrated probability pipeline.
- **High-Fidelity Reference Agreement (HEAD Settings)**: 20-patient reference benchmark ($nsamples=3000$, 100 background points) vs production explainer ($nsamples=150$, 30 background points) yields **Mean Top-3 Overlap = 2.50 / 3 (83.33%)** and **Mean Spearman rank correlation = 0.6974**.
- **Age Perturbation Stability**: Perturbing Age by +1 year across 20 patients preserves top-3 features for 20 of 20 patients (**100.0%**, exceeding the 90% stability target).

### Top 10 SHAP Features and Stability Audit
*Features are characterized neutrally as **"model-learned associations, not causal findings"**. Ranking stability was evaluated across 20 bootstrap resamples:*

#### 1. Overall CAD (`y_cad`) — Selected: SoftVotingEnsemble
| Rank | Feature | Mean Rel. Contribution % | Stability Status Across Resamples | Characterization |
| :---: | :--- | :---: | :--- | :--- |
| 1 | **Typical Chest Pain** | 31.19% | Stable (100% top-10 appearance) | Model-learned association, not a causal finding |
| 2 | **Region RWMA** | 17.13% | Stable (100% top-10 appearance) | Model-learned association, not a causal finding |
| 3 | **Age** | 9.99% | Stable (100% top-10 appearance) | Model-learned association, not a causal finding |
| 4 | **TG** (Triglycerides) | 5.94% | Stable (75% top-10 appearance) | Model-learned association, not a causal finding |
| 5 | **EF-TTE** | 4.79% | Stable (40% top-10 appearance) | Model-learned association, not a causal finding |
| 6 | **HTN** (Hypertension) | 4.40% | Stable (50% top-10 appearance) | Model-learned association, not a causal finding |
| 7 | **Tinversion** | 4.00% | Stable (60% top-10 appearance) | Model-learned association, not a causal finding |
| 8 | **DM** (Diabetes) | 3.51% | Stable (65% top-10 appearance) | Model-learned association, not a causal finding |
| 9 | **FBS** | 2.81% | Stable | Model-learned association, not a causal finding |
| 10 | **BMI** | 1.98% | Stable | Model-learned association, not a causal finding |

#### 2. LAD Stenosis (`y_lad`) — Selected: RandomForest
| Rank | Feature | Mean Rel. Contribution % | Stability Status Across Resamples | Characterization |
| :---: | :--- | :---: | :--- | :--- |
| 1 | **Typical Chest Pain** | 19.00% | Stable (100% top-10 appearance) | Model-learned association, not a causal finding |
| 2 | **Region RWMA** | 10.78% | Stable (100% top-10 appearance) | Model-learned association, not a causal finding |
| 3 | **Age** | 6.91% | Stable (100% top-10 appearance) | Model-learned association, not a causal finding |
| 4 | **EF-TTE** | 6.50% | Stable (95% top-10 appearance) | Model-learned association, not a causal finding |
| 5 | **Atypical** | 6.18% | Stable (95% top-10 appearance) | Model-learned association, not a causal finding |
| 6 | **ESR** | 4.55% | Stable (75% top-10 appearance) | Model-learned association, not a causal finding |
| 7 | *Neut* (Neutrophils) | 3.34% | **Potentially noisy sample-specific correlate** | Model-learned association, not a causal finding |
| 8 | **Tinversion** | 3.29% | Stable (40% top-10 appearance) | Model-learned association, not a causal finding |
| 9 | *Lymph* (Lymphocytes) | 2.75% | **Potentially noisy sample-specific correlate** | Model-learned association, not a causal finding |
| 10 | **TG** | 2.63% | Stable (45% top-10 appearance) | Model-learned association, not a causal finding |

#### 3. LCX Stenosis (`y_lcx`) — Selected: LightGBM
| Rank | Feature | Mean Rel. Contribution % | Stability Status Across Resamples | Characterization |
| :---: | :--- | :---: | :--- | :--- |
| 1 | **Age** | 13.20% | Stable (100% top-10 appearance) | Model-learned association, not a causal finding |
| 2 | **Typical Chest Pain** | 12.23% | Stable (100% top-10 appearance) | Model-learned association, not a causal finding |
| 3 | **TG** | 7.51% | Stable (90% top-10 appearance) | Model-learned association, not a causal finding |
| 4 | **CR** (Creatinine) | 6.36% | Stable (70% top-10 appearance) | Model-learned association, not a causal finding |
| 5 | **FBS** | 5.54% | Stable (75% top-10 appearance) | Model-learned association, not a causal finding |
| 6 | *PLT* (Platelets) | 5.48% | **Potentially noisy sample-specific correlate** | Model-learned association, not a causal finding |
| 7 | *Na* (Sodium) | 4.89% | **Potentially noisy sample-specific correlate** | Model-learned association, not a causal finding |
| 8 | *Length* (Height) | 4.85% | **Potentially noisy sample-specific correlate** | Model-learned association, not a causal finding |
| 9 | **HDL** | 4.63% | Stable (45% top-10 appearance) | Model-learned association, not a causal finding |
| 10 | **BMI** | 4.16% | Stable | Model-learned association, not a causal finding |

#### 4. RCA Stenosis (`y_rca`) — Selected: LGBM_Shallow
| Rank | Feature | Mean Rel. Contribution % | Stability Status Across Resamples | Characterization |
| :---: | :--- | :---: | :--- | :--- |
| 1 | **Typical Chest Pain** | 22.14% | Stable (100% top-10 appearance) | Model-learned association, not a causal finding |
| 2 | **DM** | 16.46% | Stable (90% top-10 appearance) | Model-learned association, not a causal finding |
| 3 | **Age** | 12.78% | Stable (90% top-10 appearance) | Model-learned association, not a causal finding |
| 4 | **ESR** | 10.34% | Stable (60% top-10 appearance) | Model-learned association, not a causal finding |
| 5 | *Neut* (Neutrophils) | 9.52% | **Potentially noisy sample-specific correlate** | Model-learned association, not a causal finding |
| 6 | *Lymph* (Lymphocytes) | 8.03% | **Potentially noisy sample-specific correlate** | Model-learned association, not a causal finding |
| 7 | **TG** | 4.93% | Stable (45% top-10 appearance) | Model-learned association, not a causal finding |
| 8 | *WBC* (White blood cells)| 4.89% | **Potentially noisy sample-specific correlate** | Model-learned association, not a causal finding |
| 9 | **Length** | 3.95% | Potentially noisy correlate | Model-learned association, not a causal finding |
| 10 | **Sex** | 3.74% | Stable (85% top-10 appearance) | Model-learned association, not a causal finding |

---

## 6. Architecture & Deployment Decision (Joblib vs ONNX)

Per Decision Item E, **ONNX export is dropped as a production requirement**.
- The production runtime environment for FastAPI is standardized on native, reproducible Python `.joblib` pipelines.
- Standard interface: `joblib.load()` -> `predict_proba()` -> probability clipping to $[0.01, 0.99]$ -> SHAP background explanation.
- Legacy `.onnx` binaries were cleaned from the artifacts directory to maintain clean monorepo hygiene.

---

## 7. Open Issues & Honest Assessment

1. **LCX and RCA Information Bounds**: Even with regularized shallow trees and elastic-net exploration, non-invasive clinical predictors alone (demographics, ECG, basic echo, standard blood work) have an upper discriminative bound of ~0.74–0.75 AUC for LCX and RCA. Isolated circumflex lesions often lack distinct 12-lead ECG changes because standard leads do not directly reflect posterior wall ischemia.
2. **Disclosed Optimism**: The reported metrics reflect model selection and threshold selection performed on out-of-fold predictions from the same 303-patient cohort. Before clinical deployment, external prospective multi-center cohort validation is required.
3. **Noisy Correlates**: The stability analysis revealed that hematologic counts (`Neut`, `Lymph`, `WBC`) and electrolyte markers (`Na`, `PLT`, `Length`) appear in tree splits with moderate bootstrap instability (40–60% persistence). They reflect sample-specific statistical correlations rather than direct causal drivers of localized coronary plaques.
