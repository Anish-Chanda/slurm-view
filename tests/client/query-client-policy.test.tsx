/** @jest-environment jsdom */
import { QueryClientProvider, focusManager, onlineManager, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createQueryClient } from '../../src/client/app/providers';
import { createTestQueryClient } from './test-query-client';

function makeFetcher() {
  return jest.fn(() => Promise.resolve('snapshot-value'));
}

function Probe({
  name,
  fetcher,
  options = {},
}: {
  name: string;
  fetcher: () => Promise<string>;
  options?: Record<string, unknown>;
}) {
  const query = useQuery({
    queryKey: ['policy', name],
    queryFn: fetcher,
    staleTime: 0,
    ...options,
  });
  return <div>{query.data ?? 'loading'}</div>;
}

function renderProbe(
  name: string,
  fetcher: () => Promise<string>,
  options: Record<string, unknown> = {}
) {
  const client = createTestQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <Probe name={name} fetcher={fetcher} options={options} />
    </QueryClientProvider>
  );
  return { client, ...view };
}

afterEach(() => {
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('project query policy', () => {
  test('test overrides merge with production defaults instead of replacing them', () => {
    for (const overrides of [{ retry: false }, { retryDelay: 0 }] as const) {
      const defaults = createTestQueryClient({ ...overrides }).getDefaultOptions().queries ?? {};
      expect(defaults.refetchOnMount).toBe(false);
      expect(defaults.refetchOnWindowFocus).toBe(false);
      expect(defaults.refetchOnReconnect).toBe(false);
    }
    const noRetry = createTestQueryClient({ retry: false }).getDefaultOptions().queries;
    expect(noRetry?.retry).toBe(false);
    const fastRetry = createTestQueryClient({ retryDelay: 0 }).getDefaultOptions().queries;
    expect(fastRetry?.retryDelay).toBe(0);
    expect(fastRetry?.retry).toBe(1);
  });

  test('shared defaults disable implicit refetching with a conservative retry', () => {
    const defaults = createQueryClient().getDefaultOptions().queries ?? {};
    expect(defaults.refetchOnMount).toBe(false);
    expect(defaults.refetchOnWindowFocus).toBe(false);
    expect(defaults.refetchOnReconnect).toBe(false);
    expect(defaults.retry).toBe(1);
    // Staleness stays per-query: no global staleTime override.
    expect(defaults.staleTime).toBeUndefined();
  });

  test('a stale query does not refetch when focus returns', async () => {
    const fetcher = makeFetcher();
    renderProbe('focus', fetcher);

    await waitFor(() => expect(screen.getByText('snapshot-value')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(1);

    focusManager.setFocused(false);
    await act(async () => {
      focusManager.setFocused(true);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('a stale query does not refetch on reconnect', async () => {
    const fetcher = makeFetcher();
    renderProbe('reconnect', fetcher);

    await waitFor(() => expect(screen.getByText('snapshot-value')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(1);

    onlineManager.setOnline(false);
    await act(async () => {
      onlineManager.setOnline(true);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('a stale cached query does not refetch merely because an observer mounts', async () => {
    const fetcher = makeFetcher();
    const client = createTestQueryClient();
    const first = render(
      <QueryClientProvider client={client}>
        <Probe name="mount" fetcher={fetcher} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText('snapshot-value')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(1);
    first.unmount();

    render(
      <QueryClientProvider client={client}>
        <Probe name="mount" fetcher={fetcher} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText('snapshot-value')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('an explicit refetchInterval still polls', async () => {
    jest.useFakeTimers();
    const fetcher = makeFetcher();
    renderProbe('polling', fetcher, { refetchInterval: 500 });

    await act(async () => undefined);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Step the clock so each interval tick settles before the next fires;
    // back-to-back ticks would skip while a fetch is still in flight.
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(await screen.findByText('snapshot-value')).toBeTruthy();
  });

  test('a query-local focus override still refetches on refocus', async () => {
    const fetcher = makeFetcher();
    renderProbe('override', fetcher, { refetchOnWindowFocus: true });

    await waitFor(() => expect(screen.getByText('snapshot-value')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(1);

    focusManager.setFocused(false);
    await act(async () => {
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
