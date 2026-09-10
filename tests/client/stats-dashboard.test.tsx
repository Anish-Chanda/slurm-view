/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatsDashboard } from '../../src/client/features/stats/StatsDashboard';
import { partitionKeys } from '../../src/client/api/query-keys';

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const STATS_BODY = {
  cpu: {
    configuredCpus: 108,
    effectiveCpus: 100,
    allocatedCpus: 16,
    availableCpus: 80,
    unavailableCpus: 12,
    loadGroups: { low: 4, medium: 6, high: 5, unclassified: 3 },
  },
  memory: {
    totalMiB: 768000,
    allocatedMiB: 64000,
    unallocatedMiB: 688000,
    unavailableMiB: 16000,
    freeMiB: null,
  },
  gpu: {
    total: 8,
    allocated: 2,
    available: 6,
    unavailable: 0,
    byType: { a100: { total: 8, allocated: 2, available: 6, unavailable: 0 } },
  },
  updatedAt: '2026-09-09T12:00:00.000Z',
};

function statsForScope(partition: string | null) {
  const configuredCpus = partition === null ? 108 : partition === 'gpu' ? 64 : 4;
  const allocatedCpus = partition === null ? 16 : partition === 'gpu' ? 8 : 0;
  return {
    ...STATS_BODY,
    cpu: {
      ...STATS_BODY.cpu,
      configuredCpus,
      allocatedCpus,
      availableCpus: configuredCpus - allocatedCpus,
      unavailableCpus: 0,
      loadGroups: { low: 0, medium: 0, high: 0, unclassified: 0 },
    },
  };
}

