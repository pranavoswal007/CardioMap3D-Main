import React from 'react';
import type { VesselId, VesselData, VesselConfig } from '../types/viewer';
import { evaluateVesselColor } from '../utils/vesselColors';

interface VesselListProps {
  configs: VesselConfig[];
  vessels: Record<VesselId, VesselData>;
  selectedVessel: VesselId | null;
  onSelectVessel: (id: VesselId | null) => void;
}

export function VesselList({
  configs,
  vessels,
  selectedVessel,
  onSelectVessel,
}: VesselListProps) {
  const handleKeyDown = (e: React.KeyboardEvent, id: VesselId) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectVessel(selectedVessel === id ? null : id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onSelectVessel(null);
    }
  };

  return (
    <div
      role="region"
      aria-label="Coronary Artery Selection List"
      className="flex flex-col gap-2 w-full"
    >
      <div className="flex items-center justify-between text-xs text-slate-400 font-medium px-1">
        <span>Coronary Arteries (Keyboard Accessible)</span>
        {selectedVessel && (
          <button
            onClick={() => onSelectVessel(null)}
            className="text-[11px] text-sky-400 hover:text-sky-300 underline"
            aria-label="Clear vessel selection"
          >
            Clear selection
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {configs.map((config) => {
          const isSelected = selectedVessel === config.id;
          const data = vessels[config.id];
          const evaluation = evaluateVesselColor(data);
          const hasData = data && data.probability !== null && data.probability !== undefined;
          const probStr = hasData ? `${(data.probability * 100).toFixed(1)}%` : 'No prediction';

          return (
            <button
              key={config.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={`${config.displayName}: ${probStr}, ${evaluation.label}`}
              onClick={() => onSelectVessel(isSelected ? null : config.id)}
              onKeyDown={(e) => handleKeyDown(e, config.id)}
              className={`flex flex-col text-left p-3 rounded-xl border transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                isSelected
                  ? 'bg-slate-800/90 border-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.2)]'
                  : 'bg-slate-900/80 border-slate-800 hover:bg-slate-800/60 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <span className="flex items-center gap-2">
                  {/* Dynamic Color Indicator */}
                  <span
                    className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                    style={{
                      backgroundColor: evaluation.hex,
                      boxShadow: isSelected ? `0 0 8px ${evaluation.hex}` : undefined,
                    }}
                  />
                  <span className="font-bold text-sm text-slate-100">{config.shortName}</span>
                </span>
                <span className="font-mono text-xs font-semibold" style={{ color: evaluation.hex }}>
                  {probStr}
                </span>
              </div>

              <span className="text-[11px] text-slate-400 truncate mb-1">
                {config.displayName}
              </span>

              <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-slate-800/80 mt-auto">
                <span className="text-slate-400">{evaluation.label}</span>
                <span className="text-slate-500 font-mono">
                  cutoff {(evaluation.t * 100).toFixed(0)}%
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
