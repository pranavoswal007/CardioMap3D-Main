/**
 * Typed HTTP client wrapper for CardioMap 3D API.
 * Strict typing from OpenAPI schema, AbortSignal support, configurable timeout,
 * and structured ApiClientError with unreachable detection.
 */
import type {
  HealthResponse,
  SchemaResponse,
  SamplePatient,
  PredictResponse,
  ExplainResponse,
  MetricsResponse,
} from './types';

export class ApiClientError extends Error {
  public status?: number;
  public isNetworkError: boolean;
  public detail?: unknown;

  constructor(message: string, options?: { status?: number; isNetworkError?: boolean; detail?: unknown }) {
    super(message);
    this.name = 'ApiClientError';
    this.status = options?.status;
    this.isNetworkError = options?.isNetworkError ?? false;
    this.detail = options?.detail;
  }
}

export const getApiBaseUrl = (): string => {
  const envUrl = import.meta.env.VITE_API_URL as string | undefined;
  return (envUrl || 'http://localhost:8000').replace(/\/+$/, '');
};

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, timeoutMs = 20000 } = options;
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  // Link caller signal and timeout controller
  const combinedSignal = signal
    ? anySignal([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Accept': 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: combinedSignal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      let errorDetail: unknown = null;
      let errorMsg = `API request failed with status ${res.status}`;
      try {
        const json = await res.json();
        errorDetail = json;
        if (json && typeof json === 'object' && 'detail' in json) {
          if (typeof json.detail === 'string') {
            errorMsg = json.detail;
          } else if (Array.isArray(json.detail)) {
            errorMsg = json.detail.map((d: { msg?: string }) => d.msg || 'Validation error').join('; ');
          }
        }
      } catch {
        errorMsg = res.statusText || errorMsg;
      }
      throw new ApiClientError(errorMsg, { status: res.status, detail: errorDetail });
    }

    const data: T = await res.json();
    return data;
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof ApiClientError) {
      throw err;
    }

    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err; // Allow caller to detect intentional cancellation
    }

    const isNetwork = !(err instanceof DOMException);
    const message = err instanceof Error ? err.message : 'Unknown network error';
    throw new ApiClientError(`API Unreachable: ${message}`, {
      isNetworkError: isNetwork,
      detail: err,
    });
  }
}

/**
 * Polyfill-friendly helper to combine AbortSignals
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

export const api = {
  getHealth: (signal?: AbortSignal): Promise<HealthResponse> =>
    request<HealthResponse>('/health', { method: 'GET', signal }),

  getSchema: (signal?: AbortSignal): Promise<SchemaResponse> =>
    request<SchemaResponse>('/schema', { method: 'GET', signal }),

  getSamplePatients: (signal?: AbortSignal): Promise<SamplePatient[]> =>
    request<SamplePatient[]>('/patients/samples', { method: 'GET', signal }),

  getMetrics: (signal?: AbortSignal): Promise<MetricsResponse> =>
    request<MetricsResponse>('/metrics', { method: 'GET', signal }),

  predict: (patient: Record<string, number | string>, signal?: AbortSignal): Promise<PredictResponse> =>
    request<PredictResponse>('/predict', { method: 'POST', body: patient, signal }),

  explain: (
    patient: Record<string, number | string>,
    targets?: string[],
    signal?: AbortSignal
  ): Promise<ExplainResponse> => {
    const query = targets && targets.length > 0 ? `?targets=${targets.join(',')}` : '';
    return request<ExplainResponse>(`/explain${query}`, { method: 'POST', body: patient, signal });
  },
};
