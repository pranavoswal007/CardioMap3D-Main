import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';

import { HeartViewer } from '../components/HeartViewer';
import { TerritoryMap, TERRITORY_CAPTION } from '../components/TerritoryMap';
import { PatientForm } from '../components/PatientForm';
import { formatNumericDefault } from '../utils/formatters';
import { getEffectiveTubeRadius, DEFAULT_MODEL_SIZE, MAX_CONFIGURED_TUBE_RADIUS } from '../utils/taperedTube';
import { evaluateVesselColor, COLOR_GREEN, COLOR_YELLOW, COLOR_ORANGE, COLOR_RED, COLOR_GRAY } from '../utils/vesselColors';
import { useAppStore } from '../store/useAppStore';
import { PREDICT_FIXTURE } from '../__fixtures__';
import App from '../App';

// Mock WebGL and Three.js canvas in JSDOM
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-canvas">{children}</div>
  ),
  useFrame: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  ContactShadows: () => null,
  Bounds: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-bounds">{children}</div>
  ),
  useBounds: () => ({
    refresh: () => ({
      fit: () => {},
    }),
  }),
  useGLTF: () => ({ scene: new THREE.Group() }),
}));

// Mock api client for App integration testing
vi.mock('../api/client', () => ({
  api: {
    getHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
    getSchema: vi.fn().mockResolvedValue({ feature_schema: {} }),
    getSamplePatients: vi.fn().mockResolvedValue([]),
    predict: vi.fn().mockResolvedValue({
      cad: { probability: 0.85, label: 1, risk_level: 'high', cohort_prevalence: 0.71, relative_risk: 1.2, threshold: 0.53, high_threshold: 0.68 },
      vessels: {
        lad: { probability: 0.65, label: 1, risk_level: 'above_cutoff', cohort_prevalence: 0.58, relative_risk: 1.1, threshold: 0.50, high_threshold: 0.65 },
        lcx: { probability: 0.25, label: 0, risk_level: 'below_cutoff', cohort_prevalence: 0.39, relative_risk: 0.6, threshold: 0.39, high_threshold: 0.54 },
        rca: { probability: 0.18, label: 0, risk_level: 'below_cutoff', cohort_prevalence: 0.37, relative_risk: 0.5, threshold: 0.33, high_threshold: 0.48 },
      },
      coherence: { is_incoherent: false },
      imputed_features: [],
      warnings: [],
      api_version: '0.2.0',
      model_version: '0.2.0',
      disclaimer: 'disclaimer',
    }),
    explain: vi.fn().mockResolvedValue({}),
  },
  ApiClientError: class ApiClientError extends Error {},
}));

