interface ProblemBody {
  code: string;
  status: number;
  detail?: string;
}

class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: string;

  constructor(code: string, status: number, detail?: string) {
    super(detail ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (detail !== undefined) {
      this.detail = detail;
    }
  }
}

function isRecord(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isProblemBody(body: unknown): body is ProblemBody {
  if (!isRecord(body)) return false;
  if (typeof body.code !== 'string') return false;
  if (typeof body.status !== 'number') return false;
  if (!isOptionalString(body.detail)) return false;
  return true;
}

async function toApiError(response: Response): Promise<ApiError> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      const body: unknown = await response.json();
      if (isProblemBody(body)) {
        return new ApiError(body.code, body.status, body.detail);
      }
    } catch {
    }
  }
  return new ApiError('REQUEST_FAILED', response.status, `Request failed with status ${response.status}`);
}

async function fetchJson<T>(url: string, options: { signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: options.signal,
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError('FETCH_FAILED', 0, error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  return (await response.json()) as T;
}

export { ApiError, errorMessage, fetchJson };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail ?? error.message;
  if (error instanceof Error) return error.message;
  return 'Request failed';
}
