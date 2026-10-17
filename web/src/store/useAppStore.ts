import { create } from 'zustand';
import type {
  PredictResponse,
  ExplainResponse,
  SchemaResponse,
  MetricsResponse,
  SamplePatient,
  TargetCode,
} from '../api/types';
import type { VesselId } from '../types/viewer';

export interface AppState {
  // Navigation
  activeTab: 'patient' | 'validation' | 'about';
  setActiveTab: (tab: 'patient' | 'validation' | 'about') => void;

  // Schema & Reference Data
  schemaData: SchemaResponse | null;
  setSchemaData: (data: SchemaResponse | null) => void;
  samplePatients: SamplePatient[];
  setSamplePatients: (patients: SamplePatient[]) => void;
  metricsData: MetricsResponse | null;
  setMetricsData: (metrics: MetricsResponse | null) => void;

  // Form Inputs
  patientInputs: Record<string, number | string>;
  setPatientInput: (key: string, value: number | string) => void;
  setPatientInputs: (inputs: Record<string, number | string>) => void;
  resetPatientInputs: () => void;

  // Prediction State
  predictLoading: boolean;
  setPredictLoading: (loading: boolean) => void;
  predictError: string | null;
  setPredictError: (err: string | null) => void;
  prediction: PredictResponse | null;
  setPrediction: (pred: PredictResponse | null) => void;

  // Sequential Explanations State
  explanations: Record<TargetCode, ExplainResponse | null>;
  setExplanation: (target: TargetCode, exp: ExplainResponse | null) => void;
  explainLoading: Record<TargetCode, boolean>;
  setExplainLoading: (target: TargetCode, loading: boolean) => void;
  explainError: Record<TargetCode, string | null>;
  setExplainError: (target: TargetCode, err: string | null) => void;
  clearExplanations: () => void;

  // 3D Viewer & Selection Synchronization
  selectedVessel: VesselId | null;
  setSelectedVessel: (vessel: VesselId | null) => void;
  selectedTarget: TargetCode;
  setSelectedTarget: (target: TargetCode) => void;

  // What-If Mode
  whatIfActive: boolean;
  setWhatIfActive: (active: boolean) => void;
  baselineInputs: Record<string, number | string> | null;
  setBaselineInputs: (inputs: Record<string, number | string> | null) => void;
  baselinePrediction: PredictResponse | null;
  setBaselinePrediction: (pred: PredictResponse | null) => void;

  // Heartbeat Animation
  animateHeartbeat: boolean;
  setAnimateHeartbeat: (animate: boolean) => void;

  // In-flight request controllers
  predictAbortController: AbortController | null;
  setPredictAbortController: (c: AbortController | null) => void;
  explainAbortControllers: Record<TargetCode, AbortController | null>;
  setExplainAbortController: (target: TargetCode, c: AbortController | null) => void;
  cancelAllInFlight: () => void;
}

const initialExplanations: Record<TargetCode, ExplainResponse | null> = {
  cad: null,
  lad: null,
  lcx: null,
  rca: null,
};

const initialExplainLoading: Record<TargetCode, boolean> = {
  cad: false,
  lad: false,
  lcx: false,
  rca: false,
};

const initialExplainError: Record<TargetCode, string | null> = {
  cad: null,
  lad: null,
  lcx: null,
  rca: null,
};

const initialExplainControllers: Record<TargetCode, AbortController | null> = {
  cad: null,
  lad: null,
  lcx: null,
  rca: null,
};

export const useAppStore = create<AppState>((set, get) => ({
  activeTab: 'patient',
  setActiveTab: (activeTab) => set({ activeTab }),

  schemaData: null,
  setSchemaData: (schemaData) => set({ schemaData }),
  samplePatients: [],
  setSamplePatients: (samplePatients) => set({ samplePatients }),
  metricsData: null,
  setMetricsData: (metricsData) => set({ metricsData }),

  patientInputs: {},
  setPatientInput: (key, value) => {
    // When inputs change, cancel in-flight requests per contract
    get().cancelAllInFlight();
    set((state) => ({
      patientInputs: { ...state.patientInputs, [key]: value },
    }));
  },
  setPatientInputs: (patientInputs) => {
    get().cancelAllInFlight();
    set({ patientInputs });
  },
  resetPatientInputs: () => {
    get().cancelAllInFlight();
    set({
      patientInputs: {},
      prediction: null,
      predictError: null,
      explanations: { ...initialExplanations },
      explainLoading: { ...initialExplainLoading },
      explainError: { ...initialExplainError },
      selectedVessel: null,
      selectedTarget: 'cad',
      whatIfActive: false,
      baselineInputs: null,
      baselinePrediction: null,
    });
  },

  predictLoading: false,
  setPredictLoading: (predictLoading) => set({ predictLoading }),
  predictError: null,
  setPredictError: (predictError) => set({ predictError }),
  prediction: null,
  setPrediction: (prediction) => set({ prediction }),

  explanations: { ...initialExplanations },
  setExplanation: (target, exp) =>
    set((state) => ({
      explanations: { ...state.explanations, [target]: exp },
    })),
  explainLoading: { ...initialExplainLoading },
  setExplainLoading: (target, loading) =>
    set((state) => ({
      explainLoading: { ...state.explainLoading, [target]: loading },
    })),
  explainError: { ...initialExplainError },
  setExplainError: (target, err) =>
    set((state) => ({
      explainError: { ...state.explainError, [target]: err },
    })),
  clearExplanations: () =>
    set({
      explanations: { ...initialExplanations },
      explainLoading: { ...initialExplainLoading },
      explainError: { ...initialExplainError },
    }),

  selectedVessel: null,
  setSelectedVessel: (vessel) => {
    set({
      selectedVessel: vessel,
      selectedTarget: vessel ?? 'cad',
    });
  },
  selectedTarget: 'cad',
  setSelectedTarget: (target) => {
    set({
      selectedTarget: target,
      selectedVessel: target === 'cad' ? null : target,
    });
  },

  whatIfActive: false,
  setWhatIfActive: (whatIfActive) => {
    const { prediction, patientInputs, baselinePrediction } = get();
    if (whatIfActive && !baselinePrediction && prediction) {
      set({
        baselineInputs: { ...patientInputs },
        baselinePrediction: prediction,
        whatIfActive,
      });
    } else {
      set({ whatIfActive });
    }
  },
  baselineInputs: null,
  setBaselineInputs: (baselineInputs) => set({ baselineInputs }),
  baselinePrediction: null,
  setBaselinePrediction: (baselinePrediction) => set({ baselinePrediction }),

  animateHeartbeat: true,
  setAnimateHeartbeat: (animateHeartbeat) => set({ animateHeartbeat }),

  predictAbortController: null,
  setPredictAbortController: (c) => set({ predictAbortController: c }),
  explainAbortControllers: { ...initialExplainControllers },
  setExplainAbortController: (target, c) =>
    set((state) => ({
      explainAbortControllers: { ...state.explainAbortControllers, [target]: c },
    })),

  cancelAllInFlight: () => {
    const { predictAbortController, explainAbortControllers } = get();
    if (predictAbortController) {
      predictAbortController.abort();
    }
    Object.values(explainAbortControllers).forEach((c) => {
      if (c) c.abort();
    });
    set({
      predictAbortController: null,
      explainAbortControllers: { ...initialExplainControllers },
      predictLoading: false,
      explainLoading: { ...initialExplainLoading },
    });
  },
}));