describe('T2-1.1: Viewer Layout, Polish, and Architecture Verifications', () => {
  beforeEach(() => {
    useAppStore.getState().resetPatientInputs();
  });

  // 1. X-Ray default OFF in HeartViewer
  it('initializes with X-Ray OFF (opaque, vertex-colored mode by default)', () => {
    render(
      <HeartViewer
        vessels={{ lad: null, lcx: null, rca: null }}
        selectedVessel={null}
        onSelectVessel={() => {}}
      />
    );

    const xrayBtn = screen.getByRole('button', { name: /Toggle X-ray semi-transparent view/i });
    expect(xrayBtn).toBeInTheDocument();
    expect(xrayBtn.textContent).toContain('X-Ray View');
    expect(xrayBtn.textContent).not.toContain('X-Ray Active');

    // Clicking toggles X-Ray Active
    fireEvent.click(xrayBtn);
    expect(xrayBtn.textContent).toContain('X-Ray Active');
  });

  // 2. TerritoryMap rendered in the results column and not inside the viewer card
  it('renders TerritoryMap in the results column and never inside the viewer card', async () => {
    render(<App />);
    const heroViewer = await screen.findByTestId('hero-viewer-card');
    const territoryMap = await screen.findByTestId('territory-map-container');

    expect(heroViewer).toBeInTheDocument();
    expect(territoryMap).toBeInTheDocument();

    // Verify territory map is NOT a descendant of the hero viewer card
    expect(heroViewer.contains(territoryMap)).toBe(false);
  });

  // 3. Caption present when expanded, collapsible behavior
  it('shows territory caption when expanded, and hides when collapsed', () => {
    // Initial state without prediction: collapsed
    render(<TerritoryMap hasPrediction={false} />);
    expect(screen.queryByTestId('territory-map-caption')).not.toBeInTheDocument();

    // Expand
    const toggleBtn = screen.getByRole('button', { name: /Coronary territory map \(AHA 17-segment\)/i });
    fireEvent.click(toggleBtn);

    const caption = screen.getByTestId('territory-map-caption');
    expect(caption).toBeInTheDocument();
    expect(caption.textContent).toBe(TERRITORY_CAPTION);

    // Auto-expanded when prediction is present
    render(<TerritoryMap hasPrediction={true} />);
    const activeCaption = screen.getAllByTestId('territory-map-caption')[0];
    expect(activeCaption).toBeInTheDocument();
    expect(activeCaption.textContent).toBe(TERRITORY_CAPTION);
  });

  // 4. Compact credit line visible and Credits expander shows ATTRIBUTION.txt text exactly
  it('displays compact credit line and shows exact trimmed ATTRIBUTION.txt in expander', () => {
    render(
      <HeartViewer
        vessels={{ lad: null, lcx: null, rca: null }}
        selectedVessel={null}
        onSelectVessel={() => {}}
      />
    );

    // Compact credit line always visible in bottom strip
    expect(
      screen.getByText('Heart model: Hannah Newey, University of Dundee (CC BY-NC-SA 4.0)')
    ).toBeInTheDocument();

    // Open Credits expander
    const creditsBtn = screen.getByRole('button', { name: 'Credits' });
    fireEvent.click(creditsBtn);

    const creditsTextEl = screen.getByTestId('viewer-credits-text');
    expect(creditsTextEl).toBeInTheDocument();

    const attributionFilePath = path.resolve(__dirname, '../../public/models/ATTRIBUTION.txt');
    const rawAttribution = fs.readFileSync(attributionFilePath, 'utf8').trim();

    expect(creditsTextEl.textContent?.trim()).toBe(rawAttribution);
  });

  // 5. Tube radius clamp and traced=false thin-radius behavior
  it('enforces thin radius (<= 0.6% model size) when untraced, and clamps to configured max when traced', () => {
    const rawRadius = 0.055;

    // When traced: false -> radius clamped to at most 0.6% of model size
    const untracedEffective = getEffectiveTubeRadius(rawRadius, false, DEFAULT_MODEL_SIZE);
    const maxAllowedUntraced = DEFAULT_MODEL_SIZE * 0.006; // 0.0144
    expect(untracedEffective).toBeLessThanOrEqual(maxAllowedUntraced);
    expect(untracedEffective).toBeCloseTo(0.0144, 4);

    // When traced: true -> clamped to configured max (0.04)
    const tracedEffective = getEffectiveTubeRadius(rawRadius, true, DEFAULT_MODEL_SIZE);
    expect(tracedEffective).toBe(MAX_CONFIGURED_TUBE_RADIUS);
    expect(tracedEffective).toBe(0.04);

    // When authored radius is naturally smaller than both clamps (e.g. 0.01)
    const smallRadius = 0.01;
    expect(getEffectiveTubeRadius(smallRadius, false, DEFAULT_MODEL_SIZE)).toBe(smallRadius);
    expect(getEffectiveTubeRadius(smallRadius, true, DEFAULT_MODEL_SIZE)).toBe(smallRadius);
  });

  // 6. Form collapses after prediction and preserves values
  it('collapses patient form into summary after prediction and preserves inputs upon editing', () => {
    useAppStore.setState({
      schemaData: {
        feature_schema: {
          Age: { name: 'Age', display_label: 'Age', type: 'numeric', unit: 'years', group: 'demographics', min: 30, max: 90, default: 58 },
          BP: { name: 'BP', display_label: 'Systolic Blood Pressure (BP)', type: 'numeric', unit: 'mmHg', group: 'vitals', min: 80, max: 200, default: 120 },
        },
      } as any,
      patientInputs: {
        Age: 62,
        BP: 145,
        Weight: 82,
        Length: 172,
      },
    });

    const { rerender } = render(<PatientForm />);

    // Before prediction: full form is expanded
    expect(screen.getByRole('button', { name: /Analyze Coronary Stenosis Risk/i })).toBeInTheDocument();
    expect(screen.queryByTestId('patient-form-collapsed')).not.toBeInTheDocument();

    // After prediction arrives: form collapses
    useAppStore.setState({ prediction: PREDICT_FIXTURE });
    rerender(<PatientForm />);

    expect(screen.getByTestId('patient-form-collapsed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit inputs/i })).toBeInTheDocument();

    // Click "Edit inputs" to expand
    fireEvent.click(screen.getByRole('button', { name: /Edit inputs/i }));

    // Values are preserved in expanded form
    const ageInput = screen.getByLabelText(/Age/i) as HTMLInputElement;
    expect(ageInput.value).toBe('62');

    const bpInput = screen.getByLabelText(/Systolic Blood Pressure/i) as HTMLInputElement;
    expect(bpInput.value).toBe('145');
  });

  // 7. BMI default formatting (at most 1 decimal)
  it('formats numeric defaults and placeholders to at most 1 decimal place', () => {
    // 26.775510204081634 -> 26.8
    expect(formatNumericDefault(26.775510204081634)).toBe('26.8');
    expect(formatNumericDefault(120)).toBe('120');
    expect(formatNumericDefault(72.5)).toBe('72.5');
    expect(formatNumericDefault(null)).toBe('');
  });

  // 8. Forbidden strings absent from web/src
  it('confirms forbidden clinical phrases are completely absent from web/src source files', () => {
    const srcDir = path.resolve(__dirname, '..');
    const forbidden1 = ['moderate', 'risk'].join(' ');
    const forbidden2 = ['well', 'above'].join(' ');

    function scanDir(dir: string): string[] {
      let results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'test') {
            results = results.concat(scanDir(fullPath));
          }
        } else if (/\.(tsx?|css|html|json)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
          if (content.includes(forbidden1) || content.includes(forbidden2)) {
            results.push(fullPath);
          }
        }
      }
      return results;
    }

    const matches = scanDir(srcDir);
    expect(matches).toEqual([]);
  });

  // 9. Color rule cases unchanged (below t, at t, t+0.15, t+0.35, null)
  it('preserves strict canonical color rule cases without modification', () => {
    const t = 0.50;

    // 1. Null data -> neutral gray
    const nullEval = evaluateVesselColor(null);
    expect(nullEval.color).toBe(COLOR_GRAY);
    expect(nullEval.status).toBe('no_data');

    // 2. p = 0 -> green
    const minEval = evaluateVesselColor({ probability: 0, threshold: t });
    expect(minEval.color).toBe(COLOR_GREEN);

    // 3. p at threshold (t) -> yellow
    const atTEval = evaluateVesselColor({ probability: t, threshold: t });
    expect(atTEval.color).toBe(COLOR_YELLOW);

    // 4. p at high threshold (t + 0.15) -> orange
    const atHighEval = evaluateVesselColor({ probability: t + 0.15, threshold: t, highMargin: 0.15 });
    expect(atHighEval.color).toBe(COLOR_ORANGE);

    // 5. p at full red boundary (t + 0.35) -> red
    const atRedEval = evaluateVesselColor({ probability: t + 0.35, threshold: t, highMargin: 0.15 });
    expect(atRedEval.color).toBe(COLOR_RED);
  });
});
