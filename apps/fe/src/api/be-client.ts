export type HealthStatus = 'checking' | 'online' | 'offline';

export interface ServiceHealth {
  status: 'ok';
  service: string;
}

export interface HealthResult {
  status: HealthStatus;
  data?: ServiceHealth;
  detail?: string;
  requestId?: string;
}

interface ProblemDetails {
  detail?: string;
  requestId?: string;
}

const BE_BASE_URL = (
  import.meta.env.VITE_BE_BASE_URL ?? 'http://localhost:3000/api/v1'
).replace(/\/$/, '');

async function getHealth(
  path: string,
  signal: AbortSignal,
): Promise<HealthResult> {
  try {
    const response = await fetch(`${BE_BASE_URL}${path}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
    const requestId = response.headers.get('x-request-id') ?? undefined;

    if (!response.ok) {
      const problem = (await response.json()) as ProblemDetails;
      return {
        status: 'offline',
        detail:
          problem.detail ?? `Request failed with HTTP ${response.status}.`,
        requestId: problem.requestId ?? requestId,
      };
    }

    return {
      status: 'online',
      data: (await response.json()) as ServiceHealth,
      requestId,
    };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    return {
      status: 'offline',
      detail: 'The backend could not be reached.',
    };
  }
}

export function getBackendHealth(signal: AbortSignal): Promise<HealthResult> {
  return getHealth('/health', signal);
}

export function getMockLlmHealth(signal: AbortSignal): Promise<HealthResult> {
  return getHealth('/health/mock-llm', signal);
}

export { BE_BASE_URL };
