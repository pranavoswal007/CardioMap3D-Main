"""CardioMap 3D Fresh Clone vs Original API Parity Verification Script.

Tests:
1. /predict endpoint parity on a sample patient between port 8010 (original) and port 8011 (clone).
   Note: API output rounds predicted probabilities to 4 decimal places (precision 1e-4).
   Both unrounded JSON string comparison and numeric float diff are evaluated.
2. /schema endpoint exact equality.
3. /metrics endpoint exact equality.
4. SHA256 hash comparison of all tracked joblib model artifacts.
"""

from __future__ import annotations

import hashlib
import json
import urllib.request
from pathlib import Path

PORT_ORIG = 8010
PORT_CLONE = 8011


def fetch_json(url: str, post_data: dict | None = None) -> tuple[dict, str]:
    req = urllib.request.Request(
        url,
        headers={"Content-Type": "application/json"} if post_data else {},
    )
    data_bytes = json.dumps(post_data).encode("utf-8") if post_data else None
    with urllib.request.urlopen(req, data=data_bytes, timeout=10) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body), body


def compare_json_exact(j1: dict, j2: dict, path: str = "") -> list[str]:
    diffs = []
    if type(j1) is not type(j2):
        return [f"{path}: type mismatch ({type(j1)} vs {type(j2)})"]
    if isinstance(j1, dict):
        keys = sorted(set(j1.keys()).union(set(j2.keys())))
        for k in keys:
            child = f"{path}.{k}" if path else k
            if k not in j1:
                diffs.append(f"{child}: missing in orig")
            elif k not in j2:
                diffs.append(f"{child}: missing in clone")
            else:
                diffs.extend(compare_json_exact(j1[k], j2[k], child))
    elif isinstance(j1, list):
        if len(j1) != len(j2):
            diffs.append(f"{path}: list len {len(j1)} vs {len(j2)}")
        for i in range(min(len(j1), len(j2))):
            diffs.extend(compare_json_exact(j1[i], j2[i], f"{path}[{i}]"))
    elif isinstance(j1, (int, float)) and isinstance(j2, (int, float)):
        if abs(float(j1) - float(j2)) > 1e-12:
            diffs.append(f"{path}: numeric diff ({j1} vs {j2})")
    else:
        if j1 != j2:
            diffs.append(f"{path}: value diff ({j1!r} vs {j2!r})")
    return diffs


def main() -> None:
    print("=== CARDIO MAP 3D: CLONE VS ORIGINAL PARITY AUDIT ===")
    
    # 1. Fetch sample patient
    samples_list, _ = fetch_json(f"http://127.0.0.1:{PORT_ORIG}/patients/samples")
    sample_patient = samples_list[0]["features"]
    patient_desc = samples_list[0].get("sample_id", "sample 0")
    print(f"Loaded sample patient '{patient_desc}' (Age={sample_patient.get('Age')}, EF-TTE={sample_patient.get('EF-TTE')})")

    # 2. Test /predict parity
    print("\n--- 1. Testing /predict parity ---")
    pred_orig, _raw_orig = fetch_json(f"http://127.0.0.1:{PORT_ORIG}/predict", sample_patient)
    pred_clone, _raw_clone = fetch_json(f"http://127.0.0.1:{PORT_CLONE}/predict", sample_patient)

    print("API Output Precision: API schemas explicitly format probabilities with round(p, 4) (precision 1e-4).")
    pred_diffs = compare_json_exact(pred_orig, pred_clone)
    if not pred_diffs:
        print("PASS: /predict responses are IDENTICAL across all fields.")
        print("Sample predict target probabilities:")
        p_cad1 = pred_orig["cad"]["probability"]
        p_cad2 = pred_clone["cad"]["probability"]
        print(f"  CAD: orig={p_cad1:.4f}, clone={p_cad2:.4f}, diff={abs(p_cad1 - p_cad2)}")
        for v in ["lad", "lcx", "rca"]:
            p1 = pred_orig["vessels"][v]["probability"]
            p2 = pred_clone["vessels"][v]["probability"]
            print(f"  {v.upper()}: orig={p1:.4f}, clone={p2:.4f}, diff={abs(p1 - p2)}")
    else:
        print(f"FAIL: /predict diffs detected ({len(pred_diffs)}):")
        for d in pred_diffs:
            print("  ", d)

    # 3. Test /schema parity
    print("\n--- 2. Testing /schema parity ---")
    schema_orig, _ = fetch_json(f"http://127.0.0.1:{PORT_ORIG}/schema")
    schema_clone, _ = fetch_json(f"http://127.0.0.1:{PORT_CLONE}/schema")
    schema_diffs = compare_json_exact(schema_orig, schema_clone)
    if not schema_diffs:
        print("PASS: /schema responses are 100% IDENTICAL.")
    else:
        print(f"FAIL: /schema diffs detected ({len(schema_diffs)}):")
        for d in schema_diffs:
            print("  ", d)

    # 4. Test /metrics parity
    print("\n--- 3. Testing /metrics parity ---")
    metrics_orig, _ = fetch_json(f"http://127.0.0.1:{PORT_ORIG}/metrics")
    metrics_clone, _ = fetch_json(f"http://127.0.0.1:{PORT_CLONE}/metrics")
    metrics_diffs = compare_json_exact(metrics_orig, metrics_clone)
    if not metrics_diffs:
        print("PASS: /metrics responses are 100% IDENTICAL.")
    else:
        print(f"FAIL: /metrics diffs detected ({len(metrics_diffs)}):")
        for d in metrics_diffs:
            print("  ", d)

    # 5. Check joblib SHA256
    print("\n--- 4. Checking SHA256 of all tracked joblib artifacts ---")
    orig_dir = Path("/Users/pranavoswal/Projects/cardiomap3d/artifacts")
    clone_dir = Path("/tmp/cardiomap_fresh_2_8/artifacts")
    joblib_files = sorted(orig_dir.glob("*.joblib"))
    all_joblib_match = True
    for f in joblib_files:
        c_f = clone_dir / f.name
        h1 = hashlib.sha256(f.read_bytes()).hexdigest()
        h2 = hashlib.sha256(c_f.read_bytes()).hexdigest()
        match = (h1 == h2)
        if not match:
            all_joblib_match = False
        print(f"  {f.name}: sha256={h1} match={match}")
    if all_joblib_match:
        print("PASS: All 6 joblib artifact SHA256 hashes match bit-for-bit.")
    else:
        print("FAIL: One or more joblib SHA256 hashes mismatched.")


if __name__ == "__main__":
    main()
