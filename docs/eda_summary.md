# CardioMap 3D: Exploratory Data Analysis (EDA) Summary

## 1. Dataset Dimensions & Quality
- **File**: `data/raw/z_alizadeh_sani_extension.xlsx` (Sheet 1 - Table 1)
- **Observations**: 303 consecutive patients undergoing elective or urgent invasive coronary angiography
- **Total Variables**: 59 columns (55 feature predictors, 4 ground-truth catheterization labels)
- **Completeness**: **0 missing cells** across all 303 rows and 59 columns. Clean data curation from clinical registries.
- **Constant Predictor**: `Exertional CP` has a single unique value (`'N'`) across all 303 observations; zero-variance features are handled seamlessly by preprocessing pipelines.

---

## 2. Target Distribution & Class Balance

Coronary angiography reveals substantial multi-vessel disease burden in this referral cohort:

| Target Variable | Clinical Target Description | Positive Count ($n$) | Negative Count ($n$) | Prevalence (%) | Class Imbalance Ratio (Neg:Pos) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`y_cad`** (`Cath`) | Overall Significant CAD ($\ge 50\%$ stenosis) | 216 | 87 | **71.29%** | 0.40 : 1 |
| **`y_lad`** (`LAD`) | Left Anterior Descending Artery | 177 | 126 | **58.42%** | 0.71 : 1 |
| **`y_lcx`** (`LCX`) | Left Circumflex Artery | 119 | 184 | **39.27%** | 1.55 : 1 |
| **`y_rca`** (`RCA`) | Right Coronary Artery | 114 | 189 | **37.62%** | 1.66 : 1 |

### Target Invariant & Cross-Vessel Consistency Check
- In clinical logic, any patient with $\ge 1$ stenotic coronary vessel must be classified as having CAD (`y_cad == 1`).
- **Audit Result**:
  - `any_vessel == 1` and `y_cad == 1`: **216 patients**
  - `any_vessel == 0` and `y_cad == 0`: **86 patients**
  - `any_vessel == 0` and `y_cad == 1`: **0 patients** (no unexplainable positive overall diagnoses)
  - `any_vessel == 1` and `y_cad == 0`: **1 patient (Patient Index 93)**
    - Observation 93 exhibits `Cath = 'Normal'`, but `LAD = 'Stenotic'` (with LCX/RCA normal).
    - Preserved as empirical registry ground truth without synthetic manipulation.

---

## 3. Univariate Feature Associations with Outcomes

### Strongest Predictors for Overall CAD (`y_cad`)
1. **`Typical Chest Pain` ($r = +0.543$)**: Patients with typical anginal chest pain have markedly elevated CAD probability.
2. **`Atypical Chest Pain` ($r = -0.416$)**: Strong negative correlation; atypical pain correlates with lower likelihood of angiographically significant CAD.
3. **`Age` ($r = +0.357$)**: Risk rises monotonically across demographic age tiers (median 58 years).
4. **`Region RWMA` ($r = +0.316$)**: Regional wall motion abnormalities on echocardiography strongly signify ischemic myocardial territory.
5. **`Hypertension (HTN)` ($r = +0.288$)**: Chronic arterial shear stress is an established driver of atheroma formation.
6. **`Nonanginal Chest Pain` ($r = -0.274$)**: Non-anginal etiology substantially decreases CAD likelihood.
7. **`Diabetes Mellitus (DM)` ($r = +0.253$)**: Metabolic micro/macrovascular damage correlates with diffuse stenosis.
8. **`Systolic BP` ($r = +0.238$)**: Elevated resting arterial pressures.
9. **`Tinversion` ($r = +0.237$)**: T-wave inversion on resting 12-lead ECG reflects myocardial ischemia.
10. **`EF-TTE` ($r = -0.234$)**: Depressed left ventricular ejection fraction is more prevalent in multi-vessel disease.

### Key Vessel-Specific Predictor Distinctions
- **LAD (Anterior Wall)**: Dominant predictors include `Region RWMA` ($r = +0.362$), `EF-TTE` ($r = -0.315$), and `St Elevation` ($r = +0.186$), aligning with anterior/apical myocardial supply territory.
- **LCX (Lateral / Posterior Wall)**: Driven strongly by `Age` ($r = +0.313$), `Serum Creatinine` ($r = +0.176$), and `BUN` ($r = +0.149$), alongside typical symptoms.
- **RCA (Inferior Wall)**: Strongly linked to `Diabetes Mellitus` ($r = +0.270$), `Neutrophils` ($r = +0.229$), and `Poor R Progression` ($r = +0.185$).

---

## 4. Collinearity & Feature Interactions ($|r| > 0.6$)
1. **`Neutrophils` vs `Lymphocytes` ($r = -0.923$)**: Expected reciprocal leukocyte differential fraction; both are retained as tree ensembles handle differential ratios cleanly.
2. **`Weight` vs `BMI` ($r = +0.725$)** and **`BMI` vs `Obesity` ($r = +0.713$)**: Expected collinearity between anthropometric measurements.
3. **`Typical Chest Pain` vs `Atypical` ($r = -0.723$)**: Mutually exclusive symptom classifications in clinical assessment.
4. **`Height (Length)` vs `Sex` ($r = +0.700$)**: Expected biological sexual dimorphism in height.
5. **`Diabetes (DM)` vs `Fasting Blood Sugar (FBS)` ($r = +0.678$)**: Established diagnostic link between metabolic disease history and glycemia.

---

## 5. Machine Learning Design Implications
1. **Target Stratification**: Due to lower positive prevalence for LCX (39.27%) and RCA (37.62%), cross-validation splits must employ `RepeatedStratifiedKFold` anchored on each target outcome to protect minority positive class integrity.
2. **Preprocessing Pipeline**:
   - Numeric inputs scaled via standard scaling (`StandardScaler`) with median imputation (`SimpleImputer`).
   - Binary string inputs (`'Y'/'N'`, `'Male'/'Fmale'`) converted to clean boolean integers.
   - Categoricals (`BBB`, `VHD`) encoded via robust one-hot encoding (`OneHotEncoder(handle_unknown='ignore')`).
3. **Imbalance Mitigation**: Incorporate `class_weight='balanced'` in tree models and logistic regression; evaluate balanced class weights vs calibrated probabilities.
4. **Strict Nested Validation**: All preprocessing and calibration must occur strictly within outer training folds to eliminate data snooping and information leakage.
