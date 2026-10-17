"""CardioMap 3D Explainer Fidelity & Perturbation Stability Audit (HEAD Settings).

Evaluates the deployed CAD model explainer with HEAD settings:
- Background: artifacts/shap_background_sample.csv (30 stratified patients)
- Explainer: KernelExplainer in probability points
- Seed: 42
- nsamples: 150 for reference comparison, 250 for perturbation stability
Against high-fidelity reference: artifacts/shap_reference_20_patients.joblib (nsamples=3000, 100 background points).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import joblib
import numpy as np
import numpy.typing as npt
import pandas as pd
import shap
from cardiomap_ml.train import load_dataset
from scipy.stats import spearmanr


def main() -> None:
    print("=== CARDIO MAP 3D: EXPLAINER FIDELITY BENCHMARK AT HEAD SETTINGS ===")
    artifacts_dir = Path("artifacts")
    bg_path = artifacts_dir / "shap_background_sample.csv"
    bg_df = pd.read_csv(bg_path)
    print(f"Background sample rows: {len(bg_df)} (HEAD setting)")

    ref_path = artifacts_dir / "shap_reference_20_patients.joblib"
    ref_data = joblib.load(ref_path)
    patient_indices = ref_data["patients_indices"]
    ref_shap = ref_data["ref_shap_values"]
    print(f"Reference cohort size: {len(patient_indices)} patients")

    X, _, _ = load_dataset(Path("data/raw/z_alizadeh_sani_extension.xlsx"))
    patients_20 = X.iloc[patient_indices]

    cad_model = joblib.load(artifacts_dir / "model_y_cad.joblib")

    def predict_fn(x: pd.DataFrame | npt.NDArray[Any]) -> npt.NDArray[np.float64]:
        df = pd.DataFrame(x, columns=bg_df.columns) if not isinstance(x, pd.DataFrame) else x
        return cast(
            npt.NDArray[np.float64], np.asarray(cad_model.predict_proba(df)[:, 1], dtype=np.float64)
        )

    print("\n--- 1. Evaluating Accuracy vs High-Fidelity Reference (nsamples=150, seed=42) ---")
    explainer = shap.KernelExplainer(predict_fn, bg_df)
    np.random.seed(42)
    prod_shap = explainer.shap_values(patients_20, nsamples=150, silent=True)

    top3_overlaps = []
    spearman_corrs = []

    for i in range(len(patients_20)):
        ref_top3 = set(np.argsort(np.abs(ref_shap[i]))[::-1][:3])
        prod_top3 = set(np.argsort(np.abs(prod_shap[i]))[::-1][:3])
        overlap = len(ref_top3.intersection(prod_top3))
        top3_overlaps.append(overlap)

        rho, _ = spearmanr(ref_shap[i], prod_shap[i])
        spearman_corrs.append(float(rho))
        print(f"Patient {i:02d} (row {patient_indices[i]:03d}): top3_overlap={overlap}/3 | spearman={rho:.4f}")

    avg_overlap = float(np.mean(top3_overlaps))
    avg_spearman = float(np.mean(spearman_corrs))

    print("\nSUMMARY OVER 20 PATIENTS (HEAD SETTINGS):")
    print(f"Average top-3 overlap: {avg_overlap:.4f} / 3 ({avg_overlap / 3.0 * 100:.2f}%)")
    print(f"Average Spearman rank correlation: {avg_spearman:.4f}")

    print("\n--- 2. Evaluating Age+1 Year Perturbation Stability (nsamples=250, seed=42) ---")
    np.random.seed(42)
    base_shap = explainer.shap_values(patients_20, nsamples=250, silent=True)

    perturbed_patients = patients_20.copy()
    perturbed_patients["Age"] = perturbed_patients["Age"] + 1
    np.random.seed(42)
    pert_shap = explainer.shap_values(perturbed_patients, nsamples=250, silent=True)

    preserved_count = 0
    for i in range(len(patients_20)):
        base_top3 = tuple(np.argsort(np.abs(base_shap[i]))[::-1][:3])
        pert_top3 = tuple(np.argsort(np.abs(pert_shap[i]))[::-1][:3])
        match = (base_top3 == pert_top3)
        if match:
            preserved_count += 1
        print(f"Patient {i:02d}: top-3 preserved={match} (base={base_top3}, pert={pert_top3})")

    stability_ratio = preserved_count / len(patients_20)
    print(f"\nAge+1 Perturbation Stability: {preserved_count}/{len(patients_20)} ({stability_ratio * 100:.1f}%)")


if __name__ == "__main__":
    main()
