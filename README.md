# CardioMap 3D

> **Interactive 3D Coronary Artery Risk Visualization & Multi-Vessel Stenosis Decision-Support System**  
> Multimodal AI Hackathon 2026 — Track A (Production Monorepo)

[![Live Web App](https://img.shields.io/badge/Vercel-Frontend_Live-black?style=flat&logo=vercel)](https://cardiomap3d.vercel.app)
[![Live Backend API](https://img.shields.io/badge/Render-Backend_Live-46E3B7?style=flat&logo=render&logoColor=black)](https://cardiomap3d-api.onrender.com/health)

- 🌐 **Live Web Application (Vercel)**: [https://cardiomap3d.vercel.app](https://cardiomap3d.vercel.app)
- ⚙️ **Live ML Backend (Render)**: [https://cardiomap3d-api.onrender.com](https://cardiomap3d-api.onrender.com)
- 🩺 **API Health Check**: [https://cardiomap3d-api.onrender.com/health](https://cardiomap3d-api.onrender.com/health)

---

## Clinical Disclaimer (Mandatory)
> **IMPORTANT CLINICAL NOTICE:**  
> CardioMap 3D is designed for clinical research, decision-support exploration, and educational visualization only.  
> It is **NOT** a certified diagnostic medical device and is **NOT** a substitute for formal diagnostic cardiac imaging, computed tomography coronary angiography (CTCA), or invasive coronary angiography (ICA).  
> All 3D vessel lumen depictions are **illustrative projections** of calibrated vessel-level stenosis risk probabilities. No lesion-level or segment-level localization is claimed.

---

## Architecture Overview

CardioMap 3D is structured as a typed monorepo designed for reproducibility, high performance, and zero target leakage:

```text
cardiomap3d/
├── data/
│   ├── raw/             # Original clinical datasets (e.g. Z-Alizadeh Sani)
│   └── processed/       # Sanitized splits and schemas
├── ml/
│   ├── src/cardiomap_ml/ # ML training pipelines, feature engineering, assertions
│   └── tests/           # Strict target leakage and validation unit tests
├── api/
│   ├── app/             # FastAPI + Pydantic v2 application serving inference
│   └── tests/           # Health and endpoint unit tests
├── web/                 # Vite + React 19 + TypeScript + Tailwind + React Three Fiber + Recharts
├── docs/                # Clinical data dictionary, model cards, audit reports
├── artifacts/           # Trained model weights, calibration curves, SHAP explainers
├── Makefile             # One-command developer workflows (make setup, test, api, web)
├── requirements.txt     # Locked Python dependencies
└── pyproject.toml       # Monorepo configuration, Ruff, Mypy, and Pytest
```

---

## Hard Engineering Rules

1. **Target Leakage Prevention**: Features `Cath`, `LAD`, `LCX`, and `RCA` are strictly quarantined from input feature matrices. Guarded in code via `assert_no_target_leakage()` and verified by automated unit tests.
2. **Strict Pipeline Isolation**: All imputation, scaling, encoding, and resampling occur strictly inside scikit-learn / imblearn pipelines within CV folds.
3. **Honest Metrics**: Zero hardcoded or fabricated benchmarks; all reported metrics originate from real out-of-fold cross-validation.
4. **Vessel-Level Granularity**: Clear anatomical disclosure that predictions are vessel-level (LAD / LCX / RCA), not lesion-localized.
5. **Config-Driven Extensibility**: Clinical features, models, and anatomical structures are declared via config schemas.
6. **Deterministic Reproducibility**: Fixed random seeds (`seed=42`) across Python, NumPy, XGBoost, and LightGBM.

---

## Quickstart

### Prerequisites
- Python 3.11+
- Node.js 18+ and npm
- `uv` (recommended) or standard `python -m venv`

### One-Command Setup

```bash
# 1. Setup virtual environment and dependencies
make setup

# 2. Run all unit tests (target leakage + API health)
make test

# 3. Start FastAPI backend (http://localhost:8000)
make api

# 4. In a separate terminal, start Vite frontend (http://localhost:5173)
make web
```

---

## Available Make Targets

| Command | Description |
| :--- | :--- |
| `make setup` | Create Python venv, install Python deps and npm web packages |
| `make train` | Execute reproducible ML model training pipeline |
| `make api` | Launch FastAPI uvicorn dev server on port 8000 |
| `make web` | Launch Vite React dev server on port 5173 |
| `make test` | Run pytest suite (leakage prevention, schemas, endpoints) |
| `make lint` | Run Ruff linter and TypeScript type check |

---

## Deployment (Vercel)

The web frontend is pre-configured for **Vercel** with zero-configuration monorepo support.
- **Frontend**: Connect repository to [Vercel](https://vercel.com/new). The root [`vercel.json`](file:///Users/pranavoswal/Downloads/CardioMap3D-main/vercel.json) handles building the Vite app and SPA routing.
- **Backend**: Deploy the containerized FastAPI service via [`Dockerfile`](file:///Users/pranavoswal/Downloads/CardioMap3D-main/Dockerfile) on Render, Railway, or Fly.io.
- **Linking**: Set `VITE_API_URL` in Vercel project environment variables to point to your backend.

See [`docs/DEPLOYMENT.md`](file:///Users/pranavoswal/Downloads/CardioMap3D-main/docs/DEPLOYMENT.md) for full step-by-step instructions.
