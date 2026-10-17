import React, { useEffect, useState, useMemo } from 'react';
import {
  Heart,
  Server,
  RefreshCw,
  Activity,
  ShieldCheck,
  Info,
  AlertCircle,
  Sliders,
} from 'lucide-react';
import type { VesselId, VesselData } from './types/viewer';
import { useAppStore } from './store/useAppStore';
import { api, ApiClientError } from './api/client';
import { PatientForm } from './components/PatientForm';
import { ResultCards } from './components/ResultCards';
import { DisclaimerBanner } from './components/DisclaimerBanner';

// Lazy-load the heavy components and 3D viewer for optimal bundle performance
const HeartViewer = React.lazy(() => import('./components/HeartViewer'));
const TerritoryMap = React.lazy(() =>
  import('./components/TerritoryMap').then((m) => ({ default: m.TerritoryMap }))
);
const WhatIfPanel = React.lazy(() =>
  import('./components/WhatIfPanel').then((m) => ({ default: m.WhatIfPanel }))
);
const ExplanationPanel = React.lazy(() =>
  import('./components/ExplanationPanel').then((m) => ({ default: m.ExplanationPanel }))
);
const ValidationTab = React.lazy(() =>
  import('./components/ValidationTab').then((m) => ({ default: m.ValidationTab }))
);
const AboutTab = React.lazy(() =>
  import('./components/AboutTab').then((m) => ({ default: m.AboutTab }))
);

function HeartViewerFallback() {
  return (
    <div className="w-full h-[520px] rounded-2xl bg-slate-900/80 border border-slate-800 flex flex-col items-center justify-center gap-3 text-slate-400">
      <Heart className="w-10 h-10 text-rose-500/40 animate-pulse" />
      <div className="text-xs font-medium text-slate-300">
        Initializing 3D Cardiac Anatomy Engine...
      </div>
      <div className="text-[11px] text-slate-500">
        Loading WebGL Shaders & Anatomical Splines
      </div>
    </div>
  );
}

function ComponentFallback({ label }: { label: string }) {
  return (
    <div className="p-8 text-center text-xs text-slate-400 bg-slate-900 border border-slate-800 rounded-xl">
      Loading {label}...
    </div>
  );
}

