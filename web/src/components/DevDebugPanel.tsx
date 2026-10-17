import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { VesselId, VesselData, HeartTransformConfig } from '../types/viewer';
import {
  Sliders,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Check,
  RotateCcw,
  Crosshair,
  Undo,
  Trash2,
  AlertTriangle,
  Pipette,
  Eye,
  EyeOff,
  Compass,
} from 'lucide-react';
import * as THREE from 'three';
import { coronaryConfig } from '../anatomy';
import {
  type RGBColor,
  sampleVertexColor,
  computeVertexColorDistances,
  computeMaskFromDistances,
  rgbToLab,
} from '../debug/colorDistance';
import { snapPointToNearestVertex } from '../debug/surfaceGraph';
import { getOrCreateSurfaceGraph, computeMagneticPath } from '../debug/graphManager';
import { resamplePath, buildExportConfig } from '../debug/pathSimplifier';

export interface DevDebugPanelProps {
  vessels: Record<VesselId, VesselData>;
  onChangeVesselData: (id: VesselId, data: VesselData) => void;
  tracingVessel: VesselId | null;
  onStartTracing: (vessel: VesselId) => void;
  onCancelTracing: () => void;
  onFinishTracing: () => void;
  onUndoLastPoint: () => void;
  tracePointsCount: number;
  allVesselPoints: Record<VesselId, [number, number, number][]>;
  normalOffset: number;
  onChangeNormalOffset: (val: number) => void;
  onSnapToSurface: () => void;
  heartTransform: HeartTransformConfig;
  onChangeHeartTransform: (transform: HeartTransformConfig) => void;
  onResetPoints: () => void;
  heartMesh?: THREE.Mesh | null;
  onUpdateVesselPoints?: (vessel: VesselId, points: [number, number, number][]) => void;
  onSetAllVesselPoints?: (all: Record<VesselId, [number, number, number][]>) => void;
  onSetMask?: (mask: Uint8Array | null) => void;
  registerPointerHandler?: (
    fn: ((point: THREE.Vector3, normal?: THREE.Vector3) => void) | null
  ) => void;
}

