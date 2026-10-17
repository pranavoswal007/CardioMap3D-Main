import { useMemo, useState } from 'react';
import { Play, RotateCcw, User, AlertCircle, Info, ChevronDown, ChevronUp, Sliders } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { runPredictionFlow } from '../services/predictionFlow';
import type { FeatureSchemaItem } from '../api/types';

const GROUP_LABELS: Record<string, string> = {
  demographics: 'Demographics & Body Metrics',
  history: 'Medical & Cardiac History',
  vitals: 'Vital Signs',
  symptoms: 'Clinical Symptoms & Signs',
  ecg: 'Electrocardiogram (ECG)',
  labs: 'Laboratory Blood Markers',
  echo: 'Echocardiography (Echo)',
};

import { formatNumericDefault } from '../utils/formatters';

export function PatientForm() {
  const schemaData = useAppStore((s) => s.schemaData);
  const samplePatients = useAppStore((s) => s.samplePatients);
  const patientInputs = useAppStore((s) => s.patientInputs);
  const setPatientInput = useAppStore((s) => s.setPatientInput);
  const setPatientInputs = useAppStore((s) => s.setPatientInputs);
  const resetPatientInputs = useAppStore((s) => s.resetPatientInputs);
  const predictLoading = useAppStore((s) => s.predictLoading);
  const predictError = useAppStore((s) => s.predictError);
  const prediction = useAppStore((s) => s.prediction);

  const [isEditing, setIsEditing] = useState(false);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    demographics: true,
    history: true,
    vitals: true,
    symptoms: false,
    ecg: false,
    labs: false,
    echo: true,
  });

  const toggleGroup = (group: string) => {
    setOpenGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const featureList = useMemo(() => {
    if (!schemaData?.feature_schema) return [];
    return Object.entries(schemaData.feature_schema).map(([name, raw]) => {
      const item = raw as FeatureSchemaItem;
      return {
        ...item,
        name: item.name || name,
        group: item.group || 'demographics',
      };
    });
  }, [schemaData]);

  const groupedFeatures = useMemo(() => {
    const map: Record<string, FeatureSchemaItem[]> = {};
    for (const feat of featureList) {
      const g = feat.group || 'demographics';
      if (!map[g]) map[g] = [];
      map[g].push(feat);
    }
    return map;
  }, [featureList]);

  const handleSampleSelect = (datasetIndexStr: string) => {
    if (!datasetIndexStr) return;
    const sample = samplePatients.find(
      (sp) => String(sp.dataset_row_index) === datasetIndexStr || String(sp.sample_id) === datasetIndexStr
    );
    if (sample && sample.features) {
      setPatientInputs(sample.features as Record<string, number | string>);
    }
  };

  const handleReset = () => {
    resetPatientInputs();
    setIsEditing(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runPredictionFlow();
    setIsEditing(false);

    // Smoothly scroll directly upwards towards 3D heart model
    if (typeof window !== 'undefined') {
      const viewer =
        document.getElementById('heart-viewer-section') ||
        document.querySelector('[data-testid="viewer-wrapper"]');
      if (viewer && typeof viewer.scrollIntoView === 'function') {
        viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (typeof window.scrollTo === 'function') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  if (prediction && !isEditing) {
    const inputCount = Object.keys(patientInputs).length;
    return (
      <div
        data-testid="patient-form-collapsed"
        className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow-xl text-slate-100 flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-950 border border-indigo-800 flex items-center justify-center shrink-0">
            <User className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white">Patient Profile Loaded</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
                Prediction Active
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {inputCount > 0 ? `${inputCount} clinical features specified` : 'Default patient profile'} &bull; Form collapsed to prioritize results
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition shadow-md"
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Edit inputs</span>
        </button>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <User className="w-5 h-5 text-indigo-400" />
            Patient Profile Input
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            55 clinical features generated dynamically from verified API schema. Missing entries will be imputed.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {prediction && (
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="text-xs text-slate-400 hover:text-white px-2.5 py-1.5 bg-slate-800 rounded border border-slate-700 transition"
            >
              Hide form
            </button>
          )}

          {samplePatients.length > 0 && (
            <select
              aria-label="Load sample patient"
              className="bg-slate-800 border border-slate-700 text-xs text-slate-200 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              onChange={(e) => handleSampleSelect(e.target.value)}
              defaultValue=""
            >
              <option value="" disabled>
                Load sample patient...
              </option>
              {samplePatients.map((sp) => (
                <option key={sp.sample_id} value={sp.dataset_row_index}>
                  {sp.sample_id} (CAD Prob: {(sp.cad_probability * 100).toFixed(1)}%)
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>
      </div>

      {predictError && (
        <div className="mt-4 p-3 bg-red-950/60 border border-red-800 text-red-200 rounded-lg text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Prediction Error: </span>
            {predictError}
          </div>
        </div>
      )}

      {prediction?.imputed_features && prediction.imputed_features.length > 0 && (
        <div className="mt-4 p-3 bg-amber-950/40 border border-amber-800/80 text-amber-200 rounded-lg text-xs">
          <div className="font-semibold flex items-center gap-1.5 text-amber-300">
            <Info className="w-4 h-4" />
            Features Imputed by Model ({prediction.imputed_features.length}):
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {prediction.imputed_features.map((feat) => (
              <span key={feat} className="px-2 py-0.5 bg-amber-900/60 rounded text-[11px] text-amber-100 border border-amber-800/50">
                {feat}
              </span>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
        {Object.entries(GROUP_LABELS).map(([groupKey, groupTitle]) => {
          const items = groupedFeatures[groupKey];
          if (!items || items.length === 0) return null;
          const isOpen = openGroups[groupKey] ?? true;

          return (
            <div key={groupKey} className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950/40">
              <button
                type="button"
                onClick={() => toggleGroup(groupKey)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 bg-slate-850 hover:bg-slate-800/60 text-left transition"
              >
                <span className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  {groupTitle}
                  <span className="text-[11px] font-normal text-slate-400">({items.length} features)</span>
                </span>
                {isOpen ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {isOpen && (
                <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 border-t border-slate-800">
                  {items.map((feat) => {
                    const rawVal = patientInputs[feat.name];
                    const val = rawVal !== undefined ? rawVal : '';
                    const isOrdinalRwma = feat.name === 'Region RWMA';

                    return (
                      <div key={feat.name} className="flex flex-col gap-1">
                        <label
                          htmlFor={`input-${feat.name}`}
                          className="text-[11px] font-medium text-slate-300 truncate"
                          title={feat.display_label || feat.name}
                        >
                          {isOrdinalRwma ? 'Regional Wall Motion (Code 0-4)' : feat.display_label || feat.name}
                          {feat.unit && !isOrdinalRwma && (
                            <span className="text-[10px] text-slate-400 ml-1">({feat.unit})</span>
                          )}
                        </label>

                        {/* Input rendering based on type */}
                        {feat.allowed_values && feat.allowed_values.length > 0 ? (
                          <select
                            id={`input-${feat.name}`}
                            name={feat.name}
                            value={String(val)}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '') {
                                setPatientInput(feat.name, '');
                              } else if (typeof feat.allowed_values?.[0] === 'number') {
                                setPatientInput(feat.name, Number(v));
                              } else {
                                setPatientInput(feat.name, v);
                              }
                            }}
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                          >
                            <option value="">Default (Impute)</option>
                            {feat.allowed_values.map((opt) => (
                              <option key={String(opt)} value={String(opt)}>
                                {String(opt)}
                              </option>
                            ))}
                          </select>
                        ) : feat.type === 'numeric' ? (
                          <input
                            type="number"
                            id={`input-${feat.name}`}
                            name={feat.name}
                            value={val}
                            min={feat.min ?? undefined}
                            max={feat.max ?? undefined}
                            step="any"
                            placeholder={feat.default !== undefined && feat.default !== null ? `Default: ${formatNumericDefault(feat.default)}` : ''}
                            onChange={(e) => setPatientInput(feat.name, e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                          />
                        ) : (
                          <input
                            type="text"
                            id={`input-${feat.name}`}
                            name={feat.name}
                            value={val}
                            onChange={(e) => setPatientInput(feat.name, e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <div className="pt-2">
          <button
            type="submit"
            disabled={predictLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white font-medium text-xs rounded-lg shadow-lg shadow-indigo-900/30 transition"
          >
            <Play className={`w-4 h-4 ${predictLoading ? 'animate-spin' : ''}`} />
            {predictLoading ? 'Computing Calibrated Predictions...' : 'Analyze Coronary Stenosis Risk'}
          </button>
        </div>
      </form>
    </div>
  );
}
