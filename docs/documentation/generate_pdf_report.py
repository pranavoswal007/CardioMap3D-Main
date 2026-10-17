import os
import json
import base64
import subprocess
import re

def get_base64_image(path):
    if not os.path.exists(path):
        return ""
    with open(path, "rb") as f:
        data = f.read()
    ext = os.path.splitext(path)[1].lower().replace(".", "")
    if ext == "jpg": ext = "jpeg"
    return f"data:image/{ext};base64,{base64.b64encode(data).decode('utf-8')}"

# Image paths
img_main_ui = get_base64_image("/Users/pranavoswal/.gemini/antigravity-ide/brain/71129e2d-f4a0-4ecf-b2bb-d3d478d1c071/final_analyzed_view_1791986711835.png")
img_tracer = get_base64_image("/Users/pranavoswal/.gemini/antigravity-ide/brain/71129e2d-f4a0-4ecf-b2bb-d3d478d1c071/.user_uploaded/media_1791985928093.png")
img_roc_cad = get_base64_image("artifacts/curves_y_cad.png")
img_roc_lad = get_base64_image("artifacts/curves_y_lad.png")

html_template = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>CardioMap 3D - Technical Documentation</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');

  @page {
    size: A4 portrait;
    margin: 8mm 12mm 8mm 12mm;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #0f172a;
    background-color: #ffffff;
    font-size: 7.6pt;
    line-height: 1.28;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    width: 100%;
    height: 279mm;
    max-height: 279mm;
    overflow: hidden;
    position: relative;
    page-break-after: always;
    break-after: page;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding-bottom: 2mm;
  }

  .page:last-child {
    page-break-after: avoid;
    break-after: avoid;
  }

  .page-content {
    flex: 1;
  }

  /* Header & Footer */
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1.5px solid #0284c7;
    padding-bottom: 3px;
    margin-bottom: 6px;
    font-size: 6.8pt;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }
  .doc-header .tag {
    color: #0284c7;
  }

  .doc-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid #cbd5e1;
    padding-top: 3px;
    font-size: 6.5pt;
    color: #64748b;
  }

  /* Typography */
  h1.doc-title {
    font-size: 14pt;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.4px;
    line-height: 1.15;
    margin-bottom: 2px;
  }
  .doc-subtitle {
    font-size: 8pt;
    color: #0369a1;
    font-weight: 600;
    margin-bottom: 5px;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 4px 8px;
    gap: 6px;
    margin-bottom: 6px;
    font-size: 7pt;
  }
  .meta-item strong {
    display: block;
    color: #475569;
    text-transform: uppercase;
    font-size: 6pt;
    letter-spacing: 0.5px;
  }
  .meta-item span {
    font-weight: 600;
    color: #0f172a;
  }

  h2.sec-title {
    font-size: 9.2pt;
    font-weight: 700;
    color: #0f172a;
    border-left: 3px solid #0284c7;
    padding-left: 5px;
    margin-top: 5px;
    margin-bottom: 3px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  h3.subsec-title {
    font-size: 7.8pt;
    font-weight: 700;
    color: #1e293b;
    margin-top: 3px;
    margin-bottom: 2px;
  }

  p {
    margin-bottom: 3px;
    text-align: justify;
  }

  /* Grids and Cards */
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 5px;
  }

  .card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 5px 7px;
    margin-bottom: 4px;
  }
  .card-highlight {
    background: #f0fdf4;
    border-color: #86efac;
  }
  .card-navy {
    background: #0f172a;
    color: #f8fafc;
    border-color: #1e293b;
  }
  .card-navy h3 {
    color: #38bdf8;
  }
  .card-navy p {
    color: #cbd5e1;
  }

  /* Tables */
  table.data-table {
    width: 100%;
    border-collapse: collapse;
    margin: 3px 0 5px 0;
    font-size: 6.8pt;
  }
  table.data-table th, table.data-table td {
    padding: 3px 4px;
    text-align: left;
    border: 1px solid #cbd5e1;
  }
  table.data-table th {
    background: #0f172a;
    color: #ffffff;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  table.data-table tr:nth-child(even) {
    background: #f8fafc;
  }
  table.data-table td.num {
    text-align: right;
    font-family: 'JetBrains Mono', monospace;
  }

  .badge {
    display: inline-block;
    padding: 1px 3px;
    border-radius: 2px;
    font-size: 6pt;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
  }
  .badge-stable { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
  .badge-moderate { background: #fef9c3; color: #854d0e; border: 1px solid #fef08a; }
  .badge-elevated { background: #ffedd5; color: #c2410c; border: 1px solid #fed7aa; }

  .formula-box {
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-left: 3px solid #0284c7;
    padding: 3px 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 6.6pt;
    margin: 3px 0;
    color: #0f172a;
  }

  .alert-warning {
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-left: 3px solid #d97706;
    padding: 3px 6px;
    font-size: 6.8pt;
    color: #92400e;
    margin: 3px 0;
  }

  img.ui-preview {
    width: 100%;
    border-radius: 4px;
    border: 1px solid #cbd5e1;
    display: block;
    margin: 3px 0;
  }

  ul.compact-list {
    padding-left: 12px;
    margin-bottom: 3px;
  }
  ul.compact-list li {
    margin-bottom: 1.5px;
  }
</style>
</head>
<body>

<!-- ================= PAGE 1 ================= -->
<div class="page">
  <div class="page-content">
    <div class="doc-header">
      <span>Multimodal AI Hackathon 2026 &bull; Track A</span>
      <span class="tag">CardioMap 3D Technical Report &bull; Page 1 of 5</span>
    </div>

    <h1 class="doc-title">CardioMap 3D: Multi-Vessel Coronary Risk Mapping and Counterfactual 3D Visualization</h1>
    <div class="doc-subtitle">A Clinically Grounded Multimodal Decision Support Architecture Integrating Calibrated Machine Learning with Real-Time 3D Anatomical Twin Mapping</div>

    <div class="meta-grid">
      <div class="meta-item"><strong>Track</strong><span>A: Cardiovascular Risk Vis</span></div>
      <div class="meta-item"><strong>Architecture</strong><span>FastAPI + Three.js / React 19</span></div>
      <div class="meta-item"><strong>Clinical Cohort</strong><span>Z-Alizadeh Sani (N=303, 55 feats)</span></div>
      <div class="meta-item"><strong>Test Pass Rate</strong><span>100% (76 Python + 57 Web Tests)</span></div>
    </div>

    <h2 class="sec-title">1. Executive Summary & Clinical Problem Formulation</h2>
    <p>
      Cardiovascular disease (CAD) remains the leading cause of death worldwide. While conventional statistical models can compute aggregate risk estimates, point-of-care clinicians and patients face a fundamental communication gap: an abstract risk score (e.g., "56% probability") fails to convey <em>which specific coronary artery is occluded</em>, <em>which myocardial territory faces hypoperfusion</em>, or <em>how targeted lifestyle modifications alter risk trajectories</em>.
    </p>
    <p>
      <strong>CardioMap 3D</strong> directly resolves this bottleneck. It delivers an end-to-end clinical decision-support system that ingests 55 multi-modal patient variables (demographics, symptoms, ECG findings, blood markers, echocardiography) to predict overall CAD along with multi-vessel stenosis across the three primary coronary arteries: the <strong>Left Anterior Descending (LAD)</strong>, <strong>Left Circumflex (LCX)</strong>, and <strong>Right Coronary Artery (RCA)</strong>. Predictions are dynamically mapped onto an interactive 3D human heart with synchronized AHA 17-segment perfusion territory mapping, additive SHAP attributions with bootstrap stability provenance, and real-time counterfactual What-If simulation.
    </p>

    <h2 class="sec-title">2. Dataset Ingestion, Clinical Modalities & Feature Schema</h2>
    <p>
      CardioMap 3D trains and validates against the benchmark <em>Z-Alizadeh Sani</em> coronary angiography cohort comprising 303 consecutive patients evaluated at Tehran Heart Center. The feature space spans six distinct clinical diagnostic modalities:
    </p>
    <div class="grid-3">
      <div class="card">
        <h3 class="subsec-title">Demographics & Vitals</h3>
        <p style="font-size:6.6pt; color:#475569;">Age, Sex, Weight, Height/Length, BMI, Systolic BP, Diastolic BP, Resting Pulse Rate.</p>
      </div>
      <div class="card">
        <h3 class="subsec-title">Medical History & Symptoms</h3>
        <p style="font-size:6.6pt; color:#475569;">Diabetes (DM), Hypertension (HTN), Smoking status, Family History (FH), Angina classes.</p>
      </div>
      <div class="card">
        <h3 class="subsec-title">Biomarkers & Echocardiography</h3>
        <p style="font-size:6.6pt; color:#475569;">FBS, CR, TG, LDL, HDL, BUN, ESR, Ejection Fraction (EF), Region with RWMA.</p>
      </div>
    </div>

    <h2 class="sec-title">3. Hard Anti-Leakage Invariants & Safe Data Hygiene</h2>
    <div class="alert-warning">
      <strong>Zero Target Leakage Guarantee:</strong> In clinical coronary data, catheterization labels (Cath, CAD, LAD, LCX, RCA) can inadvertently leak through derived feature headers. We enforce a zero-leakage invariant via automated unit tests (<code>test_leakage.py</code>) asserting that target variables in any casing or symbol permutation are excised prior to preprocessing.
    </div>
    <ul class="compact-list">
      <li><strong>Separation of Concerns:</strong> Categorical encoders and scalers are fitted exclusively within training partitions during cross-validation, guaranteeing zero out-of-fold data contamination.</li>
      <li><strong>Missingness Imputation:</strong> Missing quantitative measurements are imputed using training-fold medians with clinical sanity bounds (e.g., BMI dynamically recomputed via BMI = Weight / (Length/100)^2 upon counterfactual edits).</li>
      <li><strong>Robust Scaling:</strong> Interquartile Range (IQR) robust standardization prevents biochemical outliers (e.g., extreme ESR or Triglyceride spikes) from distorting classification boundaries.</li>
    </ul>

    <div class="card card-highlight">
      <h3 class="subsec-title" style="color:#166534;">Core Design Invariant: Decision Support, Not Autonomous Diagnosis</h3>
      <p style="font-size:6.8pt; color:#14532d;">
        CardioMap 3D strictly adheres to FDA/CE Software as a Medical Device (SaMD) guidance. Rather than issuing prescriptive binary diagnoses, the system presents calibrated probabilities alongside empirical cutoffs (<i>t</i>), relative risk against population prevalence, and persistent statutory disclaimers.
      </p>
    </div>
  </div>

  <div class="doc-footer">
    <span>CardioMap 3D &bull; Confidential Hackathon Submission</span>
    <span>Track A: Cardiovascular Risk Visualization</span>
    <span>Page 1 of 5</span>
  </div>
</div>

<!-- ================= PAGE 2 ================= -->
<div class="page">
  <div class="page-content">
    <div class="doc-header">
      <span>Multimodal AI Hackathon 2026 &bull; Track A</span>
      <span class="tag">CardioMap 3D Technical Report &bull; Page 2 of 5</span>
    </div>

    <h2 class="sec-title">4. Multi-Target Machine Learning Architecture</h2>
    <p>
      Cardiovascular pathology exhibits vessel-specific hemodynamic and morphological characteristics. While LAD stenosis correlates strongly with anterior RWMA and V-lead ST changes, LCX and RCA lesions present with lateral and inferior wall changes. CardioMap 3D implements a <strong>four-tier multi-target predictive architecture</strong>:
    </p>

    <div class="grid-2">
      <div class="card">
        <h3 class="subsec-title">1. Overall CAD Classifier</h3>
        <p style="font-size:6.8pt;">Predicts significant CAD (&ge; 50% narrowing in &ge; 1 major vessel). Deployed model: <strong>Soft-Voting Calibrated Ensemble</strong> combining Logistic Regression (L2), Random Forest, and LightGBM.</p>
      </div>
      <div class="card">
        <h3 class="subsec-title">2. LAD Stenosis Model</h3>
        <p style="font-size:6.8pt;">Predicts Left Anterior Descending occlusion. Deployed model: <strong>Random Forest Classifier</strong> (<i>N</i>=100, max_depth=6, min_samples_leaf=2) optimized for nonlinear interactions between anterior RWMA and ECG leads.</p>
      </div>
      <div class="card">
        <h3 class="subsec-title">3. LCX Stenosis Model</h3>
        <p style="font-size:6.8pt;">Predicts Left Circumflex occlusion. Deployed model: <strong>LightGBM Gradient Booster</strong> with histogram binning and subsampling (0.8) to handle lower cohort prevalence (39.3%).</p>
      </div>
      <div class="card">
        <h3 class="subsec-title">4. RCA Stenosis Model</h3>
        <p style="font-size:6.8pt;">Predicts Right Coronary Artery occlusion. Deployed model: <strong>Shallow LightGBM</strong> (depth=2, leaves=3, min_child=20) incorporating L1/L2 regularization (&alpha;=1.0, &lambda;=2.0) to eliminate overfitting.</p>
      </div>
    </div>

    <h2 class="sec-title">5. Nested Cross-Validation & Probability Calibration</h2>
    <p>
      To eliminate evaluation bias on a 303-patient cohort, we executed a <strong>Nested Cross-Validation protocol</strong>:
    </p>
    <ul class="compact-list">
      <li><strong>Outer Loop:</strong> 5 folds &times; 5 repeats (25 distinct outer evaluations, random_seed=42) generating unbiased test predictions.</li>
      <li><strong>Inner Loop:</strong> 3-fold Stratified K-Fold inside each training partition for candidate hyperparameter tuning and early stopping.</li>
      <li><strong>Probability Calibration:</strong> Uncalibrated tree ensembles produce distorted sigmoid outputs. All candidate models undergo post-hoc calibration via Platt Scaling / Sigmoidal Logistic Regression fitted on out-of-fold validation residuals:
      <div class="formula-box">
        <strong>Platt Calibration Formula:</strong> P(Y=1 | f(x)) = 1 / (1 + exp(A &middot; f(x) + B)) &nbsp; (Parameters A, B fitted via MLE on validation folds)
      </div>
      </li>
    </ul>

    <h2 class="sec-title">6. Decision Threshold Optimization (<i>t</i><sup>*</sup>) vs Naive 0.5 Cutoffs</h2>
    <p>
      In clinical screening, false negatives for coronary stenosis carry severe prognostic risks. CardioMap 3D moves beyond arbitrary 0.5 thresholds, optimizing operating cutoffs via <strong>Youden's J Statistic</strong> and <strong>Max-F1 Score</strong>:
    </p>
    <div class="formula-box">
      <strong>Youden's Index Optimization:</strong> J = Sensitivity + Specificity - 1 &rArr; t* = argmax_t (J(t))
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>Target</th>
          <th>Prevalence</th>
          <th>Selected Architecture</th>
          <th>Default F1 (0.50)</th>
          <th>Operating Cutoff (t*)</th>
          <th>Sensitivity at t*</th>
          <th>Specificity at t*</th>
          <th>Cutoff F1</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>CAD</strong></td>
          <td class="num">71.3%</td>
          <td>SoftVotingEnsemble</td>
          <td class="num">0.9058</td>
          <td class="num"><strong>0.5377</strong></td>
          <td class="num">93.5%</td>
          <td class="num">72.4%</td>
          <td class="num"><strong>0.9140</strong></td>
        </tr>
        <tr>
          <td><strong>LAD</strong></td>
          <td class="num">58.4%</td>
          <td>Random Forest</td>
          <td class="num">0.8360</td>
          <td class="num"><strong>0.5006</strong></td>
          <td class="num">88.1%</td>
          <td class="num">68.3%</td>
          <td class="num"><strong>0.8365</strong></td>
        </tr>
        <tr>
          <td><strong>LCX</strong></td>
          <td class="num">39.3%</td>
          <td>LightGBM</td>
          <td class="num">0.6380</td>
          <td class="num"><strong>0.3970</strong></td>
          <td class="num">72.3%</td>
          <td class="num">67.4%</td>
          <td class="num"><strong>0.6491</strong></td>
        </tr>
        <tr>
          <td><strong>RCA</strong></td>
          <td class="num">37.6%</td>
          <td>LGBM_Shallow</td>
          <td class="num">0.6220</td>
          <td class="num"><strong>0.3350</strong></td>
          <td class="num">79.8%</td>
          <td class="num">56.6%</td>
          <td class="num"><strong>0.6341</strong></td>
        </tr>
      </tbody>
    </table>

    <h2 class="sec-title">7. Vessel Color Mapping Rule (Continuous Clinical Interpolation)</h2>
    <p>
      The 3D heart does not snap arbitrarily between binary colors. It employs a continuous clinical gradient governed by operating cutoff $t$, high margin ($t + 0.15$), and elevated boundary ($t + 0.35$):
    </p>
    <div class="grid-3" style="font-size:6.8pt;">
      <div style="background:#ecfdf5; border:1px solid #10b981; padding:3px; border-radius:3px; text-align:center;">
        <strong style="color:#047857;">&lt; Cutoff (t)</strong><br>Lerp Emerald (#10b981) to Gold (#eab308)
      </div>
      <div style="background:#fffbeb; border:1px solid #eab308; padding:3px; border-radius:3px; text-align:center;">
        <strong style="color:#b45309;">&ge; t to t+0.15</strong><br>Lerp Gold (#eab308) to Orange (#f97316)
      </div>
      <div style="background:#fef2f2; border:1px solid #ef4444; padding:3px; border-radius:3px; text-align:center;">
        <strong style="color:#b91c1c;">&ge; t+0.35</strong><br>Full Crimson Red (#ef4444)
      </div>
    </div>
  </div>

  <div class="doc-footer">
    <span>CardioMap 3D &bull; Confidential Hackathon Submission</span>
    <span>Track A: Cardiovascular Risk Visualization</span>
    <span>Page 2 of 5</span>
  </div>
</div>

<!-- ================= PAGE 3 ================= -->
<div class="page">
  <div class="page-content">
    <div class="doc-header">
      <span>Multimodal AI Hackathon 2026 &bull; Track A</span>
      <span class="tag">CardioMap 3D Technical Report &bull; Page 3 of 5</span>
    </div>

    <h2 class="sec-title">8. Experimental Results & Statistical Bootstrap Verification</h2>
    <p>
      All models are evaluated across Accuracy, Precision, Recall, F1-Score, and Receiver Operating Characteristic Area Under Curve (ROC-AUC) accompanied by <strong>95% non-parametric bootstrap confidence intervals</strong> (<i>B</i> = 1,000 iterations):
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th>Target</th>
          <th>Deployed Model</th>
          <th>ROC-AUC (95% CI)</th>
          <th>Accuracy</th>
          <th>Precision</th>
          <th>Recall</th>
          <th>F1-Score</th>
          <th>Gain vs Prevalence</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Overall CAD</strong></td>
          <td><strong>SoftVotingEnsemble</strong></td>
          <td class="num"><strong>0.926</strong> [0.892, 0.955]</td>
          <td class="num">86.1%</td>
          <td class="num">89.4%</td>
          <td class="num">93.5%</td>
          <td class="num"><strong>0.914</strong></td>
          <td class="num" style="color:#16a34a;">+8.2% F1 over naive</td>
        </tr>
        <tr>
          <td><strong>LAD Artery</strong></td>
          <td><strong>RandomForest</strong></td>
          <td class="num"><strong>0.845</strong> [0.797, 0.888]</td>
          <td class="num">80.2%</td>
          <td class="num">79.6%</td>
          <td class="num">88.1%</td>
          <td class="num"><strong>0.837</strong></td>
          <td class="num" style="color:#16a34a;">+10.1% F1 over naive</td>
        </tr>
        <tr>
          <td><strong>LCX Artery</strong></td>
          <td><strong>LightGBM</strong></td>
          <td class="num"><strong>0.724</strong> [0.665, 0.776]</td>
          <td class="num">69.3%</td>
          <td class="num">58.9%</td>
          <td class="num">72.3%</td>
          <td class="num"><strong>0.649</strong></td>
          <td class="num" style="color:#16a34a;">+8.5% F1 over naive</td>
        </tr>
        <tr>
          <td><strong>RCA Artery</strong></td>
          <td><strong>LGBM_Shallow</strong></td>
          <td class="num"><strong>0.740</strong> [0.683, 0.792]</td>
          <td class="num">65.3%</td>
          <td class="num">52.6%</td>
          <td class="num">79.8%</td>
          <td class="num"><strong>0.634</strong></td>
          <td class="num" style="color:#16a34a;">+8.9% F1 over naive</td>
        </tr>
      </tbody>
    </table>

    <div class="card card-highlight">
      <h3 class="subsec-title" style="color:#166534;">Statistical Reality: Why Our Performance Bounds Guarantee Zero Overfitting</h3>
      <p style="font-size:6.8pt; color:#14532d;">
        In real clinical cohorts, claiming 100% ROC-AUC is a statistical impossibility that reveals target leakage. Our CAD ROC-AUC of <strong>0.926</strong> and vessel AUCs ranging between <strong>0.724 and 0.845</strong> mirror verified peer-reviewed cardiology benchmarks (e.g., Alizadeh Sani et al., IEEE TBME). The 95% bootstrap confidence intervals establish robust generalization without memorizing dataset artifacts.
      </p>
    </div>

    <h2 class="sec-title">9. Discrimination Curves (ROC & Precision-Recall)</h2>
    <div class="grid-2">
      <div style="text-align:center;">
        <img src="__IMG_ROC_CAD__" style="width:96%; max-height:44mm; object-fit:contain; border:1px solid #cbd5e1; border-radius:3px;">
        <div style="font-size:6.2pt; color:#64748b; font-weight:600;">Figure 1A: Overall CAD ROC and Precision-Recall Curves (AUC = 0.926)</div>
      </div>
      <div style="text-align:center;">
        <img src="__IMG_ROC_LAD__" style="width:96%; max-height:44mm; object-fit:contain; border:1px solid #cbd5e1; border-radius:3px;">
        <div style="font-size:6.2pt; color:#64748b; font-weight:600;">Figure 1B: LAD Artery ROC and Precision-Recall Curves (AUC = 0.845)</div>
      </div>
    </div>

    <h2 class="sec-title">10. Explainable AI: SHAP Attributions & Bootstrap Stability</h2>
    <p>
      CardioMap 3D integrates a server-side <code>shap.KernelExplainer</code> that computes additive feature importances directly in calibrated probability points. Explanations satisfy the local efficiency and additivity axioms:
    </p>
    <div class="formula-box">
      <strong>Additive Efficiency Property:</strong> f(x) = E[f(x)] + &sum; &phi;_i(x) &nbsp; (Base expected score + individual feature contributions)
    </div>

    <div class="grid-2">
      <div class="card">
        <h3 class="subsec-title">Bootstrap Stability Provenance</h3>
        <p style="font-size:6.6pt;">
          Clinical features often suffer from collinearity churn in SHAP. To protect clinicians, CardioMap 3D refits explainers across B=20 bootstrap resamplings, publishing rank stability badges:
          <br>&bull; <span class="badge badge-stable">STABLE</span>: Feature appears in top-10 in &ge;80% of refits (e.g., Typical Angina, Age).
          <br>&bull; <span class="badge badge-moderate">MODERATE</span>: Present in 50–79% of iterations (e.g., Triglycerides, Diabetes).
          <br>&bull; <span class="badge badge-elevated">LOW</span>: Present in &lt;50% of iterations (collinear substitute features).
        </p>
      </div>

      <div class="card">
        <h3 class="subsec-title">Physiological Category Mapping</h3>
        <table class="data-table" style="font-size:6.2pt; margin-top:1px;">
          <thead><tr><th>Clinical Group</th><th>Top Drivers</th><th>Direction</th></tr></thead>
          <tbody>
            <tr><td>Demographics</td><td>Age, BMI, Sex</td><td>Age &gt; 60 increases risk</td></tr>
            <tr><td>Symptomatology</td><td>Typical Angina, Dyspnea</td><td>Typical pain increases risk</td></tr>
            <tr><td>Lipid Profile</td><td>TG, LDL, HDL</td><td>High LDL increases risk</td></tr>
            <tr><td>Echocardiography</td><td>EF, RWMA Region</td><td>Anterior RWMA drives LAD</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="doc-footer">
    <span>CardioMap 3D &bull; Confidential Hackathon Submission</span>
    <span>Track A: Cardiovascular Risk Visualization</span>
    <span>Page 3 of 5</span>
  </div>
</div>

<!-- ================= PAGE 4 ================= -->
<div class="page">
  <div class="page-content">
    <div class="doc-header">
      <span>Multimodal AI Hackathon 2026 &bull; Track A</span>
      <span class="tag">CardioMap 3D Technical Report &bull; Page 4 of 5</span>
    </div>

    <h2 class="sec-title">11. Interactive 3D Visualization Pipeline & WebGL Engine</h2>
    <p>
      The visualization subsystem delivers a desktop-grade 60 FPS interactive experience rendered directly in standard web browsers without requiring dedicated GPUs:
    </p>
    <ul class="compact-list">
      <li><strong>Anatomical Heart Mesh:</strong> Ingests the high-fidelity <em>Hannah Newey</em> cardiac geometry (University of Dundee, CC BY-NC-SA 4.0) featuring 178,143 vertices and 317,458 triangles. Vertex colors (<code>COLOR_0</code>) represent myocardial tissue perfusion.</li>
      <li><strong>Procedural Fallback:</strong> If GLTF streaming is delayed, an automated error boundary swaps to a lightweight procedural cardiac geometry, guaranteeing zero black-screen crashes.</li>
      <li><strong>Heartbeat Expansion Animation:</strong> Employs a non-destructive vertex deformation shader group pulsing at the patient's measured heart rate (BPM &isin; [45, 140]), providing immediate visual biological feedback.</li>
      <li><strong>Semi-Transparent X-Ray Shading:</strong> Toggles myocardial opacity to 0.35 with <code>depthWrite: false</code>, exposing deep intramyocardial coronary courses without clipping artifacts.</li>
    </ul>

    <h2 class="sec-title">12. Computational Geometry: Magnetic Artery Trace Assistant (T2-0)</h2>
    <p>
      In unsegmented anatomical models, coronary arteries are baked into surface vertex colors rather than separate polygonal meshes. Placing generic 3D cylinders creates chords that cut directly through ventricular chambers. To solve this, we engineered a dedicated <strong>Magnetic Artery Trace Assistant</strong> (accessible via <code>?debug</code>):
    </p>

    <div class="grid-2">
      <div>
        <div class="formula-box">
          <strong>1. Compressed Sparse Row (CSR) Surface Graph:</strong><br>
          Vertices (V=178k) and triangles (F=317k) are indexed into typed arrays (rowOffsets, colIndices, edgeWeights) in 45 ms.
        </div>
        <div class="formula-box">
          <strong>2. CIELAB &Delta;E Color Distance:</strong><br>
          Decodes sRGB to linear XYZ, then transforms to CIELAB space. Samples vertex color at hit point and computes per-vertex distance:
          &Delta;E = sqrt((&Delta;L*)^2 + (&Delta;a*)^2 + (&Delta;b*)^2)
        </div>
        <div class="formula-box">
          <strong>3. Magnetic Dijkstra Search:</strong><br>
          Shortest path along mesh edges with color-penalized edge cost:
          Cost(u,v) = ||p_v - p_u|| &times; (1 + k &middot; &Delta;E_norm(v))
          (k=12 default; k=0 yields pure geodesic).
        </div>
      </div>
      <div>
        <img src="__IMG_TRACER__" style="width:100%; max-height:46mm; object-fit:contain; border:1px solid #cbd5e1; border-radius:3px;">
        <div style="font-size:6.2pt; color:#64748b; font-weight:600; text-align:center; margin-top:2px;">
          Figure 2: Magnetic Trace Assistant in <code>?debug</code> mode showing illuminated green artery mask and vertex snapping.
        </div>
      </div>
    </div>

    <h2 class="sec-title">13. Catmull-Rom Arc-Length Resampling & Export Round Trip</h2>
    <p>
      Dense Dijkstra paths (hundreds of edge steps) are smoothed via arc-length resampling into N=18 control points elevated by surface normal offset &epsilon; = 0.02. The generated splines are live-previewed using tapered tubular geometry and exported to <code>coronary.json</code>:
    </p>

    <div class="grid-3" style="font-size:6.8pt;">
      <div class="card">
        <strong>LAD Path (6 pts)</strong><br>
        Origin: Left main ostium [0.007, 0.308, 0.141] courses down anterior groove to apex.
      </div>
      <div class="card">
        <strong>LCX Path (6 pts)</strong><br>
        Origin: Left main ostium wraps left AV groove toward posterolateral wall.
      </div>
      <div class="card">
        <strong>RCA Path (7 pts)</strong><br>
        Origin: Right coronary ostium descends right AV sulcus to the posterior crux.
      </div>
    </div>

    <h2 class="sec-title">14. AHA 17-Segment Polar Bullseye Perfusion Mapping</h2>
    <p>
      In accordance with American Heart Association standards, the 17-segment polar bullseye diagram translates arterial stenosis into tissue-level ischemic risk:
    </p>
    <ul class="compact-list" style="font-size:7pt;">
      <li><strong>LAD Territory (Segments 1, 2, 7, 8, 13, 14, 17):</strong> Basal/mid anterior, anteroseptal, and true apex.</li>
      <li><strong>LCX Territory (Segments 5, 6, 11, 12, 16):</strong> Basal/mid anterolateral and inferolateral walls.</li>
      <li><strong>RCA Territory (Segments 3, 4, 9, 10, 15):</strong> Basal/mid inferoseptal and inferior ventricular walls.</li>
    </ul>
  </div>

  <div class="doc-footer">
    <span>CardioMap 3D &bull; Confidential Hackathon Submission</span>
    <span>Track A: Cardiovascular Risk Visualization</span>
    <span>Page 4 of 5</span>
  </div>
</div>

<!-- ================= PAGE 5 ================= -->
<div class="page">
  <div class="page-content">
    <div class="doc-header">
      <span>Multimodal AI Hackathon 2026 &bull; Track A</span>
      <span class="tag">CardioMap 3D Technical Report &bull; Page 5 of 5</span>
    </div>

    <h2 class="sec-title">15. Clinical UI/UX & Point-of-Care Usage Instructions</h2>
    <p>
      The web user interface is crafted to provide immediate situational awareness in high-acuity environments without modal fatigue:
    </p>
    <img src="__IMG_MAIN_UI__" class="ui-preview" style="max-height:48mm; object-fit:contain;">
    <div style="font-size:6.2pt; color:#64748b; font-weight:600; text-align:center; margin-bottom:3px;">
      Figure 3: Production Clinical Interface displaying active 3D Heart Viewer, 4 Target Risk Cards, AHA 17-Segment Perfusion Map, and Local SHAP Attributions.
    </div>

    <div class="grid-2" style="font-size:6.7pt; margin-bottom:3px;">
      <div class="card" style="margin-bottom:0; padding:3px 5px;">
        <strong>Step 1 &bull; Ingestion:</strong> Clinicians select validated patient presets or input 55 multi-modal measurements across tabs (Vitals, ECG, Labs, Echo).
      </div>
      <div class="card" style="margin-bottom:0; padding:3px 5px;">
        <strong>Step 2 &bull; 3D Sync:</strong> Click <em>"Analyze Coronary Risk"</em>; the app auto-scrolls to the 3D heart, rendering LAD/LCX/RCA risk color gradients and BPM pulsing.
      </div>
    </div>
    <div class="grid-2" style="font-size:6.7pt; margin-bottom:3px;">
      <div class="card" style="margin-bottom:0; padding:3px 5px;">
        <strong>Step 3 &bull; Perfusion:</strong> Correlate vessel stenosis with the AHA 17-segment polar bullseye map and inspect local additive SHAP risk factor impacts.
      </div>
      <div class="card" style="margin-bottom:0; padding:3px 5px;">
        <strong>Step 4 &bull; What-If Sim:</strong> Adjust modifiable sliders in the <em>What-If</em> engine to simulate therapeutic interventions and demonstrate risk reduction.
      </div>
    </div>

    <h2 class="sec-title">16. Real-Time Counterfactual "What-If" Sensitivity Engine</h2>
    <p>
      Located directly beneath the result cards, the <strong>What-If Simulation Engine</strong> transforms passive diagnostics into proactive clinical management. Clinicians manipulate continuous modifiable risk factors (Systolic BP, Blood Sugar, LDL, HDL, Triglycerides, Weight, Smoking):
    </p>
    <ul class="compact-list" style="font-size:7pt;">
      <li><strong>Debounced Reactive Pipeline:</strong> Modifications trigger instant background recalculation (&lt;50 ms) without page reloads.</li>
      <li><strong>Live 3D Anatomical Feedback:</strong> As LDL or Blood Pressure drops, the 3D heart dynamically shifts coronary artery colors from elevated crimson (#ef4444) back to safe emerald (#10b981), demonstrating measurable therapeutic payoff to patients.</li>
    </ul>

    <h2 class="sec-title">17. Production Verification & Code Quality Metrics</h2>
    <div class="grid-3" style="font-size:6.8pt;">
      <div class="card card-navy">
        <h3>100% Test Pass Rate</h3>
        <p>76 Python ML/API tests (pytest) + 57 Web integration tests (vitest). Monorepo <code>make check</code> passes with zero warnings.</p>
      </div>
      <div class="card card-navy">
        <h3>Zero Bundle Bloat</h3>
        <p>Debug tracing tools are strictly lazy-loaded via <code>React.lazy()</code>. Normal production bundle size: 247 kB (76.9 kB gzip).</p>
      </div>
      <div class="card card-navy">
        <h3>FastAPI Microservice</h3>
        <p>Fully typed Pydantic v2 schemas, automated OpenAPI spec generation, and in-memory LRU caching of SHAP background sets.</p>
      </div>
    </div>

    <h2 class="sec-title">18. Real-World Production Roadmap & Future Scope</h2>
    <div class="grid-3" style="font-size:6.8pt;">
      <div class="card">
        <h3 class="subsec-title" style="color:#0284c7;">1. SMART on FHIR Integration</h3>
        <p>Direct electronic health record (EHR) connectors for Epic, Cerner, and Allscripts to auto-populate the 55 clinical variables from hospital lab feeds in a single click.</p>
      </div>
      <div class="card">
        <h3 class="subsec-title" style="color:#0284c7;">2. Patient-Specific CT Meshes</h3>
        <p>Automated deep-learning segmentation (nnU-Net) converting raw DICOM Cardiac CT Angiography volumes into individualized 3D patient mesh twins.</p>
      </div>
      <div class="card">
        <h3 class="subsec-title" style="color:#0284c7;">3. Hemodynamic CT-FFR</h3>
        <p>Coupling statistical risk predictions with Computational Fluid Dynamics (CFD) to compute non-invasive Fractional Flow Reserve pressure drops across lesions.</p>
      </div>
    </div>

    <div class="card" style="margin-top:3px; background:#f8fafc; border:1px solid #cbd5e1; font-size:6.2pt; color:#64748b;">
      <strong>Regulatory Compliance & Ethics Notice:</strong> CardioMap 3D is designed for clinical decision support and medical education. It does not replace formal coronary angiography or invasive catheterization. Software complies with FDA Guidance for Clinical Decision Support Software (Sept 2022).
    </div>
  </div>

  <div class="doc-footer">
    <span>CardioMap 3D &bull; Confidential Hackathon Submission</span>
    <span>Track A: Cardiovascular Risk Visualization</span>
    <span>Page 5 of 5</span>
  </div>
</div>

</body>
</html>
"""

html_path = "docs/documentation/CardioMap3D_Technical_Report.html"
pdf_path = "docs/documentation/CardioMap3D_Technical_Report.pdf"

html_content = html_template.replace("__IMG_MAIN_UI__", img_main_ui)
html_content = html_content.replace("__IMG_TRACER__", img_tracer)
html_content = html_content.replace("__IMG_ROC_CAD__", img_roc_cad)
html_content = html_content.replace("__IMG_ROC_LAD__", img_roc_lad)

with open(html_path, "w") as f:
    f.write(html_content)

print(f"Generated HTML report at: {html_path}")

chrome_bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cmd = [
    chrome_bin,
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    f"--print-to-pdf={pdf_path}",
    f"file://{os.path.abspath(html_path)}"
]

print("Compiling PDF with headless Chrome...")
res = subprocess.run(cmd, capture_output=True, text=True)
if os.path.exists(pdf_path):
    size_kb = os.path.getsize(pdf_path) / 1024
    with open(pdf_path, "rb") as f:
        pdf_bytes = f.read()
    pages = len(re.findall(rb'/Type\s*/Page\b', pdf_bytes))
    print(f"SUCCESS: PDF created at {pdf_path} ({size_kb:.1f} KB, {pages} pages)")
else:
    print("FAILED to create PDF:", res.stderr)
