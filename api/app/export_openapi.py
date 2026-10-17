"""Export OpenAPI schema to api/openapi.json."""

from __future__ import annotations

import json
from pathlib import Path

from api.app.main import app


def export_openapi() -> None:
    """Generate and write the OpenAPI schema JSON."""
    schema = app.openapi()
    out_path = Path("api/openapi.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2)
    print(f"✓ OpenAPI schema exported successfully to {out_path}")


if __name__ == "__main__":
    export_openapi()
