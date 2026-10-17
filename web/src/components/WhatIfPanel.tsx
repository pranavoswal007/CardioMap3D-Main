import { useState, useEffect, useRef, useCallback } from 'react';
import { Sliders, RotateCcw, AlertTriangle, ArrowUp, ArrowDown, Minus, Info } from 'lucide-react';
import whatIfFactors from '../config/whatif.json';
import { useAppStore } from '../store/useAppStore';
import { api } from '../api/client';
import { recordWhatIfLatency } from '../utils/whatIfLatency';
import { computeDerivedBmi, formatProbabilityDelta } from '../utils/whatIfMath';
import type { TargetCode } from '../api/types';

export interface WhatIfFactorConfig {
  key: string;
  label: string;
  type: 'slider' | 'toggle';
  min: number;
  max: number;
  step: number;
  unit: string | null;
  category: string;
  modifiable: boolean;
  badge?: string;
}

const factors = whatIfFactors as WhatIfFactorConfig[];

export const WHATIF_NOTICE =
  'Model sensitivity, not a treatment effect. Changing an input shows how the model\'s estimate responds; it does not predict the effect of treatment or lifestyle change.';

export function WhatIfPanel() {
  const patientInputs = useAppStore((s) => s.patientInputs);
  const setPatientInputs = useAppStore((s) => s.setPatientInputs);
  const baselineInputs = useAppStore((s) => s.baselineInputs);
  const baselinePrediction = useAppStore((s) => s.baselinePrediction);
  const prediction = useAppStore((s) => s.prediction);
  const setPrediction = useAppStore((s) => s.setPrediction);
  const selectedTarget = useAppStore((s) => s.selectedTarget);
  const setExplanation = useAppStore((s) => s.setExplanation);
  const setExplainLoading = useAppStore((s) => s.setExplainLoading);

  // Local what-if working inputs
  const [localInputs, setLocalInputs] = useState<Record<string, number | string>>(() => ({
    ...patientInputs,
  }));
  const [prevBaseline, setPrevBaseline] = useState(baselineInputs);

  if (baselineInputs !== prevBaseline) {
    setPrevBaseline(baselineInputs);
    setLocalInputs({ ...patientInputs });
  }

  const predictTimerRef = useRef<NodeJS.Timeout | null>(null);
  const predictAbortRef = useRef<AbortController | null>(null);
  const explainTimerRef = useRef<NodeJS.Timeout | null>(null);
  const explainAbortRef = useRef<AbortController | null>(null);

  // Cleanup timers and abort controllers on unmount
  useEffect(() => {
    return () => {
      if (predictTimerRef.current) clearTimeout(predictTimerRef.current);
      if (explainTimerRef.current) clearTimeout(explainTimerRef.current);
      if (predictAbortRef.current) predictAbortRef.current.abort();
      if (explainAbortRef.current) explainAbortRef.current.abort();
    };
  }, []);

  const triggerDebouncedPredict = useCallback(
    (newInputs: Record<string, number | string>, inputTimestamp?: number) => {
      const sliderMoveTime = inputTimestamp ?? performance.now();
      // 1. Cancel previous pending prediction timer
      if (predictTimerRef.current) {
        clearTimeout(predictTimerRef.current);
      }
      // Cancel previous pending explain timer while user is actively dragging
      if (explainTimerRef.current) {
        clearTimeout(explainTimerRef.current);
      }
      if (explainAbortRef.current) {
        explainAbortRef.current.abort();
        explainAbortRef.current = null;
      }

      // 2. Abort any active in-flight prediction (latest request wins)
      if (predictAbortRef.current) {
        predictAbortRef.current.abort();
        predictAbortRef.current = null;
      }

      // Build sanitized payload with numeric casting and derived BMI rule
      const payload: Record<string, number | string> = {};
      for (const [k, v] of Object.entries(newInputs)) {
        if (v !== '' && v !== null && v !== undefined) {
          if (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '') {
            payload[k] = Number(v);
          } else {
            payload[k] = v;
          }
        }
      }

      // 3. Set 150 ms debounce for /predict
      predictTimerRef.current = setTimeout(async () => {
        const controller = new AbortController();
        predictAbortRef.current = controller;

        try {
          const res = await api.predict(payload, controller.signal);
          if (!controller.signal.aborted) {
            const latency = performance.now() - sliderMoveTime;
            recordWhatIfLatency(latency);
            setPrediction(res);
            setPatientInputs(newInputs);
          }
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return;
          }
          console.error('[WhatIf] Prediction error:', err);
        }
      }, 150);

      // 4. Set 800 ms inactivity debounce for /explain (only after dragging stops)
      explainTimerRef.current = setTimeout(async () => {
        const explainCtrl = new AbortController();
        explainAbortRef.current = explainCtrl;
        setExplainLoading(selectedTarget, true);

        try {
          const expRes = await api.explain(payload, [selectedTarget], explainCtrl.signal);
          if (!explainCtrl.signal.aborted) {
            setExplanation(selectedTarget, expRes);
          }
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return;
          }
          console.error(`[WhatIf] Explain error for ${selectedTarget}:`, err);
        } finally {
          setExplainLoading(selectedTarget, false);
        }
      }, 800);
    },
    [selectedTarget, setExplanation, setExplainLoading, setPatientInputs, setPrediction]
  );

  const handleValueChange = useCallback(
    (key: string, value: number) => {
      const moveTimestamp = performance.now();
      setLocalInputs((prev) => {
        const updated = { ...prev, [key]: value };

        // Derived field rule: when Weight changes, recompute BMI from Weight and Length
        if (key === 'Weight') {
          const lengthCm = Number(updated['Length'] ?? 165);
          const newBmi = computeDerivedBmi(value, lengthCm);
          updated['BMI'] = newBmi;
        }

        triggerDebouncedPredict(updated, moveTimestamp);
        return updated;
      });
    },
    [triggerDebouncedPredict]
  );

  const handleReset = () => {
    if (predictTimerRef.current) clearTimeout(predictTimerRef.current);
    if (explainTimerRef.current) clearTimeout(explainTimerRef.current);
    if (predictAbortRef.current) predictAbortRef.current.abort();
    if (explainAbortRef.current) explainAbortRef.current.abort();

    const targetInputs = baselineInputs ? { ...baselineInputs } : {};
    setLocalInputs(targetInputs);
    setPatientInputs(targetInputs);

    if (baselinePrediction) {
      setPrediction(baselinePrediction);
    }
  };

  // Compute per-target deltas vs baseline in probability points
  const cadDelta = formatProbabilityDelta(
    prediction?.cad?.probability,
    baselinePrediction?.cad?.probability
  );
  const ladDelta = formatProbabilityDelta(
    prediction?.vessels?.lad?.probability,
    baselinePrediction?.vessels?.lad?.probability
  );
  const lcxDelta = formatProbabilityDelta(
    prediction?.vessels?.lcx?.probability,
    baselinePrediction?.vessels?.lcx?.probability
  );
  const rcaDelta = formatProbabilityDelta(
    prediction?.vessels?.rca?.probability,
    baselinePrediction?.vessels?.rca?.probability
  );

  const deltas: { code: TargetCode; label: string; currentP?: number; delta: typeof cadDelta }[] = [
    { code: 'cad', label: 'Overall CAD', currentP: prediction?.cad?.probability, delta: cadDelta },
    { code: 'lad', label: 'LAD Artery', currentP: prediction?.vessels?.lad?.probability, delta: ladDelta },
    { code: 'lcx', label: 'LCX Artery', currentP: prediction?.vessels?.lcx?.probability, delta: lcxDelta },
    { code: 'rca', label: 'RCA Artery', currentP: prediction?.vessels?.rca?.probability, delta: rcaDelta },
  ];

  return (
    <div
      data-testid="whatif-panel"
      className="bg-slate-900 border border-indigo-900/60 rounded-xl p-5 shadow-2xl space-y-4 text-slate-100"
    >
      {/* Header and Reset Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-indigo-400" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">What-If Sensitivity Exploration</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800">
                Live Simulation
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Adjust modifiable factors to observe instantaneous model probability shifts.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-medium transition-colors border border-slate-700 shadow-sm"
          title="Restore all factors to baseline patient inputs"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset to baseline</span>
        </button>
      </div>

      {/* Mandatory Clinical Sensitivity Notice (Always visible inside What-If mode) */}
      <div
        data-testid="whatif-notice"
        className="p-3 bg-amber-950/40 border border-amber-800/80 rounded-lg text-xs text-amber-200 leading-relaxed flex items-start gap-2.5"
      >
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <span>{WHATIF_NOTICE}</span>
      </div>

      {/* Per-target Delta vs Baseline in Probability Points */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {deltas.map(({ code, label, currentP, delta }) => (
          <div
            key={code}
            className="p-2.5 bg-slate-950/70 rounded-lg border border-slate-800 flex flex-col justify-between"
          >
            <div className="text-[11px] text-slate-400 flex items-center justify-between">
              <span className="font-medium truncate">{label}</span>
              <span className="text-white font-mono text-[11px]">
                {currentP !== undefined ? `${(currentP * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className={`flex items-center gap-1 mt-1 text-xs font-semibold font-mono ${delta.colorClass}`}>
              {delta.arrow === 'up' && <ArrowUp className="w-3.5 h-3.5" />}
              {delta.arrow === 'down' && <ArrowDown className="w-3.5 h-3.5" />}
              {delta.arrow === 'neutral' && <Minus className="w-3.5 h-3.5" />}
              <span>{delta.deltaText}</span>
              <span className="text-[10px] text-slate-500 font-normal ml-0.5">vs baseline</span>
            </div>
          </div>
        ))}
      </div>

      {/* Modifiable Sliders & Toggles */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-indigo-400" />
          Configured Modifiable Factors
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {factors.map((factor) => {
            const rawVal = localInputs[factor.key];
            const currentVal =
              rawVal !== undefined && rawVal !== null && !isNaN(Number(rawVal))
                ? Number(rawVal)
                : factor.min;

            if (factor.type === 'toggle') {
              const isChecked = Boolean(Number(currentVal) === 1);
              return (
                <div
                  key={factor.key}
                  className="p-3 bg-slate-950/50 rounded-lg border border-slate-800 flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-medium text-slate-200">{factor.label}</div>
                    <div className="text-[10px] text-slate-400">Current status: {isChecked ? 'Yes (1)' : 'No (0)'}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isChecked}
                    aria-label={factor.label}
                    onClick={() => handleValueChange(factor.key, isChecked ? 0 : 1)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                      isChecked ? 'bg-indigo-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        isChecked ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              );
            }

            return (
              <div
                key={factor.key}
                className="p-3 bg-slate-950/50 rounded-lg border border-slate-800 space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-slate-200">{factor.label}</span>
                    {factor.badge && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-amber-950 text-amber-300 border border-amber-800/80">
                        {factor.badge}
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-slate-100 font-semibold text-xs">
                    {currentVal.toFixed(factor.step < 1 ? 1 : 0)}{' '}
                    <span className="text-[10px] text-slate-400 font-normal">{factor.unit}</span>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 font-mono w-7 text-right">
                    {factor.min}
                  </span>
                  <input
                    type="range"
                    aria-label={factor.label}
                    min={factor.min}
                    max={factor.max}
                    step={factor.step}
                    value={currentVal}
                    onChange={(e) => handleValueChange(factor.key, parseFloat(e.target.value))}
                    className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-500 font-mono w-7">
                    {factor.max}
                  </span>
                </div>

                {factor.key === 'Weight' && (
                  <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800/60">
                    <span>Derived BMI (from Weight & Height):</span>
                    <span className="font-mono text-indigo-300 font-semibold">
                      {localInputs['BMI'] !== undefined
                        ? Number(localInputs['BMI']).toFixed(2)
                        : computeDerivedBmi(currentVal, Number(localInputs['Length'] ?? 165)).toFixed(2)}{' '}
                      kg/m²
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