export function App() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setSchemaData = useAppStore((s) => s.setSchemaData);
  const setSamplePatients = useAppStore((s) => s.setSamplePatients);
  const prediction = useAppStore((s) => s.prediction);
  const patientInputs = useAppStore((s) => s.patientInputs);
  const selectedVessel = useAppStore((s) => s.selectedVessel);
  const setSelectedVessel = useAppStore((s) => s.setSelectedVessel);
  const animateHeartbeat = useAppStore((s) => s.animateHeartbeat);
  const whatIfActive = useAppStore((s) => s.whatIfActive);
  const setWhatIfActive = useAppStore((s) => s.setWhatIfActive);

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const rawPR =
    typeof patientInputs['PR'] === 'number'
      ? patientInputs['PR']
      : Number(patientInputs['PR'] ?? 70);
  const clampedBpm = Math.max(40, Math.min(180, isNaN(rawPR) ? 70 : rawPR));

  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'unreachable'>('checking');
  const [initError, setInitError] = useState<string | null>(null);

  const retryConnection = React.useCallback(async () => {
    setApiStatus('checking');
    setInitError(null);
    try {
      const [health, schema, samples] = await Promise.all([
        api.getHealth(),
        api.getSchema(),
        api.getSamplePatients(),
      ]);

      setApiStatus(health.status === 'ok' ? 'online' : 'unreachable');
      setSchemaData(schema);
      setSamplePatients(samples);
    } catch (err: unknown) {
      setApiStatus('unreachable');
      const msg =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unable to connect to CardioMap 3D API';
      setInitError(msg);
    }
  }, [setSchemaData, setSamplePatients]);

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const [health, schema, samples] = await Promise.all([
          api.getHealth(),
          api.getSchema(),
          api.getSamplePatients(),
        ]);
        if (!ignore) {
          setApiStatus(health.status === 'ok' ? 'online' : 'unreachable');
          setSchemaData(schema);
          setSamplePatients(samples);
        }
      } catch (err: unknown) {
        if (!ignore) {
          setApiStatus('unreachable');
          const msg =
            err instanceof ApiClientError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Unable to connect to CardioMap 3D API';
          setInitError(msg);
        }
      }
    }
    void init();
    return () => {
      ignore = true;
    };
  }, [setSchemaData, setSamplePatients]);

  // Compute vessels prop for HeartViewer: null until predicted (viewer stays neutral gray)
  const vesselsProp = useMemo<Record<VesselId, VesselData>>(() => {
    if (!prediction) {
      return {
        lad: null,
        lcx: null,
        rca: null,
      };
    }

    return {
      lad: prediction.vessels.lad
        ? {
            probability: prediction.vessels.lad.probability,
            threshold: prediction.vessels.lad.threshold,
            highMargin: 0.15,
          }
        : null,
      lcx: prediction.vessels.lcx
        ? {
            probability: prediction.vessels.lcx.probability,
            threshold: prediction.vessels.lcx.threshold,
            highMargin: 0.15,
          }
        : null,
      rca: prediction.vessels.rca
        ? {
            probability: prediction.vessels.rca.probability,
            threshold: prediction.vessels.rca.threshold,
            highMargin: 0.15,
          }
        : null,
    };
  }, [prediction]);

  return (
    <div className="flex flex-col min-h-screen bg-[#070b13] text-slate-100 font-sans pb-12">
      {/* 1. HEADER NAVIGATION */}
      <header className="border-b border-slate-800 bg-[#0a101d]/90 backdrop-blur-lg px-6 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-sky-500 to-rose-500 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Heart className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white">CardioMap 3D</h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                Decision Support
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Interactive 3D Coronary Artery Risk Mapping & Multi-Vessel Stenosis Predictor
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('patient')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
              activeTab === 'patient'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Patient Assessment
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('validation')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
              activeTab === 'validation'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Model Validation
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('about')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
              activeTab === 'about'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            About & Safety
          </button>
        </div>

        {/* API Health Status Indicator */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-900 border border-slate-800">
            <Server className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400">API:</span>
            {apiStatus === 'online' ? (
              <span className="flex items-center gap-1.5 font-medium text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400" /> Online
              </span>
            ) : apiStatus === 'unreachable' ? (
              <button
                type="button"
                onClick={retryConnection}
                className="flex items-center gap-1.5 font-medium text-rose-400 hover:underline"
                title="Click to retry connecting to API"
              >
                <span className="w-2 h-2 rounded-full bg-rose-400" /> Unreachable (Retry)
              </button>
            ) : (
              <span className="flex items-center gap-1.5 font-medium text-amber-400">
                <RefreshCw className="w-3 h-3 animate-spin" /> Verifying...
              </span>
            )}
          </div>
        </div>
      </header>

      {/* API Unreachable Error Banner */}
      {apiStatus === 'unreachable' && (
        <div className="bg-rose-950/80 border-b border-rose-800 px-6 py-2.5 text-xs text-rose-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              <strong>API Unreachable: </strong>
              {initError || 'Unable to connect to backend server on port 8000. Ensure the FastAPI dev server is running.'}
              {typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname) && (
                <span className="block mt-0.5 text-rose-300/80">
                  Tip: Set the <code className="bg-rose-900/60 px-1 py-0.5 rounded text-[11px]">VITE_API_URL</code> environment variable in your Vercel project settings to connect your deployed backend.
                </span>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={retryConnection}
            className="px-3 py-1 bg-rose-900 hover:bg-rose-800 rounded font-medium text-white transition text-xs shrink-0"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* 2. MAIN WORKSPACE BASED ON TAB */}
      <main className="flex-1 p-6 max-w-[1800px] w-full mx-auto">
        {activeTab === 'patient' && (
          <div
            data-testid="patient-tab-layout"
            className="flex flex-col lg:flex-row gap-6 items-start"
          >
            {/* Left Column: 3D Visualization Viewer + Attributions Panel (~58% on Desktop) */}
            <section
              data-testid="left-column"
              className="contents lg:flex lg:flex-col lg:w-[58%] gap-6"
            >
              {/* 1. Heart Viewer Card */}
              <div
                id="heart-viewer-section"
                data-testid="viewer-wrapper"
                className="order-1 lg:order-1 w-full"
              >
                <React.Suspense fallback={<HeartViewerFallback />}>
                  <HeartViewer
                    vessels={vesselsProp}
                    selectedVessel={selectedVessel}
                    onSelectVessel={setSelectedVessel}
                    bpm={animateHeartbeat && !prefersReducedMotion ? clampedBpm : undefined}
                  />
                </React.Suspense>
              </div>

              {/* 2. Estimated Local Feature Attributions Panel (directly beneath viewer card) */}
              <div
                id="explanation-panel"
                data-testid="attributions-wrapper"
                className="order-5 lg:order-2 w-full min-h-[320px] [&>div]:min-h-[320px]"
              >
                <React.Suspense fallback={<ComponentFallback label="feature attributions" />}>
                  <ExplanationPanel />
                </React.Suspense>
              </div>
            </section>

            {/* Right Column: Results, Territory Map, What-If, Patient Form (~42% on Desktop) */}
            <section
              data-testid="right-column"
              className="contents lg:flex lg:flex-col lg:w-[42%] gap-4"
            >
              {/* 1. Results (CAD card, 3 vessel cards) */}
              <div
                data-testid="results-wrapper"
                className="order-2 lg:order-1 w-full"
              >
                <ResultCards />
              </div>

              {/* 2. Territory Map (AHA 17-segment, collapsible, centered, max-w-[320px]) - Placed directly under Results to remain in same frame as 3D heart */}
              <div
                data-testid="territory-map-wrapper"
                className="order-3 lg:order-2 w-full"
              >
                <React.Suspense fallback={<ComponentFallback label="territory map" />}>
                  <TerritoryMap
                    vessels={vesselsProp}
                    hasPrediction={Boolean(prediction)}
                  />
                </React.Suspense>
              </div>

              {/* 3. What-If Mode Toggle Banner & Panel */}
              <div
                data-testid="what-if-wrapper"
                className="order-4 lg:order-3 w-full space-y-3"
              >
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-indigo-400" />
                    <div>
                      <span className="text-xs font-semibold text-white">What-If Sensitivity Simulation</span>
                      <p className="text-[10px] text-slate-400">
                        {prediction
                          ? 'Test hypothetical adjustments to modifiable factors'
                          : 'Run baseline analysis first to enable What-If simulation'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={whatIfActive}
                    disabled={!prediction && !whatIfActive}
                    onClick={() => setWhatIfActive(!whatIfActive)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                      whatIfActive ? 'bg-indigo-600' : 'bg-slate-800'
                    } ${!prediction && !whatIfActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={!prediction ? 'Run baseline prediction first' : 'Toggle What-If mode'}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        whatIfActive ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {whatIfActive && (
                  <React.Suspense fallback={<ComponentFallback label="what-if exploration" />}>
                    <WhatIfPanel />
                  </React.Suspense>
                )}
              </div>

              {/* 4. Patient Form (collapses into one-line summary after prediction) */}
              <div
                data-testid="patient-form-wrapper"
                className="order-6 lg:order-4 w-full"
              >
                <PatientForm />
              </div>
            </section>
          </div>
        )}

        {activeTab === 'validation' && (
          <React.Suspense fallback={<ComponentFallback label="validation report" />}>
            <ValidationTab />
          </React.Suspense>
        )}

        {activeTab === 'about' && (
          <React.Suspense fallback={<ComponentFallback label="about documentation" />}>
            <AboutTab />
          </React.Suspense>
        )}
      </main>

      {/* 3. MANDATORY CANONICAL DISCLAIMER BANNER (STICKY, NOT DISMISSIBLE) */}
      <DisclaimerBanner />
    </div>
  );
}

export default App;
