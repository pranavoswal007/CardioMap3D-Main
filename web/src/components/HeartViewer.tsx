import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Bounds, useBounds } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { RotateCcw, Info, Layers, HeartPulse } from 'lucide-react';

import type { VesselId, VesselData, HeartViewerProps, VesselConfig, HeartTransformConfig } from '../types/viewer';
import { vesselsList, defaultHeartTransform, coronaryConfig } from '../anatomy';
import { evaluateVesselColor } from '../utils/vesselColors';
import { HeartBody } from './HeartBody';
import { CoronaryArteryMesh } from './CoronaryArteryMesh';
import { createTaperedTubeGeometry } from '../utils/taperedTube';
import heartAttributionText from '../../public/models/ATTRIBUTION.txt?raw';

// Lazy-load debug panel and mask overlay so normal clinical bundle does not grow
const DevDebugPanel = React.lazy(() => import('./DevDebugPanel'));
const ArteryMaskOverlay = React.lazy(() =>
  import('../debug/ArteryMaskOverlay').then((m) => ({ default: m.ArteryMaskOverlay }))
);

const INITIAL_CAMERA_POS: [number, number, number] = [0, 0.4, 3.8];
const INITIAL_TARGET_POS: [number, number, number] = [0, 0, 0];

/**
 * Bounds auto-fit controller that centers and fits the model within the viewport
 * with 10% margin on initial mount and on view reset.
 */
function AutoFitController({ resetCount }: { resetCount: number }) {
  const bounds = useBounds();
  const prevReset = useRef(resetCount);

  useEffect(() => {
    try {
      bounds.refresh().fit();
    } catch {
      // headless / mock environments
    }
  }, [bounds]);

  useEffect(() => {
    if (resetCount !== prevReset.current) {
      prevReset.current = resetCount;
      try {
        bounds.refresh().fit();
      } catch {
        // headless / mock environments
      }
    }
  }, [resetCount, bounds]);

  return null;
}

/**
 * Camera controller handling smooth transition animations on vessel selection and view reset.
 */
function CameraRig({
  selectedVessel,
  resetCount,
  controlsRef,
  allVesselPoints,
}: {
  selectedVessel: VesselId | null;
  resetCount: number;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  allVesselPoints: Record<VesselId, [number, number, number][]>;
}) {
  const targetCamPos = useRef(new THREE.Vector3(...INITIAL_CAMERA_POS));
  const targetLookAt = useRef(new THREE.Vector3(...INITIAL_TARGET_POS));
  const prevSelected = useRef<VesselId | null>(null);
  const prevReset = useRef(resetCount);

  useEffect(() => {
    if (resetCount !== prevReset.current) {
      prevReset.current = resetCount;
      targetCamPos.current.set(...INITIAL_CAMERA_POS);
      targetLookAt.current.set(...INITIAL_TARGET_POS);
      return;
    }

    if (selectedVessel !== prevSelected.current) {
      prevSelected.current = selectedVessel;
      if (selectedVessel) {
        const cfg = vesselsList.find((v) => v.id === selectedVessel);
        if (cfg) {
          targetCamPos.current.set(...cfg.cameraFocus);
          const pts = allVesselPoints[selectedVessel] || cfg.points;
          const midPoint = pts[Math.floor(pts.length / 2)];
          if (midPoint) {
            targetLookAt.current.set(midPoint[0] * 0.5, midPoint[1] * 0.5, midPoint[2] * 0.5);
          }
        }
      } else {
        targetCamPos.current.set(...INITIAL_CAMERA_POS);
        targetLookAt.current.set(...INITIAL_TARGET_POS);
      }
    }
  }, [selectedVessel, resetCount, allVesselPoints]);

  useFrame(({ camera }, delta) => {
    camera.position.lerp(targetCamPos.current, Math.min(1, delta * 3.5));
    if (controlsRef.current) {
      controlsRef.current.target.lerp(targetLookAt.current, Math.min(1, delta * 3.5));
      controlsRef.current.update();
    }
  });

  return null;
}

/**
 * Pulsing group providing subtle cardiac rhythm when bpm prop is provided.
 * Disabled when bpm is absent or when prefers-reduced-motion is active.
 */
