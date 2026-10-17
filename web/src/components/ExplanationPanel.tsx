import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { Info, Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import type { TargetCode, FeatureExplanation, PhysiologyItem } from '../api/types';

const TARGET_DISPLAY_NAMES: Record<TargetCode, string> = {
  cad: 'Overall CAD',
  lad: 'LAD Artery',
  lcx: 'LCX Artery',
  rca: 'RCA Artery',
};

export function ExplanationPanel() {
  const selectedTarget = useAppStore((s) => s.selectedTarget);
  const explanations = useAppStore((s) => s.explanations);
  const explainLoading = useAppStore((s) => s.explainLoading);
  const explainError = useAppStore((s) => s.explainError);

  const explainData = explanations[selectedTarget];
  const isLoading = explainLoading[selectedTarget];
  const errorMsg = explainError[selectedTarget];

  // Also check cad explanation for physiology table
  const cadExplanation = explanations.cad;
  const physiologyItems: PhysiologyItem[] | null = cadExplanation?.physiology ?? null;

  const targetExplanation = useMemo(() => {
    if (!explainData?.targets) return null;
    return explainData.targets[selectedTarget] || null;
  }, [explainData, selectedTarget]);

  const top8Contributions = useMemo(() => {
    if (!targetExplanation?.contributions) return [];
    return targetExplanation.contributions.slice(0, 8);
  }, [targetExplanation]);

  const chartData = useMemo(() => {
    return top8Contributions.map((item: FeatureExplanation) => ({
      name: item.display_label || item.feature,
      shap_value: item.shap_value,
      pct: item.relative_contribution_pct,
      direction: item.direction,
      stability: item.stability_label,
      patientValue: item.patient_value,
    }));
  }, [top8Contributions]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl text-slate-100 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              Estimated Local Feature Attributions
            </h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800">
              estimated
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Target: <span className="font-semibold text-white">{TARGET_DISPLAY_NAMES[selectedTarget]}</span>.
            Estimated attributions describe the model, not causes.
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-indigo-400 bg-indigo-950/60 px-3 py-1.5 rounded-lg border border-indigo-800/60">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Computing KernelExplainer SHAP values...</span>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-950/50 border border-red-800 text-red-200 rounded-lg text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>Explanation Error: {errorMsg} (prediction remains valid)</span>
        </div>
      )}

      {!explainData && !isLoading && !errorMsg && (
        <div className="p-6 text-center text-xs text-slate-400 bg-slate-950/40 rounded-lg border border-slate-800">
          Run patient analysis to generate SHAP attributions for {TARGET_DISPLAY_NAMES[selectedTarget]}.
        </div>
      )}

      {targetExplanation && chartData.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>
              Base expected score: <strong className="text-white">{targetExplanation.base_value.toFixed(4)}</strong> ({targetExplanation.raw_unit})
            </span>
            <span>Top 8 influential factors</span>
          </div>

          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 120, bottom: 5 }}
              >
                <XAxis
                  type="number"
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  tickFormatter={(val) => `${val > 0 ? '+' : ''}${val.toFixed(2)}`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: '#e2e8f0', fontSize: 11 }}
                  width={110}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-950 border border-slate-700 p-2.5 rounded shadow-lg text-xs space-y-1">
                          <div className="font-semibold text-white">{data.name}</div>
                          <div className="text-slate-300">
                            Patient Value: <span className="font-mono">{String(data.patientValue)}</span>
                          </div>
                          <div className="text-slate-300">
                            SHAP (probability points):{' '}
                            <span className={data.shap_value > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                              {data.shap_value > 0 ? '+' : ''}
                              {data.shap_value.toFixed(4)}
                            </span>
                          </div>
                          <div className="text-slate-300">
                            Relative Contribution: {data.pct.toFixed(1)}%
                          </div>
                          <div className="text-slate-400">
                            Stability persistence: <span className="uppercase text-indigo-300">{data.stability}</span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine x={0} stroke="#475569" strokeDasharray="3 3" />
                <Bar dataKey="shap_value" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.shap_value >= 0 ? '#f43f5e' : '#10b981'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Feature Badges list with measurement values displayed next to SHAP contribution */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 pt-2">
            {chartData.map((item) => (
              <div
                key={item.name}
                className="p-2.5 bg-slate-950/70 rounded-lg border border-slate-800 text-[11px] flex flex-col justify-between gap-1.5"
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="font-medium text-slate-200 truncate" title={item.name}>
                    {item.name}
                  </span>
                  <span
                    className="text-[10px] text-slate-300 font-mono shrink-0 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800"
                    title={`Patient measurement value: ${item.patientValue}`}
                  >
                    val: {item.patientValue !== undefined && item.patientValue !== null && item.patientValue !== '' ? String(item.patientValue) : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] pt-1 border-t border-slate-800/60">
                  <span
                    className={
                      item.shap_value > 0
                        ? 'text-rose-400 font-semibold font-mono'
                        : 'text-emerald-400 font-semibold font-mono'
                    }
                  >
                    {item.shap_value > 0 ? '+' : ''}{item.shap_value.toFixed(3)} pts
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded uppercase font-semibold text-[9px] ${
                      item.stability === 'stable'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                        : item.stability === 'moderate'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {item.stability}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Verbatim Explainer Metadata and Notes from API */}
      {explainData?.explainer && (
        <div className="space-y-3 pt-3 border-t border-slate-800 text-xs text-slate-300">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] bg-slate-950/50 p-2.5 rounded border border-slate-800">
            <div>
              <span className="text-slate-400">Method: </span>
              <span className="font-semibold text-slate-200">{explainData.explainer.method}</span>
            </div>
            <div>
              <span className="text-slate-400">Background: </span>
              <span className="font-semibold text-slate-200">{explainData.explainer.background_size} patients</span>
            </div>
            <div>
              <span className="text-slate-400">Evaluations: </span>
              <span className="font-semibold text-slate-200">{explainData.explainer.nsamples} samples</span>
            </div>
            <div>
              <span className="text-slate-400">Unit: </span>
              <span className="font-semibold text-slate-200">{explainData.explainer.unit}</span>
            </div>
          </div>

          <div className="space-y-2 leading-relaxed">
            <p className="text-slate-400">
              <strong className="text-slate-300">Model Interpretation Note: </strong>
              {explainData.interpretation_note}
            </p>
            <p className="text-slate-400">
              <strong className="text-slate-300">Explainer Method Note: </strong>
              {explainData.explainer.note}
            </p>
            <p className="text-slate-400">
              <strong className="text-slate-300">Stability Provenance: </strong>
              {explainData.explainer.stability_note}
            </p>
          </div>
        </div>
      )}

      {/* Physiology Table: renders ONLY when cad response contains non-null physiology */}
      {physiologyItems && physiologyItems.length > 0 && (
        <div className="pt-4 border-t border-slate-800 space-y-2.5">
          <h3 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <Info className="w-4 h-4 text-indigo-400" />
            Physiological Category Breakdown (CAD Explainer)
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-[11px] text-left text-slate-300">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3 font-semibold">Feature</th>
                  <th className="py-2 px-3 font-semibold">Category</th>
                  <th className="py-2 px-3 font-semibold">Patient Value</th>
                  <th className="py-2 px-3 font-semibold">Relative Contribution</th>
                  <th className="py-2 px-3 font-semibold">Direction</th>
                  <th className="py-2 px-3 font-semibold">Stability</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850">
                {physiologyItems.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-850/50">
                    <td className="py-2 px-3 font-medium text-white">{item.display_label || item.feature}</td>
                    <td className="py-2 px-3 capitalize text-slate-400">{item.category}</td>
                    <td className="py-2 px-3 font-mono">{String(item.patient_value)}</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">
                      {item.relative_contribution_pct.toFixed(1)}%
                    </td>
                    <td className="py-2 px-3">
                      <span className={item.direction === 'increases_risk' ? 'text-rose-400' : 'text-emerald-400'}>
                        {item.direction.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <span className="uppercase text-[10px] text-indigo-300 font-semibold">{item.stability_label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
