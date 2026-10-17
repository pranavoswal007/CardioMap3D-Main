import { AlertTriangle, HeartPulse, Activity, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { getDisplayRiskLabel, getTierBandLabel } from '../utils/riskLabels';
import { formatProbabilityDelta } from '../utils/whatIfMath';
import type { TargetPrediction } from '../api/types';

interface ProbabilityBarProps {
  probability: number;
  threshold: number;
  highThreshold: number;
}

export function ProbabilityBar({ probability, threshold, highThreshold }: ProbabilityBarProps) {
  const probPct = Math.min(Math.max(probability * 100, 1), 99).toFixed(1);
  const threshPct = Math.min(Math.max(threshold * 100, 0), 100).toFixed(1);
  const highThreshPct = Math.min(Math.max(highThreshold * 100, 0), 100).toFixed(1);

  const isAboveHigh = probability >= highThreshold;
  const isAboveThresh = probability >= threshold;

  const barColor = isAboveHigh
    ? 'bg-rose-500'
    : isAboveThresh
      ? 'bg-amber-500'
      : 'bg-emerald-500';

  return (
    <div className="space-y-1 pt-0.5">
      <div className="relative h-2 w-full bg-slate-800 rounded-full overflow-visible border border-slate-700">
        {/* Progress fill */}
        <div
          data-testid="probability-fill"
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${probPct}%` }}
        />

        {/* Operating Threshold Tick */}
        <div
          data-testid="threshold-tick"
          className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-yellow-400 z-10 shadow-sm"
          style={{ left: `${threshPct}%` }}
          title={`Screening Cutoff: ${(threshold * 100).toFixed(1)}%`}
        />

        {/* High Threshold Tick */}
        <div
          data-testid="high-threshold-tick"
          className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-rose-400 z-10 shadow-sm"
          style={{ left: `${highThreshPct}%` }}
          title={`High Cutoff: ${(highThreshold * 100).toFixed(1)}%`}
        />
      </div>

      <div className="flex justify-between text-[9px] text-slate-400">
        <span>0%</span>
        <span className="text-yellow-400 font-medium">Cutoff: {(threshold * 100).toFixed(1)}%</span>
        <span className="text-rose-400 font-medium">High: {(highThreshold * 100).toFixed(1)}%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

interface TargetCardProps {
  id: 'cad' | 'lad' | 'lcx' | 'rca';
  title: string;
  subtitle: string;
  prediction: TargetPrediction;
  isSelected: boolean;
  onSelect: () => void;
  isVessel?: boolean;
}

export function TargetCard({
  id,
  title,
  subtitle,
  prediction,
  isSelected,
  onSelect,
  isVessel = false,
}: TargetCardProps) {
  const displayLabel = getDisplayRiskLabel(prediction.risk_level);
  const tierBand = getTierBandLabel(prediction.risk_level);
  const isElevated = prediction.probability >= prediction.threshold;
  const whatIfActive = useAppStore((s) => s.whatIfActive);
  const baselinePrediction = useAppStore((s) => s.baselinePrediction);

  const baselineP =
    id === 'cad'
      ? baselinePrediction?.cad?.probability
      : baselinePrediction?.vessels?.[id]?.probability;
  const delta = formatProbabilityDelta(prediction.probability, baselineP);

  return (
    <div
      onClick={onSelect}
      className={`p-2.5 sm:p-3 rounded-xl border cursor-pointer transition-all ${
        isSelected
          ? 'bg-slate-850 border-indigo-500 ring-2 ring-indigo-500/30 shadow-md shadow-indigo-950/40'
          : 'bg-slate-900 border-slate-800 hover:border-slate-700 hover:bg-slate-850/50'
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs sm:text-sm font-semibold text-white truncate">{title}</h3>
            {isSelected && (
              <span className="px-1.5 py-0.2 bg-indigo-500/20 text-indigo-300 text-[9px] rounded border border-indigo-500/40 shrink-0">
                Selected
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400 truncate mt-0.5">{subtitle}</p>
        </div>

        <div className="text-right shrink-0">
          <div className="text-base sm:text-lg font-bold text-white tracking-tight leading-none">
            {(prediction.probability * 100).toFixed(1)}%
          </div>
          {whatIfActive && baselineP !== undefined && (
            <div
              className={`text-[10px] font-semibold font-mono flex items-center justify-end gap-0.5 mt-0.5 ${delta.colorClass}`}
              title="Probability delta vs baseline"
            >
              {delta.arrow === 'up' && <ArrowUp className="w-2.5 h-2.5" />}
              {delta.arrow === 'down' && <ArrowDown className="w-2.5 h-2.5" />}
              {delta.arrow === 'neutral' && <Minus className="w-2.5 h-2.5" />}
              <span>{delta.deltaText}</span>
            </div>
          )}
          <div className="flex flex-col items-end gap-0.5 mt-0.5">
            <span
              className={`inline-block px-1.5 py-0.2 rounded text-[9px] font-medium leading-tight ${
                isElevated
                  ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60'
                  : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
              }`}
            >
              {displayLabel}
            </span>
            {tierBand && (
              <span className="text-[8px] text-slate-400 font-mono leading-none">
                {tierBand}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2">
        <ProbabilityBar
          probability={prediction.probability}
          threshold={prediction.threshold}
          highThreshold={prediction.high_threshold}
        />
      </div>

      <div className="mt-2 pt-1.5 border-t border-slate-800/80 grid grid-cols-2 gap-1.5 text-[10px]">
        <div>
          <span className="text-slate-400">Relative Risk: </span>
          <span className="font-semibold text-slate-200">{prediction.relative_risk.toFixed(2)}x</span>
        </div>
        <div>
          <span className="text-slate-400">Prevalence: </span>
          <span className="font-semibold text-slate-200">
            {(prediction.cohort_prevalence * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Special context note for LCX and RCA per contract */}
      {(id === 'lcx' || id === 'rca') && isVessel && (
        <div className="mt-1.5 p-1.5 bg-slate-950/60 rounded text-[9px] text-slate-400 border border-slate-800/80 leading-snug">
          <span className="font-semibold text-slate-300">Cohort context: </span>
          A positive label indicates passing screening cutoff, not necessarily above-average cohort risk; see probability and relative risk.
        </div>
      )}
    </div>
  );
}

export function ResultCards() {
  const prediction = useAppStore((s) => s.prediction);
  const selectedTarget = useAppStore((s) => s.selectedTarget);
  const setSelectedTarget = useAppStore((s) => s.setSelectedTarget);

  if (!prediction) {
    return (
      <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-xl text-slate-400">
        <HeartPulse className="w-10 h-10 text-slate-600 mx-auto mb-2.5" />
        <p className="text-sm">Submit patient features to view calibrated risk probabilities and vessel mapping.</p>
      </div>
    );
  }

  const { cad, vessels, coherence, warnings } = prediction;
  const coh = coherence as {
    is_incoherent?: boolean;
    raw_cad_probability?: number;
    adjusted_cad_probability?: number;
    max_vessel_probability?: number;
    note?: string;
  } | undefined;

  const isIncoherent =
    coh &&
    (Boolean(coh.is_incoherent) ||
      (typeof coh.raw_cad_probability === 'number' &&
        typeof coh.max_vessel_probability === 'number' &&
        coh.raw_cad_probability < coh.max_vessel_probability));

  // Never display API text claiming an "adjustment applied" unless a displayed probability was actually adjusted
  const wasAdjusted =
    coh &&
    typeof coh.raw_cad_probability === 'number' &&
    Math.abs(cad.probability - coh.raw_cad_probability) > 1e-5;

  return (
    <div className="space-y-2.5">
      {/* Coherence & Consistency Banner */}
      {isIncoherent && (
        <div className="p-2.5 bg-amber-950/40 border border-amber-800/80 rounded-lg text-amber-200 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-amber-300">
              Model consistency notice: at least one vessel probability is higher than the overall CAD probability. These outputs come from separate models, so treat this as an uncertainty flag, not a diagnosis.
            </div>
            {wasAdjusted && coh?.note && (
              <p className="text-slate-300 leading-relaxed text-[11px]">{coh.note}</p>
            )}
          </div>
        </div>
      )}

      {/* API Clinical Warnings */}
      {warnings && warnings.length > 0 && (
        <div className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg text-xs space-y-1">
          <div className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-indigo-400" />
            Model Input Verification Notices:
          </div>
          <ul className="list-disc list-inside text-slate-400 space-y-0.5">
            {warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Main CAD and 3-Vessel Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <TargetCard
          id="cad"
          title="Overall CAD Risk"
          subtitle="Calibrated probability of multi-vessel or obstructive CAD"
          prediction={cad}
          isSelected={selectedTarget === 'cad'}
          onSelect={() => setSelectedTarget('cad')}
        />

        {vessels.lad && (
          <TargetCard
            id="lad"
            title="LAD Artery"
            subtitle="Left Anterior Descending branch stenosis"
            prediction={vessels.lad}
            isSelected={selectedTarget === 'lad'}
            onSelect={() => setSelectedTarget('lad')}
            isVessel
          />
        )}

        {vessels.lcx && (
          <TargetCard
            id="lcx"
            title="LCX Artery"
            subtitle="Left Circumflex branch stenosis"
            prediction={vessels.lcx}
            isSelected={selectedTarget === 'lcx'}
            onSelect={() => setSelectedTarget('lcx')}
            isVessel
          />
        )}

        {vessels.rca && (
          <TargetCard
            id="rca"
            title="RCA Artery"
            subtitle="Right Coronary Artery stenosis"
            prediction={vessels.rca}
            isSelected={selectedTarget === 'rca'}
            onSelect={() => setSelectedTarget('rca')}
            isVessel
          />
        )}
      </div>
    </div>
  );
}