function PulsingHeartGroup({
  bpm,
  children,
}: {
  bpm?: number;
  children: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!bpm || bpm <= 0 || prefersReducedMotion) {
      groupRef.current.scale.set(1, 1, 1);
      return;
    }

    const elapsed = clock.getElapsedTime();
    const freq = (bpm / 60) * 2 * Math.PI;
    const pulse = 1.0 + 0.015 * (1 + Math.sin(elapsed * freq));
    groupRef.current.scale.set(pulse, pulse, pulse);
  });

  return <group ref={groupRef}>{children}</group>;
}

/**
 * Live trace preview line and control point markers rendered during trace mode.
 */
function TracePreview({
  points,
}: {
  points: [number, number, number][];
}) {
  const previewGeometry = useMemo(() => {
    if (points.length < 2) return null;
    const vectors = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(vectors, false, 'catmullrom', 0.5);
    return createTaperedTubeGeometry(curve, 48, 0.045, 0.025, 10);
  }, [points]);

  return (
    <group>
      {points.map((pt, idx) => (
        <mesh key={idx} position={pt}>
          <sphereGeometry args={[0.022, 12, 12]} />
          <meshBasicMaterial color={idx === 0 ? '#10b981' : '#38bdf8'} />
        </mesh>
      ))}

      {previewGeometry && (
        <mesh geometry={previewGeometry}>
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#38bdf8"
            emissiveIntensity={0.6}
            roughness={0.2}
          />
        </mesh>
      )}
    </group>
  );
}

