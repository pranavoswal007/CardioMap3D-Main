/**
 * Predict -> Sequential Explain orchestration flow.
 * Per Phase 4:
 * 1. Submit calls /predict first and renders immediately.
 * 2. Then POST /explain?targets=cad, then lad, lcx, rca sequentially, each with its own AbortController.
 * 3. In-flight requests are cancelled if a new submit or form change occurs.
 * 4. A failed explain must never hide the prediction.
 */
import { api, ApiClientError } from '../api/client';
import type { TargetCode } from '../api/types';
import { useAppStore } from '../store/useAppStore';

export async function runPredictionFlow(specificTargets?: TargetCode[]): Promise<void> {
  const store = useAppStore.getState();

  // 1. Cancel any current requests
  store.cancelAllInFlight();

  // 2. Prepare payload
  const rawInputs = store.patientInputs;
  const payload: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(rawInputs)) {
    if (v !== '' && v !== null && v !== undefined) {
      if (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '') {
        payload[k] = Number(v);
      } else {
        payload[k] = v;
      }
    }
  }

  // 3. Initiate Predict
  const predictController = new AbortController();
  store.setPredictAbortController(predictController);
  store.setPredictLoading(true);
  store.setPredictError(null);
  store.clearExplanations();

  try {
    const predResult = await api.predict(payload, predictController.signal);
    store.setPrediction(predResult);
    if (!store.whatIfActive) {
      store.setBaselineInputs({ ...rawInputs });
      store.setBaselinePrediction(predResult);
    }
    store.setPredictLoading(false);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return;
    }
    const msg =
      err instanceof ApiClientError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Failed to complete prediction';
    store.setPredictError(msg);
    store.setPredictLoading(false);
    return; // Do not proceed to explain if prediction itself failed
  }

  // 4. Sequential Explain: cad -> lad -> lcx -> rca (or only specificTargets when specified)
  const targets: TargetCode[] =
    specificTargets && specificTargets.length > 0
      ? specificTargets
      : ['cad', 'lad', 'lcx', 'rca'];

  for (const target of targets) {
    // Check if user cancelled or reset while waiting
    if (!useAppStore.getState().prediction) {
      return;
    }

    const explainController = new AbortController();
    store.setExplainAbortController(target, explainController);
    store.setExplainLoading(target, true);
    store.setExplainError(target, null);

    try {
      const explainResult = await api.explain(payload, [target], explainController.signal);
      store.setExplanation(target, explainResult);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const msg =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : `Failed explanation for ${target.toUpperCase()}`;
      store.setExplainError(target, msg);
    } finally {
      store.setExplainLoading(target, false);
      store.setExplainAbortController(target, null);
    }
  }
}
