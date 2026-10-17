import { useState, useId } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import territoriesData from '../anatomy/territories.json';
import { useAppStore } from '../store/useAppStore';
import { evaluateVesselColor } from '../utils/vesselColors';
import type { VesselId, VesselData } from '../types/viewer';

export interface TerritorySegment {
  id: number;
  name: string;
  vessel: 'lad' | 'lcx' | 'rca';
  ring: 'basal' | 'mid' | 'apical' | 'apex';
  startAngle: number;
  endAngle: number;
}

const territories = territoriesData as TerritorySegment[];

const RING_RADII: Record<string, { rInner: number; rOuter: number }> = {
  apex: { rInner: 0, rOuter: 26 },
  apical: { rInner: 28, rOuter: 65 },
  mid: { rInner: 67, rOuter: 104 },
  basal: { rInner: 106, rOuter: 144 },
};

const VESSEL_FULL_NAMES: Record<string, string> = {
  lad: 'LAD (Left Anterior Descending)',
  lcx: 'LCX (Left Circumflex)',
  rca: 'RCA (Right Coronary Artery)',
};

export const TERRITORY_CAPTION =
  'Typical coronary territories (AHA 17-segment model). Individual anatomy varies. This map shows each vessel\'s predicted probability on its typical territory; it is not a lesion map and is not derived from RWMA.';

function degToRad(deg: number): number {
  return ((deg - 90) * Math.PI) / 180;
}

function makeSectorPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startAngle: number,
  endAngle: number
): string {
  const a1 = degToRad(startAngle);
  const a2 = degToRad(endAngle);

  const x1 = cx + rOuter * Math.cos(a1);
  const y1 = cy + rOuter * Math.sin(a1);
  const x2 = cx + rOuter * Math.cos(a2);
  const y2 = cy + rOuter * Math.sin(a2);

  const x3 = cx + rInner * Math.cos(a2);
  const y3 = cy + rInner * Math.sin(a2);
  const x4 = cx + rInner * Math.cos(a1);
  const y4 = cy + rInner * Math.sin(a1);

  const angleDiff = (endAngle - startAngle + 360) % 360;
  const largeArc = angleDiff > 180 ? 1 : 0;

  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
}

interface TerritoryMapProps {
  vessels?: Record<VesselId, VesselData>;
  hasPrediction?: boolean;
}