export function HeartViewer({
  vessels: initialVessels,
  selectedVessel,
  onSelectVessel,
  className = '',
  bpm,
}: HeartViewerProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const heartMeshRef = useRef<THREE.Mesh | null>(null);
  const [heartMesh, setHeartMesh] = useState<THREE.Mesh | null>(null);

  const [resetCount, setResetCount] = useState(0);
  const [hoveredVessel, setHoveredVessel] = useState<VesselId | null>(null);
  const [xRay, setXRay] = useState(false); // Default OFF: opaque, vertex-colored heart
  const [showCredits, setShowCredits] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // ?debug detection
  const [isDebugMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).has('debug');
    }
    return false;
  });

  const [debugVessels, setDebugVessels] = useState<Record<VesselId, VesselData> | null>(null);
  const [heartTransform, setHeartTransform] = useState<HeartTransformConfig>(defaultHeartTransform);
  const [normalOffset, setNormalOffset] = useState<number>(0.02);
  const [activeMask, setActiveMask] = useState<Uint8Array | null>(null);
  const debugPointerHandlerRef = useRef<((point: THREE.Vector3, normal?: THREE.Vector3) => void) | null>(null);

  // Spline points for all vessels (draft persistence)
  const [allVesselPoints, setAllVesselPoints] = useState<Record<VesselId, [number, number, number][]>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('cardiomap_coronary_draft');
        if (saved) return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return {
      lad: vesselsList.find((v) => v.id === 'lad')?.points || [],
      lcx: vesselsList.find((v) => v.id === 'lcx')?.points || [],
      rca: vesselsList.find((v) => v.id === 'rca')?.points || [],
    };
  });

  // Active Tracing State
  const [tracingVessel, setTracingVessel] = useState<VesselId | null>(null);
  const [activeTracePoints, setActiveTracePoints] = useState<[number, number, number][]>([]);

  const effectiveVessels = isDebugMode && debugVessels ? debugVessels : initialVessels;

  const handleResetView = () => {
    setResetCount((c) => c + 1);
  };

  const handleDebugChange = (id: VesselId, data: VesselData) => {
    setDebugVessels((prev) => ({
      ...(prev || effectiveVessels),
      [id]: data,
    }));
  };

  const handleUpdateVesselPoints = useCallback((vessel: VesselId, points: [number, number, number][]) => {
    setAllVesselPoints((prev) => ({
      ...prev,
      [vessel]: points,
    }));
  }, []);

  // Automatic mesh surface projection at load when coronary.json is not yet traced
  const hasProjectedRef = useRef(false);
  const projectPointsOntoMesh = useCallback((mesh: THREE.Mesh) => {
    if (coronaryConfig.traced || hasProjectedRef.current) return;
    const raycaster = new THREE.Raycaster();
    const snapped: Record<VesselId, [number, number, number][]> = { ...allVesselPoints };

    (Object.keys(allVesselPoints) as VesselId[]).forEach((vid) => {
      const pts = allVesselPoints[vid];
      snapped[vid] = pts.map((p) => {
        const v = new THREE.Vector3(p[0], p[1], p[2]);
        const dir = new THREE.Vector3(0, 0, 0).sub(v).normalize();
        const origin = v.clone().addScaledVector(dir, -0.6);
        raycaster.set(origin, dir);
        const hits = raycaster.intersectObject(mesh, false);
        if (hits.length > 0) {
          const hit = hits[0];
          const hitNorm = hit.face?.normal || new THREE.Vector3(0, 0, 1);
          const newPt = hit.point.clone().addScaledVector(hitNorm, 0.015);
          return [
            Number(newPt.x.toFixed(3)),
            Number(newPt.y.toFixed(3)),
            Number(newPt.z.toFixed(3)),
          ];
        }
        return p;
      });
    });

    setAllVesselPoints(snapped);
    hasProjectedRef.current = true;
  }, [allVesselPoints]);

  const handleMeshReady = useCallback((mesh: THREE.Mesh) => {
    heartMeshRef.current = mesh;
    setHeartMesh(mesh);
    projectPointsOntoMesh(mesh);
  }, [projectPointsOntoMesh]);

  // Trace Tool Handlers
  const handleStartTracing = (vessel: VesselId) => {
    setTracingVessel(vessel);
    setActiveTracePoints([]);
  };

  const handleCancelTracing = useCallback(() => {
    setTracingVessel(null);
    setActiveTracePoints([]);
  }, []);

  const handleFinishTracing = useCallback(() => {
    if (tracingVessel && activeTracePoints.length >= 2) {
      setAllVesselPoints((prev) => {
        const updated = {
          ...prev,
          [tracingVessel]: activeTracePoints,
        };
        try {
          localStorage.setItem('cardiomap_coronary_draft', JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });
    }
    setTracingVessel(null);
    setActiveTracePoints([]);
  }, [tracingVessel, activeTracePoints]);

  const handleUndoLastPoint = useCallback(() => {
    setActiveTracePoints((pts) => pts.slice(0, -1));
  }, []);

  const handleResetPoints = () => {
    try {
      localStorage.removeItem('cardiomap_coronary_draft');
    } catch {
      // ignore
    }
    setAllVesselPoints({
      lad: vesselsList.find((v) => v.id === 'lad')?.points || [],
      lcx: vesselsList.find((v) => v.id === 'lcx')?.points || [],
      rca: vesselsList.find((v) => v.id === 'rca')?.points || [],
    });
  };

  // Raycast click on heart surface during trace mode or debug color/trace modes
  const handleMeshPointerDown = (point: THREE.Vector3, normal?: THREE.Vector3) => {
    if (debugPointerHandlerRef.current) {
      debugPointerHandlerRef.current(point, normal);
      return;
    }
    if (!tracingVessel) return;
    const norm = normal || new THREE.Vector3(0, 0, 1);
    const offsetPoint: [number, number, number] = [
      Number((point.x + norm.x * normalOffset).toFixed(3)),
      Number((point.y + norm.y * normalOffset).toFixed(3)),
      Number((point.z + norm.z * normalOffset).toFixed(3)),
    ];
    setActiveTracePoints((prev) => [...prev, offsetPoint]);
  };

  // Snap existing control points to outer mesh surface
  const handleSnapToSurface = () => {
    if (!heartMeshRef.current) return;
    const mesh = heartMeshRef.current;
    const raycaster = new THREE.Raycaster();

    const snapped: Record<VesselId, [number, number, number][]> = { ...allVesselPoints };
    (Object.keys(allVesselPoints) as VesselId[]).forEach((vid) => {
      const pts = allVesselPoints[vid];
      snapped[vid] = pts.map((p) => {
        const v = new THREE.Vector3(p[0], p[1], p[2]);
        const dir = new THREE.Vector3(0, 0, 0).sub(v).normalize();
        const origin = v.clone().addScaledVector(dir, -0.6);
        raycaster.set(origin, dir);
        const hits = raycaster.intersectObject(mesh, false);
        if (hits.length > 0) {
          const hit = hits[0];
          const hitNorm = hit.face?.normal || new THREE.Vector3(0, 0, 1);
          const newPt = hit.point.clone().addScaledVector(hitNorm, normalOffset);
          return [
            Number(newPt.x.toFixed(3)),
            Number(newPt.y.toFixed(3)),
            Number(newPt.z.toFixed(3)),
          ];
        }
        return p;
      });
    });

    setAllVesselPoints(snapped);
    try {
      localStorage.setItem('cardiomap_coronary_draft', JSON.stringify(snapped));
    } catch {
      // ignore
    }
  };

  // Keyboard shortcut listener for tracing
  useEffect(() => {
    if (!tracingVessel) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancelTracing();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleFinishTracing();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleUndoLastPoint();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tracingVessel, handleCancelTracing, handleFinishTracing, handleUndoLastPoint]);

  // Active vessel to display in info tooltip (hovered takes precedence, then selected)
  const activeVesselId = hoveredVessel || selectedVessel;
  const activeVesselConfig: VesselConfig | undefined = useMemo(() => {
    return vesselsList.find((v) => v.id === activeVesselId);
  }, [activeVesselId]);

  const activeVesselData = activeVesselId ? effectiveVessels[activeVesselId] : null;
  const activeEvaluation = useMemo(() => {
    return evaluateVesselColor(activeVesselData);
  }, [activeVesselData]);

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div
      data-testid="hero-viewer-card"
      className={`flex flex-col w-full h-[60vh] lg:h-[calc(100vh-7.5rem)] min-h-[560px] max-h-[900px] bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative ${className}`}
    >
      {/* 1. NON-OVERLAPPING Header Row: Title on Left, Controls on Right (Wraps on narrow screens) */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 border-b border-slate-800 bg-slate-900/95 shrink-0 z-10">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse" />
          <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-sky-400 truncate">
            3D Coronary Anatomy Model
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {bpm !== undefined && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs font-medium">
              <HeartPulse className="w-3.5 h-3.5 animate-pulse text-rose-400" />
              <span>Heartbeat</span>
              <span className="font-mono text-[10px] text-rose-300">({bpm} bpm)</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setXRay(!xRay)}
            aria-label="Toggle X-ray semi-transparent view"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition shadow-sm ${
              xRay
                ? 'bg-sky-600/90 text-white border-sky-400'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            <span>{xRay ? 'X-Ray Active' : 'X-Ray View'}</span>
          </button>

          <button
            type="button"
            onClick={handleResetView}
            aria-label="Reset 3D camera viewpoint"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 text-xs font-medium transition shadow-sm"
          >
            <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
            <span>Reset View</span>
          </button>

          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            aria-label="Viewer interaction hints and clinical anatomy notice"
            className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center font-bold text-xs border border-slate-700 transition"
          >
            ?
          </button>
        </div>
      </div>

      {/* 2. Three.js Canvas: Fills remaining height, fits camera with 10% margin */}
      <div
        className="flex-1 relative w-full overflow-hidden bg-gradient-to-b from-[#060a12] via-[#0b1220] to-[#060a12]"
        onDoubleClick={() => {
          if (tracingVessel) handleFinishTracing();
        }}
      >
        {/* Floating Active Vessel Tooltip */}
        {activeVesselConfig && (
          <div
            className="absolute top-3 left-3 z-20 max-w-xs bg-slate-950/90 backdrop-blur-xl p-3 rounded-xl border shadow-2xl transition-all duration-200 pointer-events-none"
            style={{ borderColor: activeEvaluation.hex }}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-bold text-xs sm:text-sm text-slate-100 flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                  style={{ backgroundColor: activeEvaluation.hex }}
                />
                {activeVesselConfig.displayName}
              </span>
              <span
                className="font-mono text-xs font-bold px-1.5 py-0.5 rounded"
                style={{
                  color: activeEvaluation.hex,
                  backgroundColor: `${activeEvaluation.hex}20`,
                }}
              >
                {activeVesselData && activeVesselData.probability !== null
                  ? `${(activeVesselData.probability * 100).toFixed(1)}%`
                  : 'No prediction yet'}
              </span>
            </div>

            <div className="text-[11px] font-medium text-slate-300 mb-1">
              Status:{' '}
              <span style={{ color: activeEvaluation.hex }}>
                {activeEvaluation.label}
              </span>{' '}
              <span className="text-slate-500 font-mono text-[10px]">
                (cutoff t = {(activeEvaluation.t * 100).toFixed(1)}%)
              </span>
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed border-t border-slate-800/80 pt-1">
              {activeVesselConfig.description}
            </p>
          </div>
        )}

        <Canvas
          camera={{ position: INITIAL_CAMERA_POS, fov: 45 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'default' }}
          onPointerMissed={() => {
            if (!tracingVessel) onSelectVessel(null);
          }}
        >
          <ambientLight intensity={0.7} />
          <directionalLight position={[4, 6, 5]} intensity={1.5} />
          <directionalLight position={[-4, -2, 3]} intensity={0.5} color="#93c5fd" />
          <directionalLight position={[0, 4, -5]} intensity={0.8} color="#e0f2fe" />

          <ContactShadows
            position={[0, -1.25, 0]}
            opacity={0.45}
            scale={3.5}
            blur={2.2}
            far={3.0}
          />

          <CameraRig
            selectedVessel={selectedVessel}
            resetCount={resetCount}
            controlsRef={controlsRef}
            allVesselPoints={allVesselPoints}
          />

          {/* Bounds fits model bounding box with 10% margin on load/resize/reset */}
          <Bounds fit clip observe margin={1.1}>
            <AutoFitController resetCount={resetCount} />
            <PulsingHeartGroup bpm={bpm}>
              <HeartBody
                xRay={xRay}
                transform={heartTransform}
                onMeshPointerDown={handleMeshPointerDown}
                meshRef={heartMeshRef}
                onMeshReady={handleMeshReady}
              />

              {vesselsList.map((cfg) => (
                <CoronaryArteryMesh
                  key={cfg.id}
                  config={cfg}
                  data={effectiveVessels[cfg.id]}
                  selected={selectedVessel === cfg.id}
                  hovered={hoveredVessel === cfg.id}
                  onSelect={() => onSelectVessel(selectedVessel === cfg.id ? null : cfg.id)}
                  onHover={(hov) => setHoveredVessel(hov ? cfg.id : null)}
                  overridePoints={allVesselPoints[cfg.id]}
                />
              ))}

              {/* Mask overlay on heart mesh vertices when active in debug mode */}
              {isDebugMode && activeMask && heartMesh && (
                <React.Suspense fallback={null}>
                  <ArteryMaskOverlay mesh={heartMesh} mask={activeMask} />
                </React.Suspense>
              )}

              {tracingVessel && activeTracePoints.length > 0 && (
                <TracePreview points={activeTracePoints} />
              )}
            </PulsingHeartGroup>
          </Bounds>

          <OrbitControls
            ref={controlsRef}
            makeDefault
            enablePan={!tracingVessel}
            enableZoom
            enableRotate
            enableDamping
            dampingFactor={0.05}
            minDistance={1.6}
            maxDistance={5.5}
            autoRotate={!prefersReducedMotion && !tracingVessel}
            autoRotateSpeed={0.6}
          />
        </Canvas>
      </div>

      {/* 3. Keyboard-Accessible Vessel Selector Chips (Directly under canvas, always visible) */}
      <div
        role="region"
        aria-label="Coronary Artery Selection Chips"
        className="flex items-center justify-between px-3.5 py-1.5 bg-slate-950 border-t border-slate-800/80 shrink-0 text-xs"
      >
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          <span className="text-[10px] uppercase font-semibold text-slate-500 mr-1 hidden sm:inline">
            Arteries:
          </span>
          {vesselsList.map((cfg) => {
            const isSelected = selectedVessel === cfg.id;
            const data = effectiveVessels[cfg.id];
            const evalRes = evaluateVesselColor(data);
            const probStr = data && data.probability !== null ? `${(data.probability * 100).toFixed(1)}%` : '—';
            return (
              <button
                key={cfg.id}
                type="button"
                role="button"
                aria-pressed={isSelected}
                aria-label={`${cfg.displayName}: ${probStr}, ${evalRes.label}`}
                onClick={() => onSelectVessel(isSelected ? null : cfg.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition border ${
                  isSelected
                    ? 'bg-slate-800 text-white border-sky-400 shadow-sm ring-1 ring-sky-400/50'
                    : 'bg-slate-900 text-slate-300 border-slate-700/80 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: evalRes.hex }}
                />
                <span className="font-bold">{cfg.shortName}</span>
                <span className="text-[11px] font-mono text-slate-400">{probStr}</span>
              </button>
            );
          })}
        </div>

        {selectedVessel && (
          <button
            type="button"
            onClick={() => onSelectVessel(null)}
            className="text-[10px] text-sky-400 hover:text-sky-300 underline font-mono shrink-0 ml-2"
            aria-label="Clear vessel selection"
          >
            Clear selection
          </button>
        )}
      </div>

      {/* 4. Slim Bottom Strip: Pill, Compact Legend, Credit line, and Credits Expander */}
      <div className="px-3.5 py-2 bg-slate-900 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950/70 text-amber-300 border border-amber-800/60 whitespace-nowrap">
            Illustrative anatomy, not patient imaging
          </span>

          <div className="flex items-center gap-2 text-[10px] text-slate-400 border-l border-slate-800 pl-2">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#10b981]" />
              <span>&lt;t</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#eab308]" />
              <span>&ge;t</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#f97316]" />
              <span>&ge;t+0.15</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#ef4444]" />
              <span>&ge;t+0.35</span>
            </div>
            <span className="text-slate-500 font-mono hidden md:inline">
              ({selectedVessel ? selectedVessel.toUpperCase() : 'LAD'} t ={' '}
              {((effectiveVessels[selectedVessel || 'lad']?.threshold ?? 0.501) * 100).toFixed(1)}%)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <span className="text-slate-400 truncate max-w-xs sm:max-w-none">
            Heart model: Hannah Newey, University of Dundee (CC BY-NC-SA 4.0)
          </span>

          <button
            type="button"
            onClick={() => setShowCredits(!showCredits)}
            className="text-sky-400 hover:text-sky-300 underline font-medium whitespace-nowrap"
          >
            {showCredits ? 'Close credits' : 'Credits'}
          </button>
        </div>
      </div>

      {/* Expanded Credits Panel (Exact trimmed equality to ATTRIBUTION.txt) */}
      {showCredits && (
        <div
          data-testid="viewer-credits-panel"
          className="p-3 bg-slate-950 border-t border-slate-800 text-[10px] text-slate-300 leading-relaxed font-mono whitespace-pre-wrap shrink-0"
        >
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800 text-[11px] font-sans font-semibold text-white">
            <span>3D Model Attribution</span>
            <button
              type="button"
              onClick={() => setShowCredits(false)}
              className="text-slate-400 hover:text-white"
            >
              &times;
            </button>
          </div>
          <p data-testid="viewer-credits-text">{heartAttributionText.trim()}</p>
        </div>
      )}

      {/* Help ? Popover */}
      {showHelp && (
        <div
          data-testid="viewer-help-popover"
          className="p-3 bg-slate-950 border-t border-slate-800 text-xs text-slate-300 space-y-2 shrink-0"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-white">
            <span className="flex items-center gap-1.5 text-sky-400">
              <Info className="w-3.5 h-3.5" /> 3D Viewport Interaction & Notes
            </span>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="text-slate-400 hover:text-white"
            >
              &times;
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-300">
            <div>
              <span className="font-semibold text-white">Navigation:</span> Rotate: Left Click + Drag &bull; Zoom: Scroll &bull; Pan: Right Click
            </div>
            <div>
              <span className="font-semibold text-white">Selection:</span> Click vessel to highlight &bull; Click background to deselect
            </div>
          </div>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Coronary geometries depict stylized canonical perfusion tracts. Vessel coloring reflects screening probability models. Click a vessel to highlight; click background to deselect.
          </p>
        </div>
      )}

      {/* Optional Dev Debug & Surface Tracing Panel (?debug) */}
      {isDebugMode && (
        <React.Suspense fallback={null}>
          <DevDebugPanel
            vessels={effectiveVessels}
            onChangeVesselData={handleDebugChange}
            tracingVessel={tracingVessel}
            onStartTracing={handleStartTracing}
            onCancelTracing={handleCancelTracing}
            onFinishTracing={handleFinishTracing}
            onUndoLastPoint={handleUndoLastPoint}
            tracePointsCount={activeTracePoints.length}
            allVesselPoints={allVesselPoints}
            normalOffset={normalOffset}
            onChangeNormalOffset={setNormalOffset}
            onSnapToSurface={handleSnapToSurface}
            heartTransform={heartTransform}
            onChangeHeartTransform={setHeartTransform}
            onResetPoints={handleResetPoints}
            heartMesh={heartMesh}
            onUpdateVesselPoints={handleUpdateVesselPoints}
            onSetAllVesselPoints={setAllVesselPoints}
            onSetMask={setActiveMask}
            registerPointerHandler={(fn) => {
              debugPointerHandlerRef.current = fn;
            }}
          />
        </React.Suspense>
      )}
    </div>
  );
}

export default HeartViewer;
