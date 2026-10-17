"""CardioMap 3D Rigorous Explain Latency Benchmark (Phase 2.8).

Protocol:
- 50 DISTINCT patients selected from the clinical dataset (logging row indices)
- Sequential execution
- Process cold start measured separately on the very first request
- For each configuration (all, cad, lad, lcx, rca):
  - Cache explicitly cleared before the run (COLD CACHE)
  - All 50 patients evaluated and timed individually
  - Immediately re-evaluated to measure CACHED-HIT latency
- Raw per-request timings saved to docs/evidence/phase2_8/explain_bench_raw.csv
- Summary statistics computed from CSV: Mean, p50, p95, Min, Max
"""

from __future__ import annotations

import csv
import time
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from api.app.main import STATE, app, load_all_artifacts


def run_benchmark() -> None:
    print("=== STARTING PHASE 2.8 EXPLAIN LATENCY BENCHMARK ===")
    artifacts_dir = Path("artifacts")
    data_path = Path("data/raw/z_alizadeh_sani_extension.xlsx")

    # Ensure artifacts and dataset exist
    assert artifacts_dir.exists()
    assert data_path.exists()

    # Load dataset
    df_raw = pd.read_excel(data_path, sheet_name="Sheet 1 - Table 1")
    X_raw = df_raw.drop(columns=["Cath", "LAD", "LCX", "RCA"])
    total_patients = len(X_raw)
    print(f"Total cohort size: {total_patients} patients")

    # Select 50 distinct patients
    n_benchmark = 50
    selected_indices = list(range(n_benchmark))
    print(f"Selected {n_benchmark} distinct patient row indices: {selected_indices}")

    # Initialize client
    load_all_artifacts()
    client = TestClient(app)

    # 1. Measure process cold start
    # Clear caches
    STATE["target_explain_cache"].clear()
    STATE["explain_cache"].clear()

    cold_start_patient = X_raw.iloc[0].to_dict()
    t0 = time.perf_counter()
    r_cold_start = client.post("/explain", json=cold_start_patient)
    t_cold_start = (time.perf_counter() - t0) * 1000.0
    assert r_cold_start.status_code == 200
    print(f"PROCESS COLD START (first request after startup): {t_cold_start:.2f} ms")

    # CSV output setup
    csv_path = Path("docs/evidence/phase2_8/explain_bench_raw.csv")
    csv_rows = []

    configs = [
        ("all", None),
        ("cad", "cad"),
        ("lad", "lad"),
        ("lcx", "lcx"),
        ("rca", "rca"),
    ]

    for config_name, targets_param in configs:
        print(f"\n--- Benchmarking Configuration: {config_name} (targets={targets_param}) ---")
        
        # Clear cache before configuration run (Cold Cache)
        STATE["target_explain_cache"].clear()
        STATE["explain_cache"].clear()

        # A. Cold run
        cold_times = []
        for i, idx in enumerate(selected_indices):
            patient_data = X_raw.iloc[idx].to_dict()
            url = "/explain" if targets_param is None else f"/explain?targets={targets_param}"
            t_start = time.perf_counter()
            res = client.post(url, json=patient_data)
            duration = (time.perf_counter() - t_start) * 1000.0
            assert res.status_code == 200
            cold_times.append(duration)
            csv_rows.append({
                "patient_idx": i,
                "row_index": idx,
                "config": config_name,
                "mode": "cold",
                "latency_ms": round(duration, 3),
            })

        print(f"  Cold run 50 patients: p50={np.median(cold_times):.2f} ms, p95={np.percentile(cold_times, 95):.2f} ms")

        # B. Cached run (same 50 patients)
        cached_times = []
        for i, idx in enumerate(selected_indices):
            patient_data = X_raw.iloc[idx].to_dict()
            url = "/explain" if targets_param is None else f"/explain?targets={targets_param}"
            t_start = time.perf_counter()
            res = client.post(url, json=patient_data)
            duration = (time.perf_counter() - t_start) * 1000.0
            assert res.status_code == 200
            cached_times.append(duration)
            csv_rows.append({
                "patient_idx": i,
                "row_index": idx,
                "config": config_name,
                "mode": "cached",
                "latency_ms": round(duration, 3),
            })

        print(f"  Cached run 50 patients: p50={np.median(cached_times):.2f} ms, p95={np.percentile(cached_times, 95):.2f} ms")

    # Write raw CSV
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["patient_idx", "row_index", "config", "mode", "latency_ms"])
        writer.writeheader()
        writer.writerows(csv_rows)
    print(f"\nSaved raw per-request timings ({len(csv_rows)} records) to {csv_path}")

    # Generate summary tables from CSV
    print("\n=== SUMMARY BENCHMARK RESULTS (GENERATED DIRECTLY FROM CSV) ===")
    df_raw_timings = pd.read_csv(csv_path)

    for mode in ["cold", "cached"]:
        sub_df = df_raw_timings[df_raw_timings["mode"] == mode]
        print(f"\n--- Mode: {mode.upper()} CACHE ({n_benchmark} distinct patients) ---")
        print("| Configuration | Payloads | Mean (ms) | p50 Median (ms) | p95 (ms) | Min (ms) | Max (ms) |")
        print("| :--- | :---: | :---: | :---: | :---: | :---: | :---: |")
        for config_name, _ in configs:
            cfg_data = sub_df[sub_df["config"] == config_name]["latency_ms"].values
            mean_v = np.mean(cfg_data)
            p50_v = np.median(cfg_data)
            p95_v = np.percentile(cfg_data, 95)
            min_v = np.min(cfg_data)
            max_v = np.max(cfg_data)
            print(f"| **{config_name}** | {len(cfg_data)} | {mean_v:.2f} ms | **{p50_v:.2f} ms** | **{p95_v:.2f} ms** | {min_v:.2f} ms | {max_v:.2f} ms |")


if __name__ == "__main__":
    run_benchmark()