export function DevDebugPanel({
  vessels: _vessels,
  onChangeVesselData,
  tracingVessel,
  onStartTracing,
  onCancelTracing,
  onFinishTracing,
  onUndoLastPoint: _onUndoLastPoint,
  tracePointsCount: _tracePointsCount,
  allVesselPoints,
  normalOffset,
  onChangeNormalOffset,
  onSnapToSurface,
  heartTransform,
  onChangeHeartTransform,
  onResetPoints,
  heartMesh,
  onUpdateVesselPoints,
  onSetAllVesselPoints,
  onSetMask,
  registerPointerHandler,
}: DevDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [selectedTraceTarget, setSelectedTraceTarget] = useState<VesselId>('lad');
  const [copiedCoronary, setCopiedCoronary] = useState(false);
  const [copiedTransform, setCopiedTransform] = useState(false);

  // 1. Color Picker & Mask State
  const [isPickingColor, setIsPickingColor] = useState(false);
  const [pickedColor, setPickedColor] = useState<RGBColor>({ r: 0.85, g: 0.15, b: 0.15 }); // default coronary red
  const [maskThreshold, setMaskThreshold] = useState(0.28);
  const [showMask, setShowMask] = useState(false);
  const [maskPercentage, setMaskPercentage] = useState<number>(0);
  const [maskedCount, setMaskedCount] = useState<number>(0);

  // Cached color distances
  const colorDistancesRef = useRef<Float32Array | null>(null);

  // 2. Surface Graph & Magnetic Trace State
  const graphStatus = useMemo(() => {
    if (!heartMesh) return 'Waiting for heart mesh...';
    try {
      const { stats } = getOrCreateSurfaceGraph(heartMesh);
      return `${(stats.vertexCount / 1000).toFixed(0)}k vertices, ${(
        stats.edgeCount / 1000
      ).toFixed(0)}k edges in ${stats.buildTimeMs}ms`;
    } catch (err) {
      return 'Graph build failed: ' + String(err);
    }
  }, [heartMesh]);

  const [magneticK, setMagneticK] = useState<number>(12); // default 12 per contract
  const [controlPointsN, setControlPointsN] = useState<number>(18); // default 18 per contract
  const [pathWarning, setPathWarning] = useState<string | null>(null);

  // Magnetic waypoints per vessel: list of snapped vertex indices
  const [vesselWaypoints, setVesselWaypoints] = useState<Record<VesselId, number[]>>({
    lad: [],
    lcx: [],
    rca: [],
  });

  // Dense paths along mesh edges per vessel
  const [vesselDensePaths, setVesselDensePaths] = useState<Record<VesselId, number[]>>({
    lad: [],
    lcx: [],
    rca: [],
  });

  // Load drafts from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('cardiomap_coronary_draft');
      if (saved && onSetAllVesselPoints) {
        const parsed = JSON.parse(saved);
        if (parsed.lad || parsed.lcx || parsed.rca) {
          onSetAllVesselPoints(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, [onSetAllVesselPoints]);

  // Compute color distances on mesh ready or picked color change
  useEffect(() => {
    if (!heartMesh) return;
    try {
      const geom = heartMesh.geometry;
      const colorAttr = (geom.attributes.color ||
        geom.attributes.COLOR_0) as THREE.BufferAttribute;
      if (colorAttr) {
        colorDistancesRef.current = computeVertexColorDistances(colorAttr, pickedColor);
      }
    } catch {
      // ignore
    }
  }, [heartMesh, pickedColor]);

  // Update mask when threshold, showMask, or color distances change
  useEffect(() => {
    if (!showMask || !colorDistancesRef.current) {
      if (onSetMask) onSetMask(null);
      setMaskPercentage(0);
      setMaskedCount(0);
      return;
    }

    const { mask, count, percentage } = computeMaskFromDistances(
      colorDistancesRef.current,
      maskThreshold
    );
    setMaskedCount(count);
    setMaskPercentage(percentage);
    if (onSetMask) {
      onSetMask(mask);
    }
  }, [showMask, maskThreshold, onSetMask]);

  // Magnetic Click & Waypoint Handling
  const handleMeshClick = useCallback(
    (point: THREE.Vector3, _normal?: THREE.Vector3) => {
      if (!heartMesh) return;

      // Mode A: Color Picking
      if (isPickingColor) {
        const geom = heartMesh.geometry;
        const colorAttr = (geom.attributes.color ||
          geom.attributes.COLOR_0) as THREE.BufferAttribute;
        if (!colorAttr) return;

        const { graph } = getOrCreateSurfaceGraph(heartMesh);
        const nearestIdx = snapPointToNearestVertex(graph, [point.x, point.y, point.z]);
        const sampled = sampleVertexColor(colorAttr, nearestIdx);
        setPickedColor(sampled);
        colorDistancesRef.current = computeVertexColorDistances(colorAttr, sampled);

        if (showMask) {
          const { mask, count, percentage } = computeMaskFromDistances(
            colorDistancesRef.current,
            maskThreshold
          );
          setMaskedCount(count);
          setMaskPercentage(percentage);
          if (onSetMask) onSetMask(mask);
        }

        setIsPickingColor(false);
        return;
      }

      // Mode B: Magnetic Path Tracing
      if (!tracingVessel) return;

      const { graph } = getOrCreateSurfaceGraph(heartMesh);
      const clickedIdx = snapPointToNearestVertex(graph, [point.x, point.y, point.z]);

      const currentWaypoints = vesselWaypoints[tracingVessel] || [];
      const newWaypoints = [...currentWaypoints, clickedIdx];
      setVesselWaypoints((prev) => ({ ...prev, [tracingVessel]: newWaypoints }));

      if (newWaypoints.length === 1) {
        // First waypoint
        setVesselDensePaths((prev) => ({ ...prev, [tracingVessel]: [clickedIdx] }));
        const p1: [number, number, number] = [
          Number(graph.positions[clickedIdx * 3].toFixed(3)),
          Number(graph.positions[clickedIdx * 3 + 1].toFixed(3)),
          Number(graph.positions[clickedIdx * 3 + 2].toFixed(3)),
        ];
        if (onUpdateVesselPoints) {
          onUpdateVesselPoints(tracingVessel, [p1]);
        }
      } else {
        // Compute Dijkstra from previous waypoint to current waypoint
        const prevIdx = newWaypoints[newWaypoints.length - 2];
        const { result } = computeMagneticPath(
          graph,
          prevIdx,
          clickedIdx,
          colorDistancesRef.current,
          magneticK
        );

        if (result.warning) {
          setPathWarning(result.warning);
        } else {
          setPathWarning(null);
        }

        const existingDense = vesselDensePaths[tracingVessel] || [];
        const segmentVertices = result.path.slice(1); // skip duplicate start
        const combinedDense = [...existingDense, ...segmentVertices];
        setVesselDensePaths((prev) => ({ ...prev, [tracingVessel]: combinedDense }));

        // Convert dense vertex indices to 3D points
        const densePts: [number, number, number][] = combinedDense.map((vIdx) => [
          graph.positions[vIdx * 3],
          graph.positions[vIdx * 3 + 1],
          graph.positions[vIdx * 3 + 2],
        ]);

        const denseNorms: [number, number, number][] = combinedDense.map((vIdx) => [
          graph.normals[vIdx * 3] || 0,
          graph.normals[vIdx * 3 + 1] || 0,
          graph.normals[vIdx * 3 + 2] || 1,
        ]);

        // Resample along arc length to N control points with normal offset
        const resampled = resamplePath(densePts, controlPointsN, {
          normalOffset,
          normals: denseNorms,
        });

        if (onUpdateVesselPoints) {
          onUpdateVesselPoints(tracingVessel, resampled);
        }

        // Auto-save draft to localStorage
        try {
          const draft = { ...allVesselPoints, [tracingVessel]: resampled };
          localStorage.setItem('cardiomap_coronary_draft', JSON.stringify(draft));
        } catch {
          // ignore
        }
      }
    },
    [
      heartMesh,
      isPickingColor,
      tracingVessel,
      vesselWaypoints,
      vesselDensePaths,
      allVesselPoints,
      magneticK,
      controlPointsN,
      normalOffset,
      maskThreshold,
      showMask,
      onSetMask,
      onUpdateVesselPoints,
    ]
  );

  // Register pointer handler with HeartViewer
  useEffect(() => {
    if (registerPointerHandler) {
      if (isPickingColor || tracingVessel) {
        registerPointerHandler(handleMeshClick);
      } else {
        registerPointerHandler(null);
      }
    }
  }, [registerPointerHandler, isPickingColor, tracingVessel, handleMeshClick]);

  // Clear single vessel
  const handleClearVessel = useCallback(
    (vessel: VesselId) => {
      setVesselWaypoints((prev) => ({ ...prev, [vessel]: [] }));
      setVesselDensePaths((prev) => ({ ...prev, [vessel]: [] }));
      if (onUpdateVesselPoints) {
        onUpdateVesselPoints(vessel, []);
      }
    },
    [onUpdateVesselPoints]
  );

  // Undo last waypoint
  const handleUndoWaypoint = useCallback(() => {
    if (!tracingVessel || !heartMesh) return;
    const currentWps = vesselWaypoints[tracingVessel] || [];
    if (currentWps.length <= 1) {
      handleClearVessel(tracingVessel);
      return;
    }

    const { graph } = getOrCreateSurfaceGraph(heartMesh);
    const newWps = currentWps.slice(0, -1);
    setVesselWaypoints((prev) => ({ ...prev, [tracingVessel]: newWps }));

    // Reconstruct dense path
    let dense: number[] = [newWps[0]];
    for (let i = 1; i < newWps.length; i++) {
      const { result } = computeMagneticPath(
        graph,
        newWps[i - 1],
        newWps[i],
        colorDistancesRef.current,
        magneticK
      );
      dense = [...dense, ...result.path.slice(1)];
    }
    setVesselDensePaths((prev) => ({ ...prev, [tracingVessel]: dense }));

    const densePts: [number, number, number][] = dense.map((vIdx) => [
      graph.positions[vIdx * 3],
      graph.positions[vIdx * 3 + 1],
      graph.positions[vIdx * 3 + 2],
    ]);
    const denseNorms: [number, number, number][] = dense.map((vIdx) => [
      graph.normals[vIdx * 3] || 0,
      graph.normals[vIdx * 3 + 1] || 0,
      graph.normals[vIdx * 3 + 2] || 1,
    ]);

    const resampled = resamplePath(densePts, controlPointsN, {
      normalOffset,
      normals: denseNorms,
    });

    if (onUpdateVesselPoints) {
      onUpdateVesselPoints(tracingVessel, resampled);
    }
  }, [
    tracingVessel,
    heartMesh,
    vesselWaypoints,
    magneticK,
    controlPointsN,
    normalOffset,
    onUpdateVesselPoints,
    handleClearVessel,
  ]);

  // Keyboard shortcut listener for tracing
  useEffect(() => {
    if (!tracingVessel) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelTracing();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onFinishTracing();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleUndoWaypoint();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tracingVessel, onCancelTracing, onFinishTracing, handleUndoWaypoint]);

  // Export handlers
  const exportData = useMemo(() => {
    return buildExportConfig(allVesselPoints, coronaryConfig);
  }, [allVesselPoints]);

  const handleCopyCoronaryJson = () => {
    navigator.clipboard.writeText(JSON.stringify(exportData.config, null, 2));
    setCopiedCoronary(true);
    setTimeout(() => setCopiedCoronary(false), 2000);
  };

  const handleDownloadCoronaryJson = () => {
    const jsonStr = JSON.stringify(exportData.config, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'coronary.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyTransformJson = () => {
    navigator.clipboard.writeText(JSON.stringify(heartTransform, null, 2));
    setCopiedTransform(true);
    setTimeout(() => setCopiedTransform(false), 2000);
  };

  const vesselIds: VesselId[] = ['lad', 'lcx', 'rca'];
  const hexColor = useMemo(() => {
    const toHex = (c: number) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${toHex(pickedColor.r)}${toHex(pickedColor.g)}${toHex(pickedColor.b)}`;
  }, [pickedColor]);

  const labValues = useMemo(() => {
    const [l, a, b] = rgbToLab(pickedColor.r, pickedColor.g, pickedColor.b);
    return `L* ${l.toFixed(0)}, a* ${a.toFixed(0)}, b* ${b.toFixed(0)}`;
  }, [pickedColor]);

  // Acceptance Presets to test color mapping directly
  const applyPreset = (presetName: string) => {
    if (presetName === 'acceptance_all') {
      onChangeVesselData('lcx', { probability: 0.45, threshold: 0.3973, highMargin: 0.15 });
      onChangeVesselData('rca', { probability: 0.354, threshold: 0.3354, highMargin: 0.15 });
      onChangeVesselData('lad', { probability: 0.15, threshold: 0.5006, highMargin: 0.15 });
    } else if (presetName === 'lcx_red') {
      onChangeVesselData('lcx', { probability: 0.7, threshold: 0.3973, highMargin: 0.15 });
    } else if (presetName === 'lcx_yellow_orange') {
      onChangeVesselData('lcx', { probability: 0.45, threshold: 0.3973, highMargin: 0.15 });
    } else if (presetName === 'rca_yellow_orange') {
      onChangeVesselData('rca', { probability: 0.354, threshold: 0.3354, highMargin: 0.15 });
    } else if (presetName === 'null_all') {
      onChangeVesselData('lad', null);
      onChangeVesselData('lcx', null);
      onChangeVesselData('rca', null);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-w-[94vw] bg-slate-950/95 backdrop-blur-xl border border-sky-500/50 rounded-xl shadow-2xl text-xs overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900/90 border-b border-sky-500/30 px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sky-400 font-semibold">
          <Sliders className="w-3.5 h-3.5" />
          <span>?debug Artery Trace Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="text-slate-400 hover:text-white p-0.5 rounded"
            aria-label="Toggle panel"
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="p-3 space-y-3.5 max-h-[82vh] overflow-y-auto">
          {!exportData.isAllTraced && (
            <div
              data-testid="debug-untraced-warning"
              className="p-2 bg-amber-950/80 border border-amber-600 rounded-lg text-amber-200 text-[11px] flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="font-medium">
                coronary.json is not traced to this mesh: use Trace mode
              </span>
            </div>
          )}

          {pathWarning && (
            <div className="p-2 bg-rose-950/80 border border-rose-600 rounded-lg text-rose-200 text-[10px] flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>{pathWarning}</span>
            </div>
          )}

          {/* 1. ARTERY MASK & COLOR PICKER */}
          <div className="bg-slate-900/80 p-2.5 rounded-lg border border-sky-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
                <Pipette className="w-3.5 h-3.5 text-sky-400" />
                Artery Color Mask
              </span>
              <span className="text-[10px] font-mono text-slate-400">{graphStatus}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPickingColor(!isPickingColor)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded font-medium text-[11px] border transition ${
                  isPickingColor
                    ? 'bg-amber-600 text-white border-amber-400 shadow animate-pulse'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
              >
                <Pipette className="w-3 h-3" />
                <span>{isPickingColor ? 'Click Artery on Mesh...' : 'Pick Artery Color'}</span>
              </button>

              <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-950 rounded border border-slate-800">
                <span
                  className="w-4 h-4 rounded border border-slate-600 shadow-inner shrink-0"
                  style={{ backgroundColor: hexColor }}
                />
                <span className="font-mono text-[10px] text-slate-200">{hexColor}</span>
              </div>
            </div>

            <div className="text-[9px] text-slate-400 font-mono text-right">{labValues}</div>

            {/* Mask Threshold Slider & Show Mask Toggle */}
            <div className="space-y-1 pt-1 border-t border-slate-800/80">
              <div className="flex justify-between items-center text-[10px] text-slate-300">
                <span>Color Distance Threshold:</span>
                <span className="font-mono text-sky-300">{maskThreshold.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.60"
                step="0.01"
                value={maskThreshold}
                onChange={(e) => setMaskThreshold(parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-sky-400"
              />

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setShowMask(!showMask)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-medium transition border ${
                    showMask
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                >
                  {showMask ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  <span>{showMask ? 'Overlay Active' : 'Show Green Mask'}</span>
                </button>

                {showMask && (
                  <span className="text-[10px] font-mono text-emerald-400 font-semibold">
                    {maskPercentage.toFixed(1)}% selected ({maskedCount.toLocaleString()} vtx)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 2. MAGNETIC PATH TRACER */}
          <div className="bg-slate-900/80 p-2.5 rounded-lg border border-sky-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5 text-sky-400" />
                Magnetic Path Tracer
              </span>
              {tracingVessel && (
                <span className="bg-amber-500/20 text-amber-300 text-[10px] px-1.5 py-0.5 rounded font-mono font-bold animate-pulse">
                  TRACING {tracingVessel.toUpperCase()} (
                  {(vesselWaypoints[tracingVessel] || []).length} wps)
                </span>
              )}
            </div>

            {/* Vessel Selector & Status Chips */}
            <div className="grid grid-cols-3 gap-1">
              {vesselIds.map((vid) => {
                const pts = allVesselPoints[vid] || [];
                const isTraced = pts.length >= 2;
                const isCurrent = selectedTraceTarget === vid;
                return (
                  <button
                    key={vid}
                    type="button"
                    onClick={() => setSelectedTraceTarget(vid)}
                    className={`p-1.5 rounded text-left border transition ${
                      isCurrent
                        ? 'bg-sky-950/80 border-sky-400 text-white'
                        : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold uppercase text-[11px]">{vid}</span>
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isTraced ? 'bg-emerald-400' : 'bg-slate-500'
                        }`}
                      />
                    </div>
                    <div className="text-[9px] font-mono text-slate-400 mt-0.5">
                      {isTraced ? `${pts.length} pts` : 'untraced'}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Tracing Action Controls */}
            {tracingVessel ? (
              <div className="space-y-2 pt-1">
                <p className="text-[10px] text-amber-200/90 leading-relaxed bg-amber-950/40 p-2 rounded border border-amber-600/40">
                  Click along painted artery on heart. Shortest magnetic path is calculated
                  instantly.
                  <br />
                  <strong className="text-white">Enter</strong>: finish &bull;{' '}
                  <strong className="text-white">Esc</strong>: cancel &bull;{' '}
                  <strong className="text-white">Backspace</strong>: undo
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={handleUndoWaypoint}
                    className="flex items-center justify-center gap-1 px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium text-[11px]"
                  >
                    <Undo className="w-3 h-3" />
                    Undo
                  </button>
                  <button
                    type="button"
                    onClick={onCancelTracing}
                    className="px-2 py-1.5 bg-rose-950/60 hover:bg-rose-900 text-rose-300 rounded font-medium text-[11px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onFinishTracing}
                    className="px-2 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium text-[11px]"
                  >
                    Finish
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onStartTracing(selectedTraceTarget)}
                    className="px-2 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded font-semibold text-[11px] flex items-center justify-center gap-1 shadow"
                  >
                    <Crosshair className="w-3 h-3" />
                    <span>Trace {selectedTraceTarget.toUpperCase()}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleClearVessel(selectedTraceTarget)}
                    className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-rose-300 rounded font-medium text-[11px] flex items-center justify-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear {selectedTraceTarget.toUpperCase()}</span>
                  </button>
                </div>

                {/* Magnetic K & N Points Sliders */}
                <div className="space-y-1.5 pt-1">
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Magnetic Weight k:</span>
                      <span className="font-mono text-sky-300">{magneticK}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="30"
                      step="1"
                      value={magneticK}
                      onChange={(e) => setMagneticK(parseInt(e.target.value, 10))}
                      className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-sky-400"
                    />
                    <div className="flex justify-between text-[8px] text-slate-500">
                      <span>0 (Geodesic)</span>
                      <span>12 (Default)</span>
                      <span>30 (Strong)</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Control Points N:</span>
                      <span className="font-mono text-sky-300">{controlPointsN}</span>
                    </div>
                    <input
                      type="range"
                      min="8"
                      max="32"
                      step="1"
                      value={controlPointsN}
                      onChange={(e) => setControlPointsN(parseInt(e.target.value, 10))}
                      className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-sky-400"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Normal Offset Epsilon:</span>
                      <span className="font-mono text-sky-300">{normalOffset.toFixed(3)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.005"
                      max="0.04"
                      step="0.002"
                      value={normalOffset}
                      onChange={(e) => onChangeNormalOffset(parseFloat(e.target.value))}
                      className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-sky-400"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 3. CLINICAL ANATOMY ON-SCREEN GUIDE */}
          <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-indigo-400" />
              Anatomical Tracing Guide
            </span>
            <div className="text-[10px] text-slate-400 space-y-1 leading-normal">
              <p>
                <strong className="text-white">LAD:</strong> Starts near left main (anterior, left
                of aortic root) and runs down anterior interventricular groove to the apex.
              </p>
              <p>
                <strong className="text-white">LCX:</strong> Leaves left main and wraps left AV
                groove toward the posterior surface (rotate heart).
              </p>
              <p>
                <strong className="text-white">RCA:</strong> Starts at right coronary ostium and
                runs along right AV groove to crux on back.
              </p>
              <p className="text-indigo-300 font-medium pt-0.5">
                Tip: Place 4 to 8 waypoints per vessel for optimal magnetic tracking.
              </p>
            </div>
          </div>

          {/* 4. EXPORT & DOWNLOAD */}
          <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-400">Export Validation:</span>
              <span
                className={`font-semibold ${
                  exportData.isAllTraced ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {exportData.isAllTraced
                  ? 'Ready ("traced": true)'
                  : 'Pending all 3 vessels ("traced": false)'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={handleCopyCoronaryJson}
                className="flex items-center justify-center gap-1 px-2 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-semibold text-[11px]"
              >
                {copiedCoronary ? (
                  <Check className="w-3 h-3 text-emerald-300" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>{copiedCoronary ? 'Copied!' : 'Copy coronary.json'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadCoronaryJson}
                className="flex items-center justify-center gap-1 px-2 py-1.5 bg-slate-800 hover:bg-slate-750 text-sky-300 border border-slate-700 rounded font-semibold text-[11px]"
              >
                <Download className="w-3 h-3" />
                <span>Download JSON</span>
              </button>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-slate-800">
              <button
                type="button"
                onClick={onSnapToSurface}
                className="text-[10px] text-sky-400 hover:underline"
                title="Raycast control points toward model centroid and snap to outer surface"
              >
                Snap to Surface
              </button>
              <button
                type="button"
                onClick={onResetPoints}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200"
                title="Reset to default coronary splines"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Splines</span>
              </button>
            </div>
          </div>

          {/* 5. MODEL TRANSFORM (heartTransform.json) */}
          <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                Model Transform (heartTransform.json)
              </span>
              <button
                type="button"
                onClick={handleCopyTransformJson}
                className="flex items-center gap-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded text-[10px] font-medium"
              >
                {copiedTransform ? (
                  <Check className="w-2.5 h-2.5 text-emerald-300" />
                ) : (
                  <Copy className="w-2.5 h-2.5" />
                )}
                <span>{copiedTransform ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>

            <div className="space-y-1.5">
              {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                <div key={`rot-${axis}`}>
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Rotation {axis}:</span>
                    <span className="font-mono text-slate-200">{heartTransform.rotation[idx]}°</span>
                  </div>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    step="1"
                    value={heartTransform.rotation[idx]}
                    onChange={(e) => {
                      const newRot = [...heartTransform.rotation] as [number, number, number];
                      newRot[idx] = parseInt(e.target.value, 10);
                      onChangeHeartTransform({ ...heartTransform, rotation: newRot });
                    }}
                    className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-sky-400"
                  />
                </div>
              ))}
            </div>

            <div>
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Position Y (elevation):</span>
                <span className="font-mono text-slate-200">
                  {heartTransform.position[1].toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.02"
                value={heartTransform.position[1]}
                onChange={(e) => {
                  const newPos = [...heartTransform.position] as [number, number, number];
                  newPos[1] = parseFloat(e.target.value);
                  onChangeHeartTransform({ ...heartTransform, position: newPos });
                }}
                className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-400"
              />
            </div>
          </div>

          {/* 6. DEV PRESETS */}
          <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Risk Color Presets
            </span>
            <div className="grid grid-cols-2 gap-1 text-[10px]">
              <button
                type="button"
                onClick={() => applyPreset('acceptance_all')}
                className="p-1 bg-slate-800 hover:bg-slate-700 text-sky-300 rounded truncate"
              >
                All 3 Arteries
              </button>
              <button
                type="button"
                onClick={() => applyPreset('lcx_red')}
                className="p-1 bg-slate-800 hover:bg-slate-700 text-rose-400 rounded truncate"
              >
                LCX Red (&ge;t+0.35)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('lcx_yellow_orange')}
                className="p-1 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded truncate"
              >
                LCX Orange
              </button>
              <button
                type="button"
                onClick={() => applyPreset('null_all')}
                className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded truncate"
              >
                Null (Gray)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DevDebugPanel;
