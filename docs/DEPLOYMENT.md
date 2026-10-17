# CardioMap 3D Deployment Guide (Vercel & Full-Stack)

This document provides complete instructions for deploying the **CardioMap 3D** application to **Vercel** (frontend) and connecting it to the production **FastAPI backend** (ML inference).

---

## 1. Architecture Overview

CardioMap 3D is a production monorepo containing:
- **Frontend (`web/`)**: Vite + React 19 + TypeScript + Tailwind CSS + React Three Fiber (3D heart rendering) + Recharts.
- **Backend (`api/`)**: FastAPI + Pydantic v2 + scikit-learn / XGBoost inference pipeline + SHAP explainers.
- **Artifacts (`artifacts/`)**: Calibrated ML models (`model_y_cad.joblib`, `model_y_lad.joblib`, etc.), thresholds, schemas, and metrics.

> **Why separate frontend and backend hosting?**  
> Vercel's serverless function uncompressed bundle limit is **250 MB**. The Python ML stack (`scikit-learn`, `xgboost`, `shap`, `scipy`, `numpy`, `pandas`) exceeds 650 MB and requires dedicated memory for real-time KernelExplainer SHAP calculations. Therefore:
> - **Frontend** is deployed to **Vercel** (global edge CDN, instant loads, automatic SSL).
> - **Backend** is deployed using the included container [`Dockerfile`](file:///Users/pranavoswal/Downloads/CardioMap3D-main/Dockerfile) to **Render**, **Railway**, **Fly.io**, or **Hugging Face Spaces**.

---

## 2. Deploying Frontend to Vercel

The repository is pre-configured with:
- [`vercel.json`](file:///Users/pranavoswal/Downloads/CardioMap3D-main/vercel.json): Monorepo build and SPA rewrite routing rules.
- [`web/vercel.json`](file:///Users/pranavoswal/Downloads/CardioMap3D-main/web/vercel.json): Sub-directory deployment configuration.
- [`.vercelignore`](file:///Users/pranavoswal/Downloads/CardioMap3D-main/.vercelignore): Excludes heavy Python binaries and data splits from web uploads.
- [`package.json`](file:///Users/pranavoswal/Downloads/CardioMap3D-main/package.json): Root build and dev scripts.

### Method A: Deploy via Vercel Web Dashboard (Recommended)

1. Push your latest changes to GitHub:
   ```bash
   git add .
   git commit -m "Configure Vercel deployment and monorepo build settings"
   git push origin main
   ```
2. Navigate to [vercel.com/new](https://vercel.com/new) and log in.
3. Select your GitHub repository: **`pranavoswal007/CardioMap3D-Main`**.
4. Configure Project Settings:
   - **Framework Preset**: `Vite` (automatically detected)
   - **Root Directory**: `./` (or `web` if deploying only the web directory)
   - **Build Command**: `cd web && npm run build` (or leave default if Root Directory is `web`)
   - **Output Directory**: `web/dist` (or `dist` if Root Directory is `web`)
5. In **Environment Variables**, add:
   - `VITE_API_URL`: Your deployed FastAPI backend URL (e.g., `https://cardiomap3d-api.onrender.com`).
6. Click **Deploy**. Vercel will build the frontend and provide your production URL (e.g. `https://cardiomap3d.vercel.app`).

---

### Method B: Deploy via Vercel CLI

1. Authenticate with your Vercel account:
   ```bash
   npx vercel login
   ```
2. Deploy the project:
   ```bash
   # Preview deployment
   npx vercel

   # Production deployment
   npx vercel --prod
   ```
3. Set your backend URL via CLI:
   ```bash
   npx vercel env add VITE_API_URL production
   ```

---

## 3. Deploying the FastAPI ML Backend

Deploy the backend using the included production [`Dockerfile`](file:///Users/pranavoswal/Downloads/CardioMap3D-main/Dockerfile):

### Option A: Render (Free / Low Cost Web Service)
1. Go to [dashboard.render.com](https://dashboard.render.com) -> **New** -> **Web Service**.
2. Connect `pranavoswal007/CardioMap3D-Main`.
3. Choose **Docker** environment (Render automatically uses the root `Dockerfile`).
4. Port: `8000`.
5. Health Check Path: `/health`.
6. Once deployed, copy your Render service URL (e.g. `https://cardiomap3d-api.onrender.com`) and set it as `VITE_API_URL` in Vercel.

### Option B: Railway
1. Go to [railway.app](https://railway.app) -> **New Project** -> **Deploy from GitHub repo**.
2. Select `pranavoswal007/CardioMap3D-Main`.
3. Railway automatically detects `Dockerfile` and builds the container.
4. Add a public domain under service settings and copy the domain to Vercel's `VITE_API_URL`.

### Option C: Fly.io
1. Install Fly CLI: `brew install flyctl`
2. Launch app: `fly launch` (detects Dockerfile).
3. Deploy: `fly deploy`.
4. Copy `https://<your-app>.fly.dev` to Vercel's `VITE_API_URL`.

---

## 4. Verification Checklist

- [ ] Vercel build succeeds (`npm run build` exits 0).
- [ ] Root route loads 3D Heart Viewer with interactive rotation/pan.
- [ ] Tabs (`Patient Assessment`, `Model Validation`, `About & Safety`) navigate smoothly with SPA routing.
- [ ] API status indicator shows **Online** when `VITE_API_URL` is set to live backend.
- [ ] Risk assessment predictions and SHAP feature attributions display upon submitting patient data.
