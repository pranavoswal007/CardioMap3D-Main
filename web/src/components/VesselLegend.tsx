import type { VesselId, VesselData } from '../types/viewer';
import { DEFAULT_HIGH_MARGIN } from '../utils/vesselColors';

interface VesselLegendProps {
  vessels: Record<VesselId, VesselData>;
}

export function VesselLegend({ vessels }: VesselLegendProps) {
  // Format threshold display
  const getCutoffs = (id: VesselId, fallbackT: number) => {
    const data = vessels[id];
    const t = data ? data.threshold : fallbackT;
    const margin = data?.highMargin ?? DEFAULT_HIGH_MARGIN;
    const tHigh = t + margin;
    return {
      t: (t * 100).toFixed(1) + '%',
      tHigh: (tHigh * 100).toFixed(1) + '%',
      rawT: t,
    };
  };

  const ladCut = getCutoffs('lad', 0.501);
  const lcxCut = getCutoffs('lcx', 0.397);
  const rcaCut = getCutoffs('rca', 0.335);

  return (
    <div className="bg-slate-900/90 backdrop-blur-md rounded-xl border border-slate-800 p-3.5 text-xs shadow-xl space-y-3">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <span className="font-semibold text-slate-200 tracking-wide">
          Anatomical Risk Color Legend
        </span>
        <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-sky-950/60 text-sky-400 border border-sky-800/60">
          Continuous Mapping
        </span>
      </div>

      {/* Color bands description */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="w-12 h-3 rounded bg-gradient-to-r from-[#10b981] to-[#eab308] border border-slate-700/60 shrink-0" />
          <span className="text-slate-300 font-medium">p &lt; t:</span>
          <span className="text-slate-400">Green &rarr; Yellow (Below screening cutoff)</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-12 h-3 rounded bg-gradient-to-r from-[#eab308] to-[#f97316] border border-slate-700/60 shrink-0" />
          <span className="text-slate-300 font-medium">t &le; p &lt; t<span className="text-[10px]">High</span>:</span>
          <span className="text-amber-300 font-medium">Yellow &rarr; Orange (Above screening cutoff)</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-12 h-3 rounded bg-gradient-to-r from-[#f97316] to-[#ef4444] border border-slate-700/60 shrink-0" />
          <span className="text-slate-300 font-medium">p &ge; t<span className="text-[10px]">High</span>:</span>
          <span className="text-rose-400 font-medium">Orange &rarr; Red (Elevated &ge; cutoff + 0.15)</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-12 h-3 rounded bg-[#64748b] border border-slate-700/60 shrink-0" />
          <span className="text-slate-300 font-medium">No Data:</span>
          <span className="text-slate-400">Neutral Gray (No prediction yet)</span>
        </div>
      </div>

      {/* Target Operating Cutoffs */}
      <div className="pt-2 border-t border-slate-800/80">
        <div className="text-[11px] font-semibold text-slate-300 mb-1.5">
          Vessel Screening Cutoffs (Operating Thresholds):
        </div>
        <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px]">
          <div className="bg-slate-950/80 px-2 py-1.5 rounded border border-slate-800 flex flex-col">
            <span className="font-bold text-slate-200">LAD</span>
            <span className="text-sky-400">t = {ladCut.t}</span>
            <span className="text-slate-500 text-[10px]">high &ge; {ladCut.tHigh}</span>
          </div>

          <div className="bg-slate-950/80 px-2 py-1.5 rounded border border-slate-800 flex flex-col">
            <span className="font-bold text-slate-200">LCX</span>
            <span className="text-sky-400">t = {lcxCut.t}</span>
            <span className="text-slate-500 text-[10px]">high &ge; {lcxCut.tHigh}</span>
          </div>

          <div className="bg-slate-950/80 px-2 py-1.5 rounded border border-slate-800 flex flex-col">
            <span className="font-bold text-slate-200">RCA</span>
            <span className="text-sky-400">t = {rcaCut.t}</span>
            <span className="text-slate-500 text-[10px]">high &ge; {rcaCut.tHigh}</span>
          </div>
        </div>
      </div>

      {/* Visible mandatory disclosure */}
      <div className="pt-1 text-[11px] text-amber-400/90 flex items-center gap-1.5 bg-amber-500/10 px-2.5 py-1.5 rounded border border-amber-500/20">
        <span className="font-semibold underline">Notice:</span>
        <span>Illustrative anatomy, not patient imaging.</span>
      </div>
    </div>
  );
}
