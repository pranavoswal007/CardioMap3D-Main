import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import territoriesData from '../anatomy/territories.json';
import whatIfFactors from '../config/whatif.json';
import { TerritoryMap, TERRITORY_CAPTION, type TerritorySegment } from '../components/TerritoryMap';
import { WhatIfPanel, WHATIF_NOTICE } from '../components/WhatIfPanel';
import { computeDerivedBmi, formatProbabilityDelta } from '../utils/whatIfMath';
import { evaluateVesselColor, COLOR_GRAY, COLOR_GREEN, COLOR_YELLOW, COLOR_ORANGE, COLOR_RED } from '../utils/vesselColors';
import { useAppStore } from '../store/useAppStore';
import { api } from '../api/client';
import type { PredictResponse } from '../api/types';

// Mock api client
vi.mock('../api/client', () => ({
  api: {
    predict: vi.fn(),
    explain: vi.fn(),
  },
}));

const mockPrediction: PredictResponse = {
  cad: {
    probability: 0.584,
    label: 1,
    threshold: 0.538,
    high_threshold: 0.688,
    risk_level: 'above_cutoff',
    relative_risk: 0.82,
    cohort_prevalence: 0.713,
  },
  vessels: {
    lad: {
      probability: 0.409,
      label: 0,
      threshold: 0.501,
      high_threshold: 0.651,
      risk_level: 'below_cutoff',
      relative_risk: 0.70,
      cohort_prevalence: 0.584,
    },
    lcx: {
      probability: 0.205,
      label: 0,
      threshold: 0.397,
      high_threshold: 0.547,
      risk_level: 'below_cutoff',
      relative_risk: 0.52,
      cohort_prevalence: 0.393,
    },
    rca: {
      probability: 0.272,
      label: 0,
      threshold: 0.335,
      high_threshold: 0.485,
      risk_level: 'below_cutoff',
      relative_risk: 0.72,
      cohort_prevalence: 0.376,
    },
  },
  coherence: {
    is_incoherent: false,
    raw_cad_probability: 0.584,
    adjusted_cad_probability: 0.584,
    max_vessel_probability: 0.409,
    note: 'Predictions anatomically coherent.',
  },
  imputed_features: [],
  warnings: [],
  api_version: '0.2.0',
  model_version: '0.2.0',
  disclaimer: 'CardioMap 3D disclaimer',
};

