import { ApiError, errorMessage, fetchJson } from '../../src/client/api/client';

function jsonResponse(body: unknown, status: number, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  });
}

describe('fetchJson', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('returns parsed JSON on success and requests JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ jobs: [] }, 200));
    const body = await fetchJson<{ jobs: unknown[] }>('http://x/api/v1/jobs');
    expect(body).toEqual({ jobs: [] });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://x/api/v1/jobs',
      expect.objectContaining({ headers: { accept: 'application/json' } })
    );
  });

  test('forwards the AbortSignal', async () => {
    const controller = new AbortController();
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, 200));
    await fetchJson('http://x/api/v1/jobs', { signal: controller.signal });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://x/api/v1/jobs',
      expect.objectContaining({ signal: controller.signal })
    );
  });

  test('parses RFC 9457 Problem Details failures', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(
        {
          code: 'SLURM_UNAVAILABLE',
          type: 'urn:slurm-view:problem:slurm-unavailable',
          title: 'Slurm Unavailable',
          status: 503,
          detail: 'Slurm is temporarily unavailable; try again shortly.',
        },
        503,
        'application/problem+json'
      )
    );
    const error = await fetchJson('http://x/api/v1/jobs').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('SLURM_UNAVAILABLE');
    expect(error.status).toBe(503);
    expect(error.detail).toBe('Slurm is temporarily unavailable; try again shortly.');
    expect(errorMessage(error)).toBe('Slurm is temporarily unavailable; try again shortly.');
  });

  test('malformed pseudo-Problem-Details JSON is not trusted', async () => {
    const malformed = [
      { code: 42, status: 500 },
      { code: 'BROKEN' },
      { code: 'BROKEN', status: 'oops' },
      { code: 'BROKEN', status: 500, detail: 42 },
      'just a string',
      null,
    ];
    for (const body of malformed) {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse(body, 500));
      const error = await fetchJson('http://x/api/v1/jobs').catch((e) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.code).toBe('REQUEST_FAILED');
      expect(error.status).toBe(500);
    }
  });

  test('ignores extra fields outside the consumed problem shape', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ code: 'BROKEN', status: 500, title: 42 }, 500));
    const error = await fetchJson('http://x/api/v1/jobs').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('BROKEN');
    expect(error.status).toBe(500);
  });

  test('falls back to a generic error for non-JSON failures', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('Bad Gateway', { status: 502, headers: { 'content-type': 'text/plain' } }));
    const error = await fetchJson('http://x/api/v1/jobs').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('REQUEST_FAILED');
    expect(error.status).toBe(502);
  });

  test('wraps network failures without losing the message', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    const error = await fetchJson('http://x/api/v1/jobs').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('FETCH_FAILED');
    expect(errorMessage(error)).toBe('fetch failed');
  });

  test('rethrows aborts untouched so queries can cancel', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    global.fetch = jest.fn().mockRejectedValue(abort);
    await expect(fetchJson('http://x/api/v1/jobs')).rejects.toBe(abort);
  });
});
