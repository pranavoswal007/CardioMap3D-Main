# CardioMap 3D: Data Dictionary

## Overview
- **Dataset**: Extension of Z-Alizadeh Sani Dataset (UCI ID 411, DOI: 10.24432/C5461K)
- **Source File**: `data/raw/z_alizadeh_sani_extension.xlsx` (Sheet: `Sheet 1 - Table 1`)
- **Total Patients**: 303
- **Total Raw Columns**: 59
- **Input Features**: 55 (Target Leakage Guard Enforced)
- **Target Columns**: 4 (`Cath`, `LAD`, `LCX`, `RCA`)

---

## Target Variables (Ground Truth Catheterization Outcomes)

| Raw Column Header | Standard Name | Clinical Meaning | Binary Positive Definition | Prevalence (n, %) |
| :--- | :--- | :--- | :--- | :--- |
| **`Cath`** | `y_cad` | Overall Coronary Artery Disease diagnosis | `CAD` (Stenosis $\ge 50\%$ in $\ge 1$ coronary vessel) | 216 / 303 (71.29%) |
| **`LAD`** | `y_lad` | Left Anterior Descending artery stenosis | `Stenotic` (Stenosis $\ge 50\%$) | 177 / 303 (58.42%) |
| **`LCX`** | `y_lcx` | Left Circumflex artery stenosis | `Stenotic` (Stenosis $\ge 50\%$) | 119 / 303 (39.27%) |
| **`RCA`** | `y_rca` | Right Coronary Artery stenosis | `Stenotic` (Stenosis $\ge 50\%$) | 114 / 303 (37.62%) |

### Target Consistency Invariant
- Whenever any individual vessel (`LAD`, `LCX`, or `RCA`) is `Stenotic`, overall catheterization outcome `Cath` is expected to be `CAD`.
- **Audit Finding**: In 302 of 303 patients, `y_cad == (y_lad | y_lcx | y_rca)`.
- **Single Discrepancy (Patient index 93)**: Row 93 has `Cath = 'Normal'`, but `LAD = 'Stenotic'` (LCX='Normal', RCA='Normal'). This is preserved as raw clinical ground truth without synthetic alterations.

---

## Input Features (55 Columns across 7 Clinical Groups)

### 1. Demographics (5 features)
| Feature Name | Display Label | Data Type | Unit | Values / Range | Default (Median/Mode) | Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `Age` | Age | numeric | years | [30, 86] | 58.0 | Patient chronological age |
| `Weight` | Body Weight | numeric | kg | [48, 120] | 74.0 | Total body weight |
| `Length` | Height / Length | numeric | cm | [140, 188] | 165.0 | Standing body height |
| `Sex` | Biological Sex | binary | — | `['Fmale', 'Male']` | `Male` | Patient biological sex |
| `BMI` | Body Mass Index (BMI) | numeric | kg/m² | [18.12, 40.90] | 26.78 | Calculated as $\text{Weight} / (\text{Length}/100)^2$ |

### 2. Patient History & Comorbidities (12 features)
| Feature Name | Display Label | Data Type | Unit | Values / Range | Default (Median/Mode) | Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `DM` | Diabetes Mellitus | binary | — | `[0, 1]` | 0 | Prior diagnosis of diabetes mellitus |
| `HTN` | Hypertension | binary | — | `[0, 1]` | 1 | History of systemic arterial hypertension |
| `Current Smoker` | Current Smoker | binary | — | `[0, 1]` | 0 | Actively smoking cigarettes |
| `EX-Smoker` | Ex-Smoker | binary | — | `[0, 1]` | 0 | Past history of smoking, currently quit |
| `FH` | Family History of CAD | binary | — | `[0, 1]` | 0 | First-degree relative with premature CAD |
| `Obesity` | Obesity | binary | — | `['N', 'Y']` | `Y` | Clinical obesity indicator (BMI $\ge 30$) |
| `CRF` | Chronic Renal Failure | binary | — | `['N', 'Y']` | `N` | History of chronic kidney disease |
| `CVA` | Cerebrovascular Accident | binary | — | `['N', 'Y']` | `N` | Prior stroke or transient ischemic attack |
| `Airway disease` | Chronic Airway Disease | binary | — | `['N', 'Y']` | `N` | History of COPD or severe asthma |
| `Thyroid Disease` | Thyroid Disease | binary | — | `['N', 'Y']` | `N` | Hypo- or hyper-thyroidism |
| `CHF` | Congestive Heart Failure | binary | — | `['N', 'Y']` | `N` | Prior diagnosed heart failure |
| `DLP` | Dyslipidemia | binary | — | `['N', 'Y']` | `N` | Elevated blood lipids / hyperlipidemia |

### 3. Vital Signs (2 features)
| Feature Name | Display Label | Data Type | Unit | Values / Range | Default (Median/Mode) | Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `BP` | Systolic Blood Pressure | numeric | mmHg | [90, 190] | 130.0 | Resting systolic blood pressure |
| `PR` | Pulse Rate | numeric | bpm | [50, 110] | 70.0 | Resting heart rate |

