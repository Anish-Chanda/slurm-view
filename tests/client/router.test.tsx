/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routeTree } from '../../src/client/routeTree.gen';

function makeJob(id: string, name: string, state = 'RUNNING'): Record<string, unknown> {
  return {
    id,
    jobId: id,
    arrayJobId: null,
    arrayTaskId: null,
    partition: 'debug',
    name,
    user: 'alice',
    account: 'lab',
    qos: null,
    state,
    stateFlags: [],
    stateReason: null,
    timeLimit: { kind: 'finite', seconds: 7200 },
    submitTime: '2026-09-12T14:00:00.000Z',
    eligibleTime: null,
    startTime: '2026-09-12T14:20:00.000Z',
    endTime: null,
    priority: null,
    taskCount: null,
    cpusPerTask: null,
    constraints: null,
    reservation: null,
    nodeCount: 2,
    nodeExpression: 'node01',
    requested: { cpus: 8, memoryMiB: 32768, nodes: 2, gpus: { total: 0, byType: {} } },
    allocated: { cpus: 8, memoryMiB: 32768, nodes: 2, gpus: { total: 0, byType: {} } },
    workdir: null,
    command: null,
    stdoutPath: null,
    stderrPath: null,
    dependency: null,
    exitCode: null,
    derivedExitCode: null,
    wckey: null,
    batchHost: null,
    flags: [],
  };
}

const UI_SETTINGS_BODY = {
  charts: {
    cpu: { showSecondaryLayer: true },
    memory: { showSecondaryLayer: true },
    gpu: { showSecondaryLayer: true },
  },
  navbar: { enabled: true, title: 'Slurm View', color: '#1f2937' },
};

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
    allocatedUsedMiB: 48000,
    unallocatedMiB: 688000,
    unavailableMiB: 16000,
    freeMiB: 700000,
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

const PARTITIONS_BODY = { partitions: ['gpu'], updatedAt: '2026-09-09T12:00:00.000Z' };

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

interface RouterHandlers {
  jobs?: Record<string, unknown>;
  details?: Record<string, Record<string, unknown>>;
  detailsGate?: (id: string) => Promise<unknown> | unknown;
}