function setupFetch(statsHandler?: (url: string) => unknown) {
  const fetchMock = jest.fn((url: string) => {
    if (url.includes('/api/v1/partitions')) {
      return Promise.resolve(
        okJson({ partitions: ['gpu', 'all'], updatedAt: '2026-09-09T12:00:00.000Z' })
      );
    }
    if (url.includes('/api/v1/stats')) {
      const partition = new URL(url).searchParams.get('partition');
      return Promise.resolve(okJson(statsHandler ? statsHandler(url) : statsForScope(partition)));
    }
    throw new Error(`unexpected request: ${url}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderDashboard(client: QueryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <StatsDashboard />
    </QueryClientProvider>
  );
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('StatsDashboard', () => {
  test('renders semantic totals without D3 hierarchy shapes', async () => {
    setupFetch();
    renderDashboard();

    await waitFor(() => expect(screen.getByText('CPU Total: 108')).toBeTruthy());
    expect(screen.getByText('Memory Total: 750 GiB')).toBeTruthy();
    expect(screen.getByText('GPU Total: 8')).toBeTruthy();
    expect(screen.getAllByRole('img').length).toBe(3);
  });

  test('partition select scopes the query; All omits the parameter', async () => {
    const fetchMock = setupFetch();
    renderDashboard();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('CPU Total: 108')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Partition:'), 'gpu');

    await waitFor(() => expect(screen.getByText('CPU Total: 64')).toBeTruthy());
    expect(
      fetchMock.mock.calls.some(([url]) => (url as string).includes('partition=gpu'))
    ).toBe(true);
    await waitFor(() =>
      expect(screen.getByText(/Showing stats for:/).textContent).toContain('gpu')
    );

    fetchMock.mockClear();
    await user.selectOptions(screen.getByLabelText('Partition:'), '');

    await waitFor(() => expect(screen.getByText('CPU Total: 108')).toBeTruthy());
    for (const [url] of fetchMock.mock.calls) {
      if ((url as string).includes('/api/v1/stats')) {
        expect(url as string).not.toContain('partition=');
      }
    }
  });

  test('a literal partition named all is sent through as a normal value', async () => {
    const fetchMock = setupFetch();
    renderDashboard();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('CPU Total: 108')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Partition:'), 'all');

    await waitFor(() => expect(screen.getByText('CPU Total: 4')).toBeTruthy());
    expect(
      fetchMock.mock.calls.some(([url]) => (url as string).includes('partition=all'))
    ).toBe(true);
  });

  test('zero GPUs render an empty state instead of a fake slice', async () => {
    setupFetch(() => ({ ...STATS_BODY, gpu: { total: 0, allocated: 0, available: 0, unavailable: 0, byType: {} } }));
    renderDashboard();

    await waitFor(() => expect(screen.getByText('No GPUs in this scope.')).toBeTruthy());
    expect(screen.getAllByRole('img').length).toBe(2);
  });

  test('stats error surfaces a retryable panel', async () => {
    let shouldFail = true;
    setupFetch();
    // Reject the stats request while failing.
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/v1/partitions')) {
        return Promise.resolve(
          okJson({ partitions: ['gpu'], updatedAt: '2026-09-09T12:00:00.000Z' })
        );
      }
      if (shouldFail) {
        return Promise.reject(new TypeError('fetch failed'));
      }
      return Promise.resolve(okJson(STATS_BODY));
    });
    renderDashboard();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 8000 });
    shouldFail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('CPU Total: 108')).toBeTruthy());
  });

  test('scope change shows loading instead of old data under the new label', async () => {
    setupFetch();
    renderDashboard();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('CPU Total: 108')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Partition:'), 'gpu');

    await waitFor(() => expect(screen.queryByText('CPU Total: 108')).toBeNull());
    await waitFor(() => expect(screen.getByText('CPU Total: 64')).toBeTruthy());
  });

  test('same-key background refresh keeps charts with a Refreshing… indicator', async () => {
    const fetchMock = setupFetch();
    renderDashboard();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('CPU Total: 108')).toBeTruthy());
    let resolveRefresh!: (response: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    fetchMock.mockImplementation((url: string) =>
      url.includes('/api/v1/partitions')
        ? Promise.resolve(
            okJson({ partitions: ['gpu', 'all'], updatedAt: '2026-09-09T12:00:00.000Z' })
          )
        : gate
    );
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(screen.getByText('Refreshing…')).toBeTruthy());
    expect(screen.getByText('CPU Total: 108')).toBeTruthy();

    resolveRefresh(okJson(STATS_BODY));
    await waitFor(() => expect(screen.queryByText('Refreshing…')).toBeNull());
    expect(screen.getByText('CPU Total: 108')).toBeTruthy();
  });

  test('background refresh error keeps charts with a warning', async () => {
    let shouldFail = false;
    setupFetch();
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/v1/partitions')) {
        return Promise.resolve(
          okJson({ partitions: ['gpu', 'all'], updatedAt: '2026-09-09T12:00:00.000Z' })
        );
      }
      if (shouldFail) {
        return Promise.reject(new TypeError('fetch failed'));
      }
      return Promise.resolve(okJson(STATS_BODY));
    });
    renderDashboard();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('CPU Total: 108')).toBeTruthy());
    shouldFail = true;
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(
      () =>
        expect(
          screen.getByText('Showing previous stats because the latest refresh failed.')
        ).toBeTruthy(),
      { timeout: 8000 }
    );
    expect(screen.getByText('CPU Total: 108')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  test('partition list failure leaves cluster-wide stats usable with retry', async () => {
    let partitionsFail = true;
    global.fetch = jest.fn((url: string) =>
      url.includes('/api/v1/partitions')
        ? partitionsFail
          ? Promise.reject(new TypeError('fetch failed'))
          : Promise.resolve(
              okJson({ partitions: ['gpu', 'all'], updatedAt: '2026-09-09T12:00:00.000Z' })
            )
        : Promise.resolve(okJson(STATS_BODY))
    ) as unknown as typeof fetch;
    renderDashboard();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('CPU Total: 108')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Partition list unavailable.')).toBeTruthy(), {
      timeout: 8000,
    });
    expect((screen.getByLabelText('Partition:') as HTMLSelectElement).disabled).toBe(true);

    partitionsFail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        Array.from((screen.getByLabelText('Partition:') as HTMLSelectElement).options).some(
          (option) => option.value === 'gpu'
        )
      ).toBe(true)
    );
    expect(screen.queryByText('Partition list unavailable.')).toBeNull();
  });

  test('cached partitions survive a later refresh failure with a subtle warning', async () => {
    let partitionsFail = false;
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/api/v1/partitions')) {
        return partitionsFail
          ? Promise.reject(new TypeError('fetch failed'))
          : Promise.resolve(
              okJson({ partitions: ['gpu', 'all'], updatedAt: '2026-09-09T12:00:00.000Z' })
            );
      }
      return Promise.resolve(okJson(statsForScope(new URL(url).searchParams.get('partition'))));
    }) as unknown as typeof fetch;
    const client = new QueryClient();
    renderDashboard(client);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('CPU Total: 108')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Partition:'), 'gpu');
    await waitFor(() => expect(screen.getByText('CPU Total: 64')).toBeTruthy());

    partitionsFail = true;
    await client.invalidateQueries({ queryKey: partitionKeys.list });
    await waitFor(
      () => expect(screen.getByText('Partition list may be out of date.')).toBeTruthy(),
      { timeout: 8000 }
    );
    expect(
      Array.from((screen.getByLabelText('Partition:') as HTMLSelectElement).options).some(
        (option) => option.value === 'gpu'
      )
    ).toBe(true);
    expect(screen.getByText('CPU Total: 64')).toBeTruthy();
  });
});