### 4. Symptoms & Physical Examination (12 features)
| Feature Name | Display Label | Data Type | Unit | Values / Range | Default (Median/Mode) | Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `Edema` | Peripheral Edema | binary | — | `[0, 1]` | 0 | Lower extremity peripheral edema |
| `Weak Peripheral Pulse`| Weak Peripheral Pulse | binary | — | `['N', 'Y']` | `N` | Diminished peripheral arterial pulsation |
| `Lung rales` | Pulmonary Rales | binary | — | `['N', 'Y']` | `N` | Auscultatory pulmonary crackles / rales |
| `Systolic Murmur` | Systolic Heart Murmur | binary | — | `['N', 'Y']` | `N` | Auscultatory systolic heart murmur |
| `Diastolic Murmur` | Diastolic Heart Murmur | binary | — | `['N', 'Y']` | `N` | Auscultatory diastolic heart murmur |
| `Typical Chest Pain` | Typical Anginal Chest Pain | binary | — | `[0, 1]` | 1 | Substernal chest pain provoked by exertion |
| `Dyspnea` | Exertional Dyspnea | binary | — | `['N', 'Y']` | `N` | Shortness of breath on mild/moderate effort |
| `Function Class` | NYHA Functional Class | ordinal | class (0–3) | `[0, 1, 2, 3]` | 0.0 | Heart failure / exertion symptom class |
| `Atypical` | Atypical Chest Pain | binary | — | `['N', 'Y']` | `N` | Non-classical chest pain characteristics |
| `Nonanginal` | Non-Anginal Chest Pain | binary | — | `['N', 'Y']` | `N` | Pain without anginal features |
| `Exertional CP` | Exertional Chest Pain | binary | — | `['N']` | `N` | Isolated exertional CP (constant 'N' in cohort) |
| `LowTH Ang` | Low Threshold Angina | binary | — | `['N', 'Y']` | `N` | Angina elicited by minimal physical activity |

### 5. Electrocardiography (ECG) (7 features)
| Feature Name | Display Label | Data Type | Unit | Values / Range | Default (Median/Mode) | Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `Q Wave` | Pathologic Q Wave | binary | — | `[0, 1]` | 0 | Pathological Q wave indicating infarction |
| `St Elevation` | ST-Segment Elevation | binary | — | `[0, 1]` | 0 | Acute ST-segment elevation on resting ECG |
| `St Depression` | ST-Segment Depression | binary | — | `[0, 1]` | 0 | ST depression suggesting myocardial ischemia |
| `Tinversion` | T-Wave Inversion | binary | — | `[0, 1]` | 0 | Pathological T wave inversion |
| `LVH` | Left Ventricular Hypertrophy | binary | — | `['N', 'Y']` | `N` | Voltage or repolarization criteria for LVH |
| `Poor R Progression` | Poor R Wave Progression | binary | — | `['N', 'Y']` | `N` | Delayed precordial R-wave transition |
| `BBB` | Bundle Branch Block | categorical | — | `['N', 'LBBB', 'RBBB']`| `N` | Intraventricular conduction delay |

### 6. Laboratory Biomarkers (14 features)
| Feature Name | Display Label | Data Type | Unit | Values / Range | Default (Median/Mode) | Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `FBS` | Fasting Blood Sugar | numeric | mg/dL | [62, 400] | 98.0 | Fasting plasma glucose level |
| `CR` | Serum Creatinine | numeric | mg/dL | [0.5, 2.2] | 1.0 | Renal function biochemical marker |
| `TG` | Triglycerides | numeric | mg/dL | [37, 1050] | 122.0 | Serum triglyceride concentration |
| `LDL` | Low-Density Lipoprotein | numeric | mg/dL | [18, 232] | 100.0 | Serum LDL cholesterol concentration |
| `HDL` | High-Density Lipoprotein | numeric | mg/dL | [15.9, 111.0] | 39.0 | Serum HDL cholesterol concentration |
| `BUN` | Blood Urea Nitrogen | numeric | mg/dL | [6, 52] | 16.0 | Kidney filtration metabolite |
| `ESR` | Erythrocyte Sedimentation Rate | numeric | mm/hr | [1, 90] | 15.0 | Non-specific systemic inflammation marker |
| `HB` | Hemoglobin | numeric | g/dL | [8.9, 17.6] | 13.2 | Total blood hemoglobin concentration |
| `K` | Serum Potassium | numeric | mEq/L | [3.0, 6.6] | 4.2 | Serum potassium electrolyte |
| `Na` | Serum Sodium | numeric | mEq/L | [128, 156] | 141.0 | Serum sodium electrolyte |
| `WBC` | White Blood Cell Count | numeric | cells/µL | [3700, 18000] | 7100.0 | Total leukocyte count |
| `Lymph` | Lymphocytes | numeric | % | [7, 60] | 32.0 | Lymphocyte differential fraction |
| `Neut` | Neutrophils | numeric | % | [32, 89] | 60.0 | Neutrophil differential fraction |
| `PLT` | Platelet Count | numeric | 10³/µL | [25, 742] | 210.0 | Thrombocyte blood concentration |

### 7. Echocardiography (Echo) (3 features)
| Feature Name | Display Label | Data Type | Unit | Values / Range | Default (Median/Mode) | Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `EF-TTE` | Ejection Fraction (TTE) | numeric | % | [15, 60] | 50.0 | Transthoracic echocardiographic EF |
| `Region RWMA` | Regional Wall Motion Abnormality | ordinal | score (0–4) | `[0, 1, 2, 3, 4]` | 0.0 | Count of affected LV myocardial segments |
| `VHD` | Valvular Heart Disease | categorical | — | `['N', 'mild', 'Moderate', 'Severe']` | `mild` | Degree of echocardiographic valvular defect |
