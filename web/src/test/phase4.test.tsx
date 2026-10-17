import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

import { getDisplayRiskLabel, getTierBandLabel, formatHonestyComparisonText } from '../utils/riskLabels';
import { evaluateVesselColor } from '../utils/vesselColors';
import { CANONICAL_DISCLAIMER } from '../constants/disclaimer';
import { DisclaimerBanner } from '../components/DisclaimerBanner';
import { ProbabilityBar, TargetCard, ResultCards } from '../components/ResultCards';
import { PatientForm } from '../components/PatientForm';
import { AboutTab } from '../components/AboutTab';
import { ExplanationPanel } from '../components/ExplanationPanel';
import { runPredictionFlow } from '../services/predictionFlow';
import { api } from '../api/client';
import { useAppStore } from '../store/useAppStore';

import {
  SCHEMA_FIXTURE,
  PREDICT_FIXTURE,
  PREDICT_INCOHERENT_FIXTURE,
  EXPLAIN_FIXTURE,
  BOOTSTRAP_FIXTURES,
} from '../__fixtures__';

describe('Phase 4 / 4.1: Web Integration Test Suite', () => {
  beforeEach(() => {
    useAppStore.getState().resetPatientInputs();
  });

  // 1. Label mapping
  it('correctly maps API risk levels to clinical screening labels and tier bands', () => {
    expect(getDisplayRiskLabel('low')).toBe('below screening cutoff');
    expect(getDisplayRiskLabel('moderate')).toBe('above screening cutoff');
    expect(getDisplayRiskLabel('high')).toBe('above screening cutoff');
    expect(getDisplayRiskLabel(null)).toBe('below screening cutoff');
    expect(getDisplayRiskLabel(undefined)).toBe('below screening cutoff');

    expect(getTierBandLabel('high')).toBe('upper band');
    expect(getTierBandLabel('moderate')).toBe(null);
    expect(getTierBandLabel('low')).toBe(null);
    expect(getTierBandLabel(null)).toBe(null);
  });

  // 2. Forbidden phrases absent from src and rendered card outputs
  it('ensures forbidden phrases are absent from src files', () => {
    const srcDir = path.resolve(__dirname, '..');
    const forbidden1 = ['moderate', 'risk'].join(' ');
    const forbidden2 = ['well', 'above'].join(' ');

    function scanDir(dir: string): string[] {
      let results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(scanDir(fullPath));
        } else if (/\.(tsx?|css|html|json)$/.test(entry.name) && entry.name !== 'phase4.test.tsx') {
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

  it('ensures forbidden phrases are absent from rendered output across all card states', () => {
    const forbidden1 = ['moderate', 'risk'].join(' ');
    const forbidden2 = ['well', 'above'].join(' ');
    const testCases: ('low' | 'moderate' | 'high')[] = ['low', 'moderate', 'high'];

    for (const level of testCases) {
      const pred = {
        probability: 0.65,
        label: 1,
        risk_level: level,
        cohort_prevalence: 0.58,
        relative_risk: 1.12,
        threshold: 0.50,
        high_threshold: 0.65,
      };

      const { container, unmount } = render(
        <TargetCard
          id="cad"
          title="CAD"
          subtitle="Overall"
          prediction={pred}
          isSelected={false}
          onSelect={() => {}}
        />
      );

      const text = container.textContent?.toLowerCase() || '';
      expect(text.includes(forbidden1)).toBe(false);
      expect(text.includes(forbidden2)).toBe(false);
      unmount();
    }
  });

  // 3. Tick marks placed from API values
  it('places probability bar tick marks according to API values', () => {
    render(<ProbabilityBar probability={0.8591} threshold={0.5377} highThreshold={0.6877} />);

    const threshTick = screen.getByTestId('threshold-tick');
    const highThreshTick = screen.getByTestId('high-threshold-tick');
    const fill = screen.getByTestId('probability-fill');

    expect(threshTick).toHaveStyle({ left: '53.8%' });
    expect(highThreshTick).toHaveStyle({ left: '68.8%' });
    expect(fill).toHaveStyle({ width: '85.9%' });
  });

  // 4. Form generated dynamically from schema fixture
  it('generates patient input form inputs from schema fixture', () => {
    useAppStore.getState().setSchemaData(SCHEMA_FIXTURE);
    render(<PatientForm />);

    expect(screen.getByLabelText(/Age/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Sex/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Diabetes Mellitus/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Regional Wall Motion/)).toBeInTheDocument();
  });

  // 5. Abort cancels in-flight explain calls on form change or cancel
  it('cancels in-flight requests when abort controllers are triggered', () => {
    const c1 = new AbortController();
    const c2 = new AbortController();

    useAppStore.getState().setPredictAbortController(c1);
    useAppStore.getState().setExplainAbortController('cad', c2);

    expect(c1.signal.aborted).toBe(false);
    expect(c2.signal.aborted).toBe(false);

    // Changing patient inputs cancels all in flight per contract
    useAppStore.getState().setPatientInput('Age', 65);

    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(true);
  });

  // 6. Coherence banner appears and disappears with UI-owned headline
  it('shows coherence notice only when API flags inconsistency', () => {
    // 1. Coherent prediction -> No banner
    act(() => {
      useAppStore.getState().setPrediction(PREDICT_FIXTURE);
    });
    const { rerender } = render(<ResultCards />);
    expect(screen.queryByText(/Model consistency notice/i)).not.toBeInTheDocument();

    // 2. Incoherent prediction -> UI-owned headline banner renders
    act(() => {
      useAppStore.getState().setPrediction(PREDICT_INCOHERENT_FIXTURE);
    });
    rerender(<ResultCards />);
    expect(screen.getByText(/Model consistency notice: at least one vessel probability is higher/i)).toBeInTheDocument();
  });

  // 7. Disclaimer equality with api/openapi.json
  it('asserts canonical disclaimer equals openapi.json info.description', () => {
    const openApiPath = path.resolve(__dirname, '../../../api/openapi.json');
    const openApiRaw = fs.readFileSync(openApiPath, 'utf8');
    const openApiJson = JSON.parse(openApiRaw);

    expect(CANONICAL_DISCLAIMER).toBe(openApiJson.info.description);

    render(<DisclaimerBanner />);
    const banner = screen.getByTestId('canonical-disclaimer');
    expect(banner.textContent).toContain(openApiJson.info.description);
  });

  // 8. Honesty text per target from bootstrap fixture
  it('evaluates paired bootstrap honesty text accurately without claiming outperforms when CI includes 0', () => {
    // CAD: includes 0
    const cadText = formatHonestyComparisonText(BOOTSTRAP_FIXTURES.y_cad);
    expect(cadText).toBe('not significantly different');
    expect(cadText.toLowerCase()).not.toContain('outperforms');

    // LAD: excludes 0, delta > 0
    const ladText = formatHonestyComparisonText(BOOTSTRAP_FIXTURES.y_lad);
    expect(ladText).toBe('statistically better');

    // LCX: includes 0, baseline >= deployed
    const lcxText = formatHonestyComparisonText(BOOTSTRAP_FIXTURES.y_lcx);
    expect(lcxText).toBe('not significantly different (baseline matched or exceeded)');
    expect(lcxText.toLowerCase()).not.toContain('outperforms');

    // RCA: includes 0, baseline >= deployed
    const rcaText = formatHonestyComparisonText(BOOTSTRAP_FIXTURES.y_rca);
    expect(rcaText).toBe('not significantly different (baseline matched or exceeded)');
    expect(rcaText.toLowerCase()).not.toContain('outperforms');

    // Missing paired comparison -> neutral wording
    const missingText = formatHonestyComparisonText(null);
    expect(missingText).toBe('higher point estimate; confidence intervals overlap');
  });

  // 9. App code never imports fixtures
  it('guarantees application source code never imports __fixtures__', () => {
    const srcDir = path.resolve(__dirname, '..');
    const appFiles: string[] = [];

    function findAppFiles(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__fixtures__' && entry.name !== 'test') {
            findAppFiles(fullPath);
          }
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          appFiles.push(fullPath);
        }
      }
    }

    findAppFiles(srcDir);
    expect(appFiles.length).toBeGreaterThan(0);

    for (const file of appFiles) {
      const code = fs.readFileSync(file, 'utf8');
      expect(code).not.toMatch(/from\s+['"][^'"]*__fixtures__[^'"]*['"]/);
    }
  });

  // 10. RWMA fields have no territory text
  it('confirms Region RWMA input has no anatomical territory text', () => {
    useAppStore.getState().setSchemaData(SCHEMA_FIXTURE);
    render(<PatientForm />);

    const label = screen.getByLabelText(/Regional Wall Motion/);
    expect(label).toBeInTheDocument();

    const containerText = label.parentElement?.textContent?.toLowerCase() || '';
    const territoryWords = ['anterior', 'inferior', 'lateral', 'septal', 'apex', 'territory'];
    for (const word of territoryWords) {
      expect(containerText).not.toContain(word);
    }
  });

  // 11. Explain calls run in order cad, lad, lcx, rca
  it('runs explain calls sequentially in order cad, lad, lcx, rca', async () => {
    const explainCalls: string[][] = [];
    const origPredict = api.predict;
    const origExplain = api.explain;

    api.predict = vi.fn().mockResolvedValue(PREDICT_FIXTURE);
    api.explain = vi.fn().mockImplementation((_patient, targets) => {
      explainCalls.push(targets || []);
      return Promise.resolve(EXPLAIN_FIXTURE);
    });

    try {
      await runPredictionFlow();
      expect(explainCalls).toEqual([['cad'], ['lad'], ['lcx'], ['rca']]);

      // When specific targets provided:
      explainCalls.length = 0;
      await runPredictionFlow(['lad', 'rca']);
      expect(explainCalls).toEqual([['lad'], ['rca']]);
    } finally {
      api.predict = origPredict;
      api.explain = origExplain;
    }
  });

  // 12. Physiology table hidden when physiology is null
  it('hides physiology table when physiology is null', () => {
    const noPhysFixture = {
      ...EXPLAIN_FIXTURE,
      physiology: null,
    };
    useAppStore.getState().setExplanation('cad', noPhysFixture);
    render(<ExplanationPanel />);

    expect(screen.queryByText(/Physiological Category Breakdown/i)).not.toBeInTheDocument();
  });

  // 13. About tab renders ATTRIBUTION.txt exactly (trimmed equality)
  it('renders ATTRIBUTION.txt with exact trimmed equality in About tab', () => {
    const attributionFilePath = path.resolve(__dirname, '../../public/models/ATTRIBUTION.txt');
    const expectedContent = fs.readFileSync(attributionFilePath, 'utf8').trim();

    render(<AboutTab />);
    const renderedAttr = screen.getByTestId('heart-attribution-text');
    expect(renderedAttr.textContent?.trim()).toBe(expectedContent);
  });

  // 14. vesselColors cases unchanged (below t, at t, t+0.15, t+0.35, null)
  it('evaluates vessel colors correctly across all clinical cutoff cases', () => {
    // null
    const resNull = evaluateVesselColor(null);
    expect(resNull.status).toBe('no_data');
    expect(resNull.hex).toBe('#64748b');

    // below t (e.g. p=0.3, t=0.5)
    const resBelow = evaluateVesselColor({ probability: 0.3, threshold: 0.5 });
    expect(resBelow.status).toBe('below_cutoff');
    expect(resBelow.label).toBe('Below screening cutoff');

    // at t (e.g. p=0.5, t=0.5)
    const resAt = evaluateVesselColor({ probability: 0.5, threshold: 0.5 });
    expect(resAt.status).toBe('above_cutoff');
    expect(resAt.label).toBe('Above screening cutoff');

    // t + 0.15 (e.g. p=0.65, t=0.5, highMargin=0.15)
    const resHigh = evaluateVesselColor({ probability: 0.65, threshold: 0.5, highMargin: 0.15 });
    expect(resHigh.status).toBe('elevated');
    expect(resHigh.label).toBe('Above screening cutoff (elevated)');

    // t + 0.35 (e.g. p=0.85, t=0.5, highMargin=0.15)
    const resRed = evaluateVesselColor({ probability: 0.85, threshold: 0.5, highMargin: 0.15 });
    expect(resRed.status).toBe('elevated');
    expect(resRed.label).toBe('Above screening cutoff (elevated)');
  });
});
