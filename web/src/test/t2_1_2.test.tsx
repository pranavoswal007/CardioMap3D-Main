import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as THREE from 'three';
import fs from 'fs';
import path from 'path';

import App from '../App';
import { evaluateVesselColor, COLOR_GREEN, COLOR_YELLOW, COLOR_ORANGE, COLOR_RED, COLOR_GRAY } from '../utils/vesselColors';
import { useAppStore } from '../store/useAppStore';

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

describe('T2-1.2: Attributions Panel Placement, Column Balance, and Order', () => {
  beforeEach(() => {
    useAppStore.getState().resetPatientInputs();
  });

  it('renders attributions panel after the viewer inside the left column wrapper and not inside the right column', async () => {
    render(<App />);

    const leftColumn = await screen.findByTestId('left-column');
    const rightColumn = await screen.findByTestId('right-column');
    const viewerWrapper = await screen.findByTestId('viewer-wrapper');
    const attributionsWrapper = await screen.findByTestId('attributions-wrapper');

    // Attributions must be inside left column
    expect(leftColumn.contains(attributionsWrapper)).toBe(true);
    expect(leftColumn.contains(viewerWrapper)).toBe(true);

    // Attributions must NOT be inside right column
    expect(rightColumn.contains(attributionsWrapper)).toBe(false);

    // Viewer comes before attributions in the left column DOM
    expect(
      viewerWrapper.compareDocumentPosition(attributionsWrapper) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('renders the attributions panel with a reserved min-height of about 320 px before prediction', async () => {
    render(<App />);

    const attributionsWrapper = await screen.findByTestId('attributions-wrapper');
    expect(attributionsWrapper.className).toContain('min-h-[320px]');
    expect(attributionsWrapper).toBeInTheDocument();
  });

  it('verifies the stacked (< 1024 px) order: viewer, results, territory map, what-if, attributions, patient form', async () => {
    render(<App />);

    const viewerWrapper = await screen.findByTestId('viewer-wrapper');
    const resultsWrapper = await screen.findByTestId('results-wrapper');
    const territoryWrapper = await screen.findByTestId('territory-map-wrapper');
    const whatIfWrapper = await screen.findByTestId('what-if-wrapper');
    const attributionsWrapper = await screen.findByTestId('attributions-wrapper');
    const patientFormWrapper = await screen.findByTestId('patient-form-wrapper');

    // Order 1: viewer
    expect(viewerWrapper.className).toContain('order-1');
    // Order 2: results
    expect(resultsWrapper.className).toContain('order-2');
    // Order 3: territory map
    expect(territoryWrapper.className).toContain('order-3');
    // Order 4: what-if
    expect(whatIfWrapper.className).toContain('order-4');
    // Order 5: attributions
    expect(attributionsWrapper.className).toContain('order-5');
    // Order 6: patient form
    expect(patientFormWrapper.className).toContain('order-6');
  });

  it('verifies desktop right column places Territory Map directly under results for same-frame visibility with 3D model', async () => {
    render(<App />);

    const resultsWrapper = await screen.findByTestId('results-wrapper');
    const territoryWrapper = await screen.findByTestId('territory-map-wrapper');
    const whatIfWrapper = await screen.findByTestId('what-if-wrapper');

    expect(resultsWrapper.className).toContain('lg:order-1');
    expect(territoryWrapper.className).toContain('lg:order-2');
    expect(whatIfWrapper.className).toContain('lg:order-3');
  });

  it('maintains the COLOR RULE invariants across all standard threshold conditions', () => {
    const t = 0.50;

    // 1. Below threshold (< t) -> Green
    const below = evaluateVesselColor({ probability: 0, threshold: t });
    expect(below.color).toBe(COLOR_GREEN);

    // 2. At threshold (= t) -> Yellow
    const atThresh = evaluateVesselColor({ probability: t, threshold: t });
    expect(atThresh.color).toBe(COLOR_YELLOW);

    // 3. At t + 0.15 -> Orange
    const atOrange = evaluateVesselColor({ probability: t + 0.15, threshold: t, highMargin: 0.15 });
    expect(atOrange.color).toBe(COLOR_ORANGE);

    // 4. At t + 0.35 -> Red
    const atRed = evaluateVesselColor({ probability: t + 0.35, threshold: t, highMargin: 0.15 });
    expect(atRed.color).toBe(COLOR_RED);

    // 5. Null or missing -> Gray
    const missing = evaluateVesselColor(null);
    expect(missing.color).toBe(COLOR_GRAY);
  });

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

  it('smoothly scrolls directly upwards towards 3D heart model when clicking Analyze Coronary Stenosis Risk', async () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    render(<App />);

    const analyzeBtn = await screen.findByRole('button', { name: /Analyze Coronary Stenosis Risk/i });
    fireEvent.click(analyzeBtn);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });
});
