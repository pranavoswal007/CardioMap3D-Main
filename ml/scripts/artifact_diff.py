"""CardioMap 3D Artifact Deep Diff & Classification Tool.

Compares artifact files between two git revisions or directories and classifies differences:
- A: Volatile fields only (timestamp, path, commit, generated_at, provenance)
- B: Numeric or content difference
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import subprocess
from pathlib import Path
from typing import Any

IGNORED_KEYS = {
    "timestamp",
    "path",
    "commit",
    "generated_at",
    "total_runtime_seconds",
    "training_time_seconds",
    "provenance",
}


def load_file_content(source: str, file_rel_path: str) -> str:
    """Load file content from git revision or local filesystem."""
    if Path(source).is_dir():
        local_path = Path(source) / file_rel_path
        if not local_path.exists():
            raise FileNotFoundError(f"File not found: {local_path}")
        return local_path.read_text(encoding="utf-8")
    # Git ref
    cmd = ["git", "show", f"{source}:{file_rel_path}"]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return res.stdout


def deep_diff_json(
    val1: Any,
    val2: Any,
    current_path: str = "",
) -> tuple[list[str], float]:
    """Compare two JSON objects recursively, ignoring volatile keys.

    Returns (list_of_changed_paths, max_abs_numeric_diff).
    """
    changed_paths: list[str] = []
    max_numeric_diff = 0.0

    if isinstance(val1, dict) and isinstance(val2, dict):
        all_keys = sorted(set(val1.keys()).union(set(val2.keys())))
        for k in all_keys:
            if k in IGNORED_KEYS:
                continue
            child_path = f"{current_path}.{k}" if current_path else k
            if k not in val1:
                changed_paths.append(f"{child_path} (added in target)")
            elif k not in val2:
                changed_paths.append(f"{child_path} (removed in target)")
            else:
                sub_paths, sub_diff = deep_diff_json(val1[k], val2[k], child_path)
                changed_paths.extend(sub_paths)
                max_numeric_diff = max(max_numeric_diff, sub_diff)

    elif isinstance(val1, list) and isinstance(val2, list):
        if len(val1) != len(val2):
            changed_paths.append(f"{current_path} (length {len(val1)} vs {len(val2)})")
        min_len = min(len(val1), len(val2))
        for i in range(min_len):
            sub_paths, sub_diff = deep_diff_json(val1[i], val2[i], f"{current_path}[{i}]")
            changed_paths.extend(sub_paths)
            max_numeric_diff = max(max_numeric_diff, sub_diff)

    elif isinstance(val1, (int, float)) and isinstance(val2, (int, float)):
        diff = abs(float(val1) - float(val2))
        if diff > 1e-12:
            changed_paths.append(f"{current_path} (numeric diff: {val1} vs {val2})")
            max_numeric_diff = max(max_numeric_diff, diff)

    else:
        if val1 != val2:
            changed_paths.append(f"{current_path} (content diff: {val1!r} vs {val2!r})")

    return changed_paths, max_numeric_diff


def diff_csv_content(content1: str, content2: str) -> tuple[list[str], float]:
    """Compare two CSV contents."""
    changed_paths: list[str] = []
    max_diff = 0.0

    r1 = list(csv.reader(io.StringIO(content1)))
    r2 = list(csv.reader(io.StringIO(content2)))

    if len(r1) != len(r2):
        changed_paths.append(f"row_count (rows {len(r1)} vs {len(r2)})")

    min_rows = min(len(r1), len(r2))
    for r_idx in range(min_rows):
        row1, row2 = r1[r_idx], r2[r_idx]
        if len(row1) != len(row2):
            changed_paths.append(f"row[{r_idx}] col_count ({len(row1)} vs {len(row2)})")
        min_cols = min(len(row1), len(row2))
        for c_idx in range(min_cols):
            v1, v2 = row1[c_idx], row2[c_idx]
            if v1 != v2:
                try:
                    num1, num2 = float(v1), float(v2)
                    d = abs(num1 - num2)
                    if d > 1e-12:
                        changed_paths.append(f"row[{r_idx}][{c_idx}] ({v1} vs {v2})")
                        max_diff = max(max_diff, d)
                except ValueError:
                    changed_paths.append(f"row[{r_idx}][{c_idx}] ({v1!r} vs {v2!r})")

    return changed_paths, max_diff


def compare_artifact(base: str, target: str, filename: str) -> dict[str, Any]:
    """Compare a single artifact file."""
    rel_path = f"artifacts/{filename}"
    try:
        content_base = load_file_content(base, rel_path)
    except (subprocess.SubprocessError, OSError, ValueError) as e:
        return {"file": filename, "error": f"Base error: {e}", "classification": "ERROR"}

    try:
        content_target = load_file_content(target, rel_path)
    except (subprocess.SubprocessError, OSError, ValueError) as e:
        return {"file": filename, "error": f"Target error: {e}", "classification": "ERROR"}

    if filename.endswith(".json"):
        d1 = json.loads(content_base)
        d2 = json.loads(content_target)
        changed_paths, max_num_diff = deep_diff_json(d1, d2)
    elif filename.endswith(".csv"):
        changed_paths, max_num_diff = diff_csv_content(content_base, content_target)
    else:
        changed_paths = [] if content_base == content_target else ["raw_content_mismatch"]
        max_num_diff = 0.0

    classification = "A (volatile only)" if not changed_paths else "B (numeric/content)"

    return {
        "file": filename,
        "classification": classification,
        "changed_paths_count": len(changed_paths),
        "changed_paths_sample": changed_paths[:15],
        "max_numeric_diff": max_num_diff,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Deep artifact comparison and classification")
    parser.add_argument(
        "--base", default="9491341", help="Base git commit or dir (default: 9491341)"
    )
    parser.add_argument("--target", default="HEAD", help="Target git commit or dir (default: HEAD)")
    parser.add_argument(
        "--files",
        nargs="*",
        default=[
            "metrics.json",
            "shap_global.json",
            "shap_stability.json",
            "shap_background_sample.csv",
        ],
    )
    args = parser.parse_args()

    print(f"Comparing artifacts between base='{args.base}' and target='{args.target}'")
    print("=" * 80)

    for fn in args.files:
        res = compare_artifact(args.base, args.target, fn)
        print(f"\nFile: {res['file']}")
        print(f"Classification: {res['classification']}")
        print(f"Max Numeric Diff: {res['max_numeric_diff']}")
        print(f"Changed Paths Count: {res['changed_paths_count']}")
        if res["changed_paths_sample"]:
            print("Changed Paths (sample up to 15):")
            for p in res["changed_paths_sample"]:
                print(f"  - {p}")
        print("-" * 80)


if __name__ == "__main__":
    main()