function setupFetch(handlers: RouterHandlers) {
  const fetchMock = jest.fn((url: string) => {
    if (url.includes('/api/v1/ui-settings')) return Promise.resolve(okJson(UI_SETTINGS_BODY));
    if (url.includes('/api/v1/partitions')) return Promise.resolve(okJson(PARTITIONS_BODY));
    if (url.includes('/api/v1/stats')) return Promise.resolve(okJson(STATS_BODY));
    if (url.includes('/efficiency')) {
      return Promise.resolve(
        okJson({
          cpu: { efficiencyPercent: 50, utilizedSeconds: 100, allocatedCoreSeconds: 200 },
          memory: { efficiencyPercent: 50, utilizedMiB: 512, allocatedMiB: 1024 },
          wallClockSeconds: 100,
          updatedAt: '2026-09-12T18:00:00.000Z',
        })
      );
    }
    const detailMatch = url.match(/\/api\/v1\/jobs\/([^/?]+)(\?|$)/);
    if (detailMatch && !url.includes('/api/v1/jobs?')) {
      const id = decodeURIComponent(detailMatch[1]!);
      if (handlers.detailsGate) {
        return Promise.resolve(handlers.detailsGate(id)).then((body) => okJson(body));
      }
      const job = handlers.details?.[id];
      if (!job) {
        return Promise.resolve(okJson({ code: 'NOT_FOUND', status: 404 }, 404));
      }
      return Promise.resolve(okJson({ job, updatedAt: '2026-09-12T16:00:00.000Z' }));
    }
    if (url.includes('/api/v1/jobs')) {
      const jobs = handlers.jobs ?? { '101': makeJob('101', 'job-101'), '102': makeJob('102', 'job-102') };
      const list = Object.values(jobs);
      return Promise.resolve(
        okJson({
          jobs: list,
          pagination: { page: 1, pageSize: 20, totalItems: list.length, totalPages: 1 },
          updatedAt: '2026-09-12T16:00:00.000Z',
        })
      );
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderRouter(initialEntries: string[], handlers: RouterHandlers) {
  const fetchMock = setupFetch(handlers);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
    context: { queryClient },
    defaultPreload: 'intent',
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return { router, queryClient, fetchMock };
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('app router', () => {
  test('dashboard route renders the queue', async () => {
    renderRouter(['/'], {});

    await waitFor(() => expect(screen.getByText('job-101')).toBeTruthy());
    expect(screen.getByText('Slurm Job Queue')).toBeTruthy();
  });

  test('direct deep link renders the job page', async () => {
    renderRouter(['/jobs/101'], { details: { '101': makeJob('101', 'job-101') } });

    await waitFor(() => expect(screen.getAllByText('job-101').length).toBeGreaterThan(0));
    expect(screen.getByText('Current allocation')).toBeTruthy();
  });

  test('job table links navigate to the job page', async () => {
    const user = userEvent.setup();
    const { router } = renderRouter(['/'], { details: { '101': makeJob('101', 'job-101') } });

    await waitFor(() => expect(screen.getByText('job-101')).toBeTruthy());
    await user.click(screen.getByRole('link', { name: '101' }));

    await waitFor(() => expect(screen.getByText('Current allocation')).toBeTruthy());
    expect(router.state.location.pathname).toBe('/jobs/101');
  });

  test('back from a job restores the queue search state', async () => {
    const user = userEvent.setup();
    const { router } = renderRouter(['/?user=alice&page=1&pageSize=20'], {
      details: { '101': makeJob('101', 'job-101') },
    });

    await waitFor(() => expect(screen.getByText('User: alice')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('link', { name: '101' })).toBeTruthy());
    await user.click(screen.getByRole('link', { name: '101' }));
    await waitFor(() => expect(screen.getByText('Current allocation')).toBeTruthy());

    await user.click(screen.getByRole('link', { name: 'Back to jobs' }));
    await waitFor(() => expect(screen.getByText('User: alice')).toBeTruthy());
    expect(router.state.location.search).toMatchObject({ user: 'alice' });
  });

  test('unknown routes render the global not-found page', async () => {
    renderRouter(['/nope'], {});

    await waitFor(() => expect(screen.getByText('Page not found')).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Back to jobs' })).toBeTruthy();
  });

  test('missing jobs render the contextual not-found state', async () => {
    renderRouter(['/jobs/99999'], { details: {} });

    await waitFor(() => expect(screen.getByText(/is no longer available/)).toBeTruthy());
  });

  test('non-canonical IDs use the global not-found page', async () => {
    renderRouter(['/jobs/123.batch'], { details: {} });

    await waitFor(() => expect(screen.getByText('Page not found')).toBeTruthy());
    expect(screen.queryByText(/is no longer available/)).toBeNull();
  });

  test('dashboard search changes apply while the route stays mounted', async () => {
    const { router } = renderRouter(['/'], {});

    await waitFor(() => expect(screen.getByText('job-101')).toBeTruthy());
    await router.navigate({
      to: '/',
      search: { page: 1, pageSize: 20, user: 'bob' },
    });

    await waitFor(() => expect(screen.getByText('User: bob')).toBeTruthy());
    expect(router.state.location.search).toMatchObject({ user: 'bob' });
    expect(screen.getByText('job-101')).toBeTruthy();
  });

  test('back and forward restore earlier queue search states', async () => {
    const { router } = renderRouter(['/'], {});

    await waitFor(() => expect(screen.getByText('job-101')).toBeTruthy());
    await router.navigate({ to: '/', search: { page: 1, pageSize: 20, user: 'alice' } });
    await waitFor(() => expect(screen.getByText('User: alice')).toBeTruthy());

    router.history.back();
    await waitFor(() => expect(screen.queryByText('User: alice')).toBeNull());

    router.history.forward();
    await waitFor(() => expect(screen.getByText('User: alice')).toBeTruthy());
  });

  test('rendering the table preloads no job details; intent warms one', async () => {
    const user = userEvent.setup();
    const { fetchMock } = renderRouter(['/'], { details: { '101': makeJob('101', 'job-101') } });

    await waitFor(() => expect(screen.getByText('job-101')).toBeTruthy());
    const detailCalls = (url: string) =>
      url.includes('/api/v1/jobs/') && !url.includes('/api/v1/jobs?');
    expect(fetchMock.mock.calls.some(([url]) => detailCalls(url as string))).toBe(false);

    await user.hover(screen.getByRole('link', { name: '101' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => (url as string).includes('/api/v1/jobs/101'))
      ).toBe(true)
    );
    expect(
      fetchMock.mock.calls.some(([url]) => (url as string).includes('/api/v1/jobs/102'))
    ).toBe(false);
  });

  test('job-to-job navigation never shows the previous job', async () => {
    let resolveSecond!: (body: unknown) => void;
    const secondGate = new Promise<unknown>((resolve) => {
      resolveSecond = resolve;
    });
    const { router } = renderRouter(['/jobs/123'], {
      details: { '123': makeJob('123', 'job-one-two-three') },
      detailsGate: (id: string) => {
        if (id === '123') {
          return { job: makeJob('123', 'job-one-two-three'), updatedAt: '2026-09-12T16:00:00.000Z' };
        }
        return secondGate;
      },
    });

    await waitFor(() => expect(screen.getByText('job-one-two-three')).toBeTruthy());

    const navigation = router.navigate({ to: '/jobs/$jobId', params: { jobId: '456' } });
    await waitFor(() => expect(screen.getByLabelText('Loading job details')).toBeTruthy());
    expect(screen.queryByText('job-one-two-three')).toBeNull();

    resolveSecond({ job: makeJob('456', 'job-four-five-six'), updatedAt: '2026-09-12T16:00:00.000Z' });
    await navigation;
    await waitFor(() => expect(screen.getByText('job-four-five-six')).toBeTruthy());
    expect(screen.queryByText('job-one-two-three')).toBeNull();
  });
});
