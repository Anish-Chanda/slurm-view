/** @jest-environment jsdom */
import { waitFor } from '@testing-library/react';
import {
  JOB_DETAIL_STALE_TIME_MS,
  prepareJobVisitSnapshot,
} from '../../src/client/api/job-details';
import { jobsKeys } from '../../src/client/api/query-keys';
import { createTestQueryClient } from './test-query-client';

function okJson(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function snapshotBody(marker: number): unknown {
  return { job: { id: '101', marker }, updatedAt: '2026-09-12T16:00:00.000Z' };
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('prepareJobVisitSnapshot', () => {
  test('fetches when nothing is cached', async () => {
    const fetchMock = jest.fn(() => Promise.resolve(okJson(snapshotBody(1))));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createTestQueryClient();

    prepareJobVisitSnapshot(client, '101');

    await waitFor(() =>
      expect(
        (client.getQueryState(jobsKeys.detail('101'))?.data as { job?: { marker?: number } })
          ?.job?.marker
      ).toBe(1)
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('adopts a fresh snapshot without refetching', async () => {
    const fetchMock = jest.fn(() => Promise.resolve(okJson(snapshotBody(1))));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createTestQueryClient();

    prepareJobVisitSnapshot(client, '101');
    await waitFor(() =>
      expect(client.getQueryState(jobsKeys.detail('101'))?.data).toBeDefined()
    );
    prepareJobVisitSnapshot(client, '101');

    await waitFor(() =>
      expect(
        (client.getQueryState(jobsKeys.detail('101'))?.data as { job?: { marker?: number } })
          ?.job?.marker
      ).toBe(1)
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('drops a snapshot older than the detail stale time and refetches', async () => {
    let calls = 0;
    const fetchMock = jest.fn(() => Promise.resolve(okJson(snapshotBody(++calls))));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createTestQueryClient();
    const visitedAt = Date.now();

    prepareJobVisitSnapshot(client, '101');
    await waitFor(() =>
      expect(
        (client.getQueryState(jobsKeys.detail('101'))?.data as { job?: { marker?: number } })
          ?.job?.marker
      ).toBe(1)
    );

    jest.spyOn(Date, 'now').mockReturnValue(visitedAt + JOB_DETAIL_STALE_TIME_MS + 1000);
    prepareJobVisitSnapshot(client, '101');

    await waitFor(() =>
      expect(
        (client.getQueryState(jobsKeys.detail('101'))?.data as { job?: { marker?: number } })
          ?.job?.marker
      ).toBe(2)
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('never cancels or duplicates an in-flight request', async () => {
    let release!: (response: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = jest.fn(() => gate);
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createTestQueryClient();
    const startedAt = Date.now();

    prepareJobVisitSnapshot(client, '101');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Time passes while the preload is still in flight; navigating now
    // must attach to it rather than cancel and duplicate it.
    jest.spyOn(Date, 'now').mockReturnValue(startedAt + JOB_DETAIL_STALE_TIME_MS + 1000);
    prepareJobVisitSnapshot(client, '101');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(okJson(snapshotBody(1)));
    await waitFor(() =>
      expect(client.getQueryState(jobsKeys.detail('101'))?.data).toBeDefined()
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(jobsKeys.detail('101'))?.error).toBeNull();
  });
});
