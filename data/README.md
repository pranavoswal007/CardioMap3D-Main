# CardioMap 3D Dataset Documentation

## Dataset Name
**Extension of Z-Alizadeh Sani Dataset** (UCI Machine Learning Repository ID: 411)

## Source & Metadata
- **Source**: [UCI Machine Learning Repository - Extension of Z-Alizadeh Sani Dataset](https://archive.ics.uci.edu/dataset/411/extension+of+z+alizadeh+sani+dataset)
- **Authors**: Roohallah Alizadehsani, Mohamad Roshanzamir, and Zahra Alizadeh Sani
- **Publication Year**: 2017
- **DOI**: [https://doi.org/10.24432/C5461K](https://doi.org/10.24432/C5461K)
- **File**: `data/raw/z_alizadeh_sani_extension.xlsx`

## License
- **License**: Creative Commons Attribution 4.0 International ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/))
- **Terms**: This license permits redistribution, adaptation, and commercial use with appropriate attribution to the authors and source.

## Acquisition & Independent Download
The raw dataset is tracked directly in Git at `data/raw/z_alizadeh_sani_extension.xlsx`.
If acquiring or refreshing the dataset independently from the official UCI repository:
```bash
# 1. Download official archive from UCI Repository (DOI: 10.24432/C5461K)
curl -L -o /tmp/z_sani_dataset.zip "https://archive.ics.uci.edu/static/public/411/extension+of+z+alizadeh+sani+dataset.zip"

# 2. Extract primary spreadsheet to data/raw/
unzip -p /tmp/z_sani_dataset.zip "Z-Alizadeh Sani dataset.xlsx" > data/raw/z_alizadeh_sani_extension.xlsx
```

## Description
The dataset contains records of **303 patients** evaluated for coronary artery disease (CAD). It captures comprehensive clinical profiles divided across key diagnostic categories:
- **Demographic Information**: Age, sex, BMI, weight, length.
- **Symptom and Examination**: Blood pressure, pulse rate, edema, weak peripheral pulses, lung rales, systolic/diastolic murmurs, chest pain characteristics (typical, atypical, nonanginal, exertional CP, low-threshold angina), functional class.
- **Electrocardiography (ECG)**: Q wave, ST elevation, ST depression, T inversion, LVH, poor R progression, BBB.
- **Laboratory and Echocardiography**: Fasting blood sugar (FBS), serum creatinine (CR), triglycerides (TG), LDL, HDL, BUN, ESR, hemoglobin (HB), K, Na, WBC, platelets (PLT), lymphocytes, neutrophils, ejection fraction (EF-TTE), regional wall motion abnormalities (Region RWMA), valvular heart disease (VHD).
- **Vessel-Level Stenosis & Target Labels**: Catheterization ground truth labels providing vessel-level stenosis (stenosis ≥ 50%) for:
  - **LAD** (Left Anterior Descending)
  - **LCX** (Left Circumflex)
  - **RCA** (Right Coronary Artery)
  - **Cath** (Overall CAD status: CAD vs Normal)

## Structure in `data/raw/z_alizadeh_sani_extension.xlsx`
1. **Sheet 1 - Table 1**: Primary dataset of 303 rows and 59 columns containing feature measurements and target labels.
2. **Sheet1**: Feature schema specification.

## Attribution & Citation
If you use this dataset in research or downstream applications, please cite the original authors:

```bibtex
@misc{alizadehsani2017extension,
  author       = {Alizadehsani, Roohallah and Roshanzamir, Mohamad and Sani, Zahra Alizadeh},
  title        = {{Extension of Z-Alizadeh Sani Dataset}},
  year         = {2017},
  howpublished = {UCI Machine Learning Repository},
  note         = {{DOI}: 10.24432/C5461K}
}
```
