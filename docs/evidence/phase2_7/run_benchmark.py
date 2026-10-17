"""Latency benchmark for /explain across 50 distinct patients with cold cache."""

import time

import numpy as np
from cardiomap_ml.train import load_dataset
from fastapi.testclient import TestClient

from api.app.main import STATE, app, load_all_artifacts

load_all_artifacts()
client = TestClient(app)

X, _, _ = load_dataset("data/raw/z_alizadeh_sani_extension.xlsx")
patients = [X.iloc[i].to_dict() for i in range(50)]

configs = [
    ("All Four Targets (cad, lad, lcx, rca)", None),
    ("Single Target: CAD", "cad"),
    ("Single Target: LAD", "lad"),
    ("Single Target: LCX", "lcx"),
    ("Single Target: RCA", "rca"),
]

results = {}

for name, target_param in configs:
    latencies = []
    for pat in patients:
        STATE["explain_cache"].clear()
        params = {"targets": target_param} if target_param else {}
        t0 = time.perf_counter()
        res = client.post("/explain", json=pat, params=params)
        t1 = time.perf_counter()
        assert res.status_code == 200, f"Error {res.status_code}: {res.text}"
        latencies.append((t1 - t0) * 1000.0)

    p50 = float(np.percentile(latencies, 50))
    p95 = float(np.percentile(latencies, 95))
    mean = float(np.mean(latencies))
    min_v = float(np.min(latencies))
    max_v = float(np.max(latencies))

    results[name] = {
        "count": len(latencies),
        "mean_ms": round(mean, 2),
        "p50_ms": round(p50, 2),
        "p95_ms": round(p95, 2),
        "min_ms": round(min_v, 2),
        "max_ms": round(max_v, 2),
    }

print("=== LATENCY BENCHMARK: 50 DISTINCT PATIENTS (COLD CACHE) ===")
print("| Mode | Payloads | Mean (ms) | p50 Median (ms) | p95 (ms) | Min (ms) | Max (ms) |")
print("| :--- | :---: | :---: | :---: | :---: | :---: | :---: |")
for name, m in results.items():
    cnt = m["count"]
    mean_val = m["mean_ms"]
    p50_val = m["p50_ms"]
    p95_val = m["p95_ms"]
    min_val = m["min_ms"]
    max_val = m["max_ms"]
    print(f"| **{name}** | {cnt} | {mean_val} ms | **{p50_val} ms** | **{p95_val} ms** | {min_val} ms | {max_val} ms |")
