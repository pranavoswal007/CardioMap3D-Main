import { useState } from 'react';
import type { VesselId, VesselData } from '../types/viewer';
import { HeartViewer } from './HeartViewer';

export function HeartCanvas() {
  const [selectedVessel, setSelectedVessel] = useState<VesselId | null>(null);

  // Neutral unpredicted state - Phase 4 will wire live API responses
  const [vessels] = useState<Record<VesselId, VesselData>>({
    lad: null,
    lcx: null,
    rca: null,
  });

  return (
    <HeartViewer
      vessels={vessels}
      selectedVessel={selectedVessel}
      onSelectVessel={setSelectedVessel}
    />
  );
}

export default HeartCanvas;
