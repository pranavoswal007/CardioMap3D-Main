/**
 * Strict typing for CardioMap 3D HeartViewer and anatomical vessel mapping.
 */

export type VesselId = 'lad' | 'lcx' | 'rca';

export type VesselData = {
  probability: number;
  threshold: number;
  highMargin?: number; // defaults to 0.15
} | null;

export interface HeartViewerProps {
  vessels: Record<VesselId, VesselData>;
  selectedVessel: VesselId | null;
  onSelectVessel: (id: VesselId | null) => void;
  className?: string;
  bpm?: number;
}

export interface HeartTransformConfig {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  flip: [number, number, number];
}

export interface VesselConfig {
  id: VesselId;
  displayName: string;
  shortName: string;
  description: string;
  radius: number;
  cameraFocus: [number, number, number];
  points: [number, number, number][];
}

export interface CoronaryDataConfig {
  version: string;
  comment: string;
  traced: boolean;
  vessels: VesselConfig[];
}

export type RiskStatusCategory = 'below_cutoff' | 'above_cutoff' | 'elevated' | 'no_data';

export interface VesselColorEvaluation {
  color: string;
  hex: string;
  label: string;
  status: RiskStatusCategory;
  t: number;
  tHigh: number;
  tRed: number;
}