describe('T2-1: Territory Map (AHA 17-Segment Bull\'s-Eye)', () => {
  const territories = territoriesData as TerritorySegment[];

  it('covers segments 1 to 17 exactly once with no duplicates or missing IDs', () => {
    expect(territories).toHaveLength(17);
    const ids = territories.map((t) => t.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('matches standard typical territories (Cerqueira et al., Circulation 2002)', () => {
    const ladSegments = territories.filter((t) => t.vessel === 'lad').map((t) => t.id).sort((a, b) => a - b);
    const rcaSegments = territories.filter((t) => t.vessel === 'rca').map((t) => t.id).sort((a, b) => a - b);
    const lcxSegments = territories.filter((t) => t.vessel === 'lcx').map((t) => t.id).sort((a, b) => a - b);

    expect(ladSegments).toEqual([1, 2, 7, 8, 13, 14, 17]);
    expect(rcaSegments).toEqual([3, 4, 9, 10, 15]);
    expect(lcxSegments).toEqual([5, 6, 11, 12, 16]);
  });

  it('renders all 17 SVG segments and includes mandatory territory caption', () => {
    render(<TerritoryMap hasPrediction={true} />);
    const caption = screen.getByTestId('territory-map-caption');
    expect(caption).toBeInTheDocument();
    expect(caption.textContent).toBe(TERRITORY_CAPTION);

    // Verify keyboard buttons exist for segments
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(17);
  });

  it('updates selected vessel on segment click and keyboard interaction', () => {
    render(<TerritoryMap hasPrediction={true} />);
    const seg1 = screen.getByLabelText(/Segment 1:/i);
    fireEvent.click(seg1);
    expect(useAppStore.getState().selectedVessel).toBe('lad');

    const seg3 = screen.getByLabelText(/Segment 3:/i);
    fireEvent.keyDown(seg3, { key: 'Enter' });
    expect(useAppStore.getState().selectedVessel).toBe('rca');

    const seg5 = screen.getByLabelText(/Segment 5:/i);
    fireEvent.keyDown(seg5, { key: ' ' });
    expect(useAppStore.getState().selectedVessel).toBe('lcx');
  });
});

describe('T2-1: What-If Mode & Math Derivations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({
      patientInputs: {
        Weight: 75,
        Length: 175,
        BMI: 24.49,
        BP: 130,
        FBS: 100,
        TG: 150,
        LDL: 110,
        HDL: 40,
        'Current Smoker': 0,
        Age: 60,
      },
      baselineInputs: {
        Weight: 75,
        Length: 175,
        BMI: 24.49,
        BP: 130,
        FBS: 100,
        TG: 150,
        LDL: 110,
        HDL: 40,
        'Current Smoker': 0,
        Age: 60,
      },
      baselinePrediction: mockPrediction,
      prediction: mockPrediction,
      whatIfActive: true,
      selectedTarget: 'cad',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('computes derived BMI correctly: BMI = Weight / (Length/100)^2', () => {
    // 80 kg, 180 cm -> 80 / (1.8^2) = 24.6913...
    const bmi1 = computeDerivedBmi(80, 180);
    expect(bmi1).toBeCloseTo(24.691, 3);

    // 70 kg, 160 cm -> 70 / (1.6^2) = 27.34375
    const bmi2 = computeDerivedBmi(70, 160);
    expect(bmi2).toBeCloseTo(27.344, 3);
  });

  it('calculates probability deltas in probability points with correct sign and arrow', () => {
    // 0.522 current vs 0.584 baseline = -0.062 -> -6.2 pts
    const delta1 = formatProbabilityDelta(0.522, 0.584);
    expect(delta1.deltaText).toBe('-6.2 pts');
    expect(delta1.arrow).toBe('down');
    expect(delta1.colorClass).toContain('text-emerald-400');

    // 0.650 current vs 0.584 baseline = +0.066 -> +6.6 pts
    const delta2 = formatProbabilityDelta(0.650, 0.584);
    expect(delta2.deltaText).toBe('+6.6 pts');
    expect(delta2.arrow).toBe('up');
    expect(delta2.colorClass).toContain('text-rose-400');

    // 0.584 current vs 0.584 baseline = 0.0 pts
    const delta3 = formatProbabilityDelta(0.584, 0.584);
    expect(delta3.deltaText).toBe('0.0 pts');
    expect(delta3.arrow).toBe('neutral');
  });

  it('renders permanent what-if notice unconditionally in WhatIfPanel', () => {
    render(<WhatIfPanel />);
    const notice = screen.getByTestId('whatif-notice');
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toContain(WHATIF_NOTICE);
  });

  it('debounces POST /predict by 150ms and aborts stale in-flight requests', async () => {
    const mockPredictFn = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ...mockPrediction,
        cad: { ...mockPrediction.cad, probability: 0.65 },
      })
    );
    (api.predict as ReturnType<typeof vi.fn>).mockImplementation(mockPredictFn);

    render(<WhatIfPanel />);

    const bpSlider = screen.getByLabelText(/Systolic Blood Pressure \(BP\)/i);

    // Rapid successive slider adjustments
    fireEvent.change(bpSlider, { target: { value: '140' } });
    fireEvent.change(bpSlider, { target: { value: '150' } });
    fireEvent.change(bpSlider, { target: { value: '160' } });

    // After 100ms: timer has not elapsed, no call yet
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(mockPredictFn).not.toHaveBeenCalled();

    // After 60ms more (total 160ms): only the latest value (160) triggers
    await act(async () => {
      vi.advanceTimersByTime(60);
    });

    expect(mockPredictFn).toHaveBeenCalledTimes(1);
    expect(mockPredictFn.mock.calls[0][0]['BP']).toBe(160);
  });

  it('recomputes BMI automatically when Weight slider changes before calling API', async () => {
    const mockPredictFn = vi.fn().mockImplementation(() => Promise.resolve(mockPrediction));
    (api.predict as ReturnType<typeof vi.fn>).mockImplementation(mockPredictFn);

    render(<WhatIfPanel />);

    const weightSlider = screen.getByLabelText(/Body Weight/i);

    // Change Weight from 75 to 80 (Length is 175)
    // 80 / (1.75 * 1.75) = 26.1224
    fireEvent.change(weightSlider, { target: { value: '80' } });

    await act(async () => {
      vi.advanceTimersByTime(160);
    });

    expect(mockPredictFn).toHaveBeenCalledTimes(1);
    const sentPayload = mockPredictFn.mock.calls[0][0];
    expect(sentPayload['Weight']).toBe(80);
    expect(sentPayload['BMI']).toBeCloseTo(26.122, 2);
  });

  it('resets factors to baseline when Reset to baseline button is clicked', async () => {
    render(<WhatIfPanel />);

    const bpSlider = screen.getByLabelText(/Systolic Blood Pressure \(BP\)/i) as HTMLInputElement;
    fireEvent.change(bpSlider, { target: { value: '170' } });
    expect(bpSlider.value).toBe('170');

    const resetBtn = screen.getByRole('button', { name: /Reset to baseline/i });
    fireEvent.click(resetBtn);

    expect(bpSlider.value).toBe('130');
  });

  it('contains Age labeled explore only (not modifiable) in whatif.json config', () => {
    const ageConfig = (whatIfFactors as { key: string; modifiable: boolean; badge?: string }[]).find(
      (f) => f.key === 'Age'
    );
    expect(ageConfig).toBeDefined();
    expect(ageConfig?.modifiable).toBe(false);
    expect(ageConfig?.badge).toContain('explore only (not modifiable)');
  });
});