export function TerritoryMap({ vessels, hasPrediction }: TerritoryMapProps) {
  const selectedVessel = useAppStore((s) => s.selectedVessel);
  const setSelectedVessel = useAppStore((s) => s.setSelectedVessel);
  const storePrediction = useAppStore((s) => s.prediction);
  const [hoveredSegment, setHoveredSegment] = useState<TerritorySegment | null>(null);

  const effectivePrediction = hasPrediction !== undefined ? hasPrediction : Boolean(storePrediction);
  const isPredictionActive = Boolean(effectivePrediction);
  const [isExpanded, setIsExpanded] = useState<boolean>(isPredictionActive);
  const captionId = useId();

  // Automatically expand when a prediction is made
  const [prevPredictionActive, setPrevPredictionActive] = useState(isPredictionActive);
  if (isPredictionActive !== prevPredictionActive) {
    setPrevPredictionActive(isPredictionActive);
    if (isPredictionActive) {
      setIsExpanded(true);
    }
  }

  const cx = 160;
  const cy = 160;

  return (
    <div
      data-testid="territory-map-container"
      className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 sm:p-3 shadow-xl max-w-[320px] w-full mx-auto"
    >
      {/* Collapsible Card Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-left focus:outline-none"
        aria-expanded={isExpanded}
        aria-controls="territory-map-body"
      >
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-indigo-400" />
          <span className="text-xs font-semibold text-slate-100">
            Coronary territory map (AHA 17-segment)
          </span>
        </div>
        <div className="flex items-center gap-1 text-slate-400">
          <span className="text-[10px] font-mono">
            {isExpanded ? (selectedVessel ? selectedVessel.toUpperCase() : 'Collapse') : 'Expand'}
          </span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {/* Collapsible Body */}
      {isExpanded && (
        <div id="territory-map-body" className="pt-2 border-t border-slate-800/80 mt-2 space-y-2">
          {/* Bull's-eye SVG with Padded ViewBox */}
          <div className="relative flex items-center justify-center p-0.5">
            <svg
              viewBox="0 0 320 320"
              className="w-52 h-52 sm:w-56 sm:h-56"
              role="region"
              aria-label="AHA 17-Segment Coronary Territory Bull's-Eye Map"
              aria-describedby={captionId}
            >
              {/* Anatomical Reference Guides - Padded coordinates avoid clipping */}
              <text x={cx} y="13" textAnchor="middle" className="fill-slate-400 text-[9px] font-bold tracking-wider">
                ANTERIOR
              </text>
              <text x="8" y={cy + 3} textAnchor="start" className="fill-slate-400 text-[9px] font-bold tracking-wider">
                SEPTAL
              </text>
              <text x="312" y={cy + 3} textAnchor="end" className="fill-slate-400 text-[9px] font-bold tracking-wider">
                LATERAL
              </text>
              <text x={cx} y="312" textAnchor="middle" className="fill-slate-400 text-[9px] font-bold tracking-wider">
                INFERIOR
              </text>

          {/* 17 Segments */}
          {territories.map((seg) => {
            const radii = RING_RADII[seg.ring];
            const vesselData = vessels ? vessels[seg.vessel] : null;
            const evalResult = evaluateVesselColor(vesselData);
            const isSelected = selectedVessel === seg.vessel;
            const isHovered = hoveredSegment?.id === seg.id;

            const strokeColor = isSelected
              ? '#ffffff'
              : isHovered
              ? '#cbd5e1'
              : '#0f172a';
            const strokeWidth = isSelected ? 2.5 : isHovered ? 2 : 1;

            if (seg.ring === 'apex') {
              return (
                <g key={seg.id}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radii.rOuter}
                    fill={evalResult.hex}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    className="cursor-pointer transition-all duration-150 focus:outline-none"
                    tabIndex={0}
                    role="button"
                    aria-label={`Segment 17: ${seg.name} (${seg.vessel.toUpperCase()})`}
                    onClick={() => setSelectedVessel(seg.vessel)}
                    onMouseEnter={() => setHoveredSegment(seg)}
                    onMouseLeave={() => setHoveredSegment((prev) => (prev?.id === seg.id ? null : prev))}
                    onFocus={() => setHoveredSegment(seg)}
                    onBlur={() => setHoveredSegment((prev) => (prev?.id === seg.id ? null : prev))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedVessel(seg.vessel);
                      }
                    }}
                  />
                  <text
                    x={cx}
                    y={cy + 3}
                    textAnchor="middle"
                    className="fill-slate-900 text-[9px] font-bold pointer-events-none select-none"
                  >
                    17
                  </text>
                </g>
              );
            }

            const pathD = makeSectorPath(
              cx,
              cy,
              radii.rInner,
              radii.rOuter,
              seg.startAngle,
              seg.endAngle
            );

            // Compute text center for segment number label
            const midAngle = (seg.startAngle + seg.endAngle) / 2;
            const midR = (radii.rInner + radii.rOuter) / 2;
            const tx = cx + midR * Math.cos(degToRad(midAngle));
            const ty = cy + midR * Math.sin(degToRad(midAngle)) + 3;

            return (
              <g key={seg.id}>
                <path
                  d={pathD}
                  fill={evalResult.hex}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  className="cursor-pointer transition-all duration-150 focus:outline-none"
                  tabIndex={0}
                  role="button"
                  aria-label={`Segment ${seg.id}: ${seg.name} (${seg.vessel.toUpperCase()})`}
                  onClick={() => setSelectedVessel(seg.vessel)}
                  onMouseEnter={() => setHoveredSegment(seg)}
                  onMouseLeave={() => setHoveredSegment((prev) => (prev?.id === seg.id ? null : prev))}
                  onFocus={() => setHoveredSegment(seg)}
                  onBlur={() => setHoveredSegment((prev) => (prev?.id === seg.id ? null : prev))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedVessel(seg.vessel);
                    }
                  }}
                />
                <text
                  x={tx.toFixed(1)}
                  y={ty.toFixed(1)}
                  textAnchor="middle"
                  className="fill-slate-950 text-[9px] font-bold pointer-events-none select-none opacity-80"
                >
                  {seg.id}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Hover Info Banner */}
      <div className="w-full min-h-[38px] p-1.5 mt-1 bg-slate-900/80 rounded border border-slate-800 text-[11px] flex flex-col justify-center">
        {hoveredSegment ? (
          <div className="flex items-center justify-between text-slate-200">
            <div>
              <span className="font-semibold text-white">
                Seg {hoveredSegment.id}: {hoveredSegment.name}
              </span>
              <span className="text-indigo-300 ml-1.5 font-mono text-[10px]">
                [{VESSEL_FULL_NAMES[hoveredSegment.vessel]}]
              </span>
            </div>
            {vessels && vessels[hoveredSegment.vessel] && (
              <span className="font-mono text-slate-300 font-semibold text-[10px]">
                {(vessels[hoveredSegment.vessel]!.probability * 100).toFixed(1)}%
              </span>
            )}
          </div>
        ) : (
          <div className="text-slate-400 text-center text-[10px]">
            Hover over segments to inspect territory anatomical labels and vessel assignments
          </div>
        )}
      </div>

      {/* Mandatory Territory Caption (Always visible per contract when expanded) */}
      <p
        id={captionId}
        data-testid="territory-map-caption"
        className="text-[10px] text-slate-400 leading-tight text-center mt-2 px-1"
      >
        {TERRITORY_CAPTION}
      </p>
        </div>
      )}
    </div>
  );
}