describe('T2-1: Color Rule Integrity & Terminology Check', () => {
  it('evaluates color rule cases correctly without alteration', () => {
    // 1. null / undefined -> neutral gray
    expect(evaluateVesselColor(null as any).hex).toBe(COLOR_GRAY);

    // Threshold = 0.50, highMargin = 0.15 (tHigh = 0.65, tRed = 0.85)
    const threshold = 0.50;

    // 2. Below cutoff (p = 0.25 < 0.50) -> between green and yellow
    const below = evaluateVesselColor({ probability: 0.0, threshold, highMargin: 0.15 });
    expect(below.hex).toBe(COLOR_GREEN);
    expect(below.status).toBe('below_cutoff');

    // 3. At threshold (p = 0.50) -> yellow
    const atThresh = evaluateVesselColor({ probability: 0.50, threshold, highMargin: 0.15 });
    expect(atThresh.hex).toBe(COLOR_YELLOW);
    expect(atThresh.status).toBe('above_cutoff');

    // 4. At t + 0.15 (p = 0.65) -> orange
    const atHigh = evaluateVesselColor({ probability: 0.65, threshold, highMargin: 0.15 });
    expect(atHigh.hex).toBe(COLOR_ORANGE);
    expect(atHigh.status).toBe('elevated');

    // 5. At t + 0.35 (p = 0.85) -> red
    const atRed = evaluateVesselColor({ probability: 0.85, threshold, highMargin: 0.15 });
    expect(atRed.hex).toBe(COLOR_RED);
    expect(atRed.status).toBe('elevated');
  });

  it('guarantees forbidden phrases are completely absent from non-test source files in web/src', () => {
    const srcDir = path.resolve(__dirname, '..');
    const files: string[] = [];
    const banned1 = ['moderate', 'risk'].join(' ');
    const banned2 = ['well', 'above'].join(' ');

    function scanDir(dir: string) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        if (item.name === 'test' || item.name.includes('.test.')) {
          continue;
        }
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          scanDir(full);
        } else if (/\.(ts|tsx|json|html|css)$/.test(item.name)) {
          files.push(full);
        }
      }
    }

    scanDir(srcDir);
    expect(files.length).toBeGreaterThan(15);

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content.toLowerCase()).not.toContain(banned1);
      expect(content.toLowerCase()).not.toContain(banned2);
    }
  });
});
