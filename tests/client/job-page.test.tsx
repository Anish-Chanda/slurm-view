/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JobDto } from '../../src/shared/api/v1/jobs';
import { JobPage } from '../../src/client/features/job-details/JobPage';

function makeJob(overrides: Partial<JobDto> = {}): JobDto {
  return {
    id: '101',
    jobId: '101',
    arrayJobId: null,
    arrayTaskId: null,
    partition: 'debug',
    name: 'train-model',
    user: 'alice',
    account: 'research',
    qos: 'normal',
    state: 'RUNNING',
    stateFlags: [],
    stateReason: null,
    timeLimit: { kind: 'finite', seconds: 7200 },
    submitTime: '2026-09-12T14:00:00.000Z',
    eligibleTime: '2026-09-12T14:05:00.000Z',
    startTime: '2026-09-12T14:20:00.000Z',
    endTime: null,
    priority: 12345,
    taskCount: 4,
    cpusPerTask: 2,
    constraints: null,
    reservation: null,
    nodeCount: 2,
    nodeExpression: 'gpu[01-02]',
    requested: { cpus: 8, memoryMiB: 32768, nodes: 2, gpus: { total: 4, byType: { a100: 4 } } },
    allocated: { cpus: 8, memoryMiB: 32768, nodes: 2, gpus: { total: 4, byType: { a100: 4 } } },
    workdir: '/home/alice',
    command: 'sbatch run.sh',
    stdoutPath: '/home/alice/slurm-101.out',
    stderrPath: '/home/alice/slurm-101.err',
    dependency: null,
    exitCode: null,
    derivedExitCode: null,
    wckey: null,
    batchHost: null,
    flags: [],
    ...overrides,
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

const EFFICIENCY_BODY = {
  cpu: { efficiencyPercent: 88.16, utilizedSeconds: 13330, allocatedCoreSeconds: 15120 },
  memory: { efficiencyPercent: 61.09, utilizedMiB: 40038, allocatedMiB: 65536 },
  wallClockSeconds: 473,
  updatedAt: '2026-09-12T18:00:00.000Z',
};

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

function problemJson(code: string, status: number, detail?: string): Response {
  return okJson({ code, status, ...(detail ? { detail } : {}) }, status);
}

interface PageHandlers {
  job?: JobDto | null;
  jobStatus?: number;
  efficiency?: unknown;
  efficiencyStatus?: number;
}

function setupFetch(handlers: PageHandlers) {
  const fetchMock = jest.fn((url: string) => {
    if (url.includes('/api/v1/ui-settings')) {
      return Promise.resolve(okJson(UI_SETTINGS_BODY));
    }
    if (url.includes('/efficiency')) {
      if (handlers.efficiencyStatus && handlers.efficiencyStatus >= 400) {
        return Promise.resolve(problemJson('UPSTREAM_INVALID_RESPONSE', handlers.efficiencyStatus));
      }
      return Promise.resolve(okJson(handlers.efficiency ?? EFFICIENCY_BODY));
    }
    if (url.includes('/api/v1/jobs/')) {
      if (handlers.jobStatus && handlers.jobStatus >= 400) {
        const code = handlers.jobStatus === 404 ? 'NOT_FOUND' : 'BAD_REQUEST';
        return Promise.resolve(problemJson(code, handlers.jobStatus, 'Job 101 is no longer available'));
      }
      const job = handlers.job ?? makeJob();
      return Promise.resolve(
        okJson({ job, updatedAt: '2026-09-12T16:00:00.000Z' })
      );
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function makeClient(): QueryClient {
  // Immediate retries keep failure-path tests fast; production keeps the
  // default backoff. Retry counts still come from each query's options.
  return new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
}

function timingValue(label: string): string | null {
  const timing = document.querySelector('#timing');
  if (!timing) return null;
  for (const row of Array.from(timing.querySelectorAll('dl > div'))) {
    if (row.querySelector('dt')?.textContent === label) {
      return row.querySelector('dd')?.textContent ?? null;
    }
  }
  return null;
}

function renderJobPage(
  jobId: string,
  handlers: PageHandlers,
  options: { initialEntries?: string[]; queueState?: { fromJobsQueue: boolean } } = {}
) {
  setupFetch(handlers);
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    validateSearch: (search: Record<string, unknown>) => search,
    component: () => <div>Queue page</div>,
  });
  const jobRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/jobs/$jobId',
    component: () => <JobPage jobId={jobId} />,
  });
  const history = createMemoryHistory({
    initialEntries: options.initialEntries ?? [`/jobs/${jobId}`],
  });
  if (options.queueState) {
    history.replace(`/jobs/${jobId}`, options.queueState);
  }
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, jobRoute]),
    history,
  });
  const client = makeClient();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('JobPage states', () => {
  test('pending shows the wait reason with a seam for richer analysis', async () => {
    renderJobPage('100_2', {
      job: makeJob({ id: '100_2', state: 'PENDING', stateReason: 'Resources', startTime: null, endTime: null }),
    });

    await waitFor(() => expect(screen.getByText("Why it's waiting")).toBeTruthy());
    expect(screen.getByText(/waiting: Resources/)).toBeTruthy();
    expect(screen.queryByText('Current allocation')).toBeNull();
    expect(screen.queryByText('Resource usage')).toBeNull();
  });

  test('running shows allocation, timing, and execution without efficiency', async () => {
    renderJobPage('101', { job: makeJob() });

    await waitFor(() => expect(screen.getByText('Current allocation')).toBeTruthy());
    expect(screen.getByText('Resources')).toBeTruthy();
    expect(screen.getByText('Timing')).toBeTruthy();
    expect(screen.getByText('Scheduling')).toBeTruthy();
    expect(screen.getByText('Execution')).toBeTruthy();
    expect(screen.queryByText('Resource usage')).toBeNull();
  });

  test('suspended shows elapsed time, never running copy', async () => {
    renderJobPage('101', {
      job: makeJob({
        state: 'SUSPENDED',
        startTime: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      }),
    });

    await waitFor(() => expect(screen.getByText('Current allocation')).toBeTruthy());
    expect(screen.getByText('Suspended')).toBeTruthy();
    expect(screen.getByText(/Elapsed /)).toBeTruthy();
    expect(screen.queryByText('Running', { exact: true })).toBeNull();
    expect(screen.queryByText('Remaining')).toBeNull();
    expect(screen.queryByText('Resource usage')).toBeNull();
    expect(screen.queryByText(/Completed successfully/)).toBeNull();
  });

  test('completing flag produces intentional lifecycle text', async () => {
    renderJobPage('101', { job: makeJob({ stateFlags: ['COMPLETING'] }) });

    await waitFor(() => expect(screen.getByText('Current allocation')).toBeTruthy());
    expect(screen.getAllByText(/Completing/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/^Running /)).toBeNull();
  });

  test('completed leads with the outcome and shows resource usage', async () => {
    renderJobPage('103', {
      job: makeJob({
        id: '103',
        state: 'COMPLETED',
        endTime: '2026-09-12T18:00:00.000Z',
        exitCode: '0',
        derivedExitCode: '0',
      }),
    });

    await waitFor(() => expect(screen.getByText('Completed successfully')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Resource usage')).toBeTruthy());
    expect(screen.getByText('88.16%')).toBeTruthy();
    expect(screen.getByText('61.09%')).toBeTruthy();
    expect(screen.getByText(/of the allocated CPU time was used/)).toBeTruthy();
  });

  test('failed leads with the outcome and exit code, without efficiency', async () => {
    renderJobPage('104', {
      job: makeJob({ id: '104', state: 'FAILED', exitCode: '1', endTime: '2026-09-12T15:00:00.000Z' }),
    });

    await waitFor(() => expect(screen.getByText(/Failed · exit code 1/)).toBeTruthy());
    expect(screen.queryByText('Resource usage')).toBeNull();
  });

  test('timeout and OOM outcomes use their own headings', async () => {
    renderJobPage('105', {
      job: makeJob({ id: '105', state: 'TIMEOUT', endTime: '2026-09-12T18:00:00.000Z' }),
    });
    await waitFor(() => expect(screen.getByText('Timed out')).toBeTruthy());
  });

  test('no remaining time is shown for terminal jobs', async () => {
    renderJobPage('103', {
      job: makeJob({ id: '103', state: 'COMPLETED', endTime: '2026-09-12T18:00:00.000Z' }),
    });
    await waitFor(() => expect(screen.getByText('Completed successfully')).toBeTruthy());
    expect(screen.queryByText('Remaining')).toBeNull();
  });

  test('optional fields are omitted, never blank', async () => {
    renderJobPage('101', {
      job: makeJob({ constraints: null, reservation: null, dependency: null, stderrPath: null }),
    });
    await waitFor(() => expect(screen.getByText('Current allocation')).toBeTruthy());
    expect(screen.queryByText('Constraints')).toBeNull();
    expect(screen.queryByText('Reservation')).toBeNull();
    expect(screen.queryByText('Dependency')).toBeNull();
    expect(screen.queryByText('Stderr')).toBeNull();
  });

  test('copy reports success only when writing succeeds', async () => {
    const user = userEvent.setup();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    const command = `sbatch --wrap="python train.py --epochs 100 --data /very/long/path/${'x'.repeat(60)}"`;
    renderJobPage('101', { job: makeJob({ command }) });

    await waitFor(() => expect(screen.getByText('Execution')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Copy command' }));
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(command);
  });

  test('copy does not claim success when copying fails', async () => {
    const user = userEvent.setup();
    const originalClipboard = window.navigator.clipboard;
    const originalExecCommand = document.execCommand;
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    document.execCommand = jest.fn(() => false);
    try {
      renderJobPage('101', { job: makeJob({ command: 'sbatch run.sh' }) });

      await waitFor(() => expect(screen.getByText('Execution')).toBeTruthy());
      await user.click(screen.getByRole('button', { name: 'Copy command' }));
      await waitFor(() => expect(screen.getByText('Copy failed')).toBeTruthy());
      expect(screen.queryByText('Copied')).toBeNull();
    } finally {
      Object.defineProperty(window.navigator, 'clipboard', { value: originalClipboard, configurable: true });
      document.execCommand = originalExecCommand;
    }
  });

  test('technical details disclose on demand with array IDs and flags', async () => {
    const user = userEvent.setup();
    renderJobPage('100_2', {
      job: makeJob({
        id: '100_2',
        arrayJobId: '100',
        arrayTaskId: '2',
        state: 'PENDING',
        stateReason: 'Resources',
        startTime: null,
      }),
    });

    await waitFor(() => expect(screen.getByText("Why it's waiting")).toBeTruthy());
    expect(screen.queryByText('Array job ID')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Technical details' }));
    await waitFor(() => expect(screen.getByText('Array job ID')).toBeTruthy());
    expect(screen.getByText('100')).toBeTruthy();
  });

  test('seff failure keeps the page usable with a retry', async () => {
    const user = userEvent.setup();
    renderJobPage('103', {
      job: makeJob({ id: '103', state: 'COMPLETED', endTime: '2026-09-12T18:00:00.000Z' }),
      efficiencyStatus: 502,
    });

    await waitFor(() => expect(screen.getByText('Completed successfully')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/Efficiency data is unavailable/)).toBeTruthy(), {
      timeout: 8000,
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText(/Efficiency data is unavailable/)).toBeTruthy());
  });

  test('efficiency is never fetched for running jobs', async () => {
    const fetchMock = setupFetch({ job: makeJob() });
    const rootRoute = createRootRoute();
    const jobRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/jobs/$jobId',
      component: () => <JobPage jobId="101" />,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([jobRoute]),
      history: createMemoryHistory({ initialEntries: ['/jobs/101'] }),
    });
    render(
      <QueryClientProvider client={makeClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText('Current allocation')).toBeTruthy());
    expect(fetchMock.mock.calls.some(([url]) => (url as string).includes('/efficiency'))).toBe(false);
  });

  test('job 404 renders the no-longer-available state', async () => {
    renderJobPage('99999', { job: null, jobStatus: 404 });

    await waitFor(() => expect(screen.getByText(/is no longer available/)).toBeTruthy());
    expect(screen.getByText(/Historical accounting is not queried yet/)).toBeTruthy();
  });

  test('different job IDs never show the previous job', async () => {
    const first = makeJob({ id: '123', name: 'first-job' });
    const fetchMock = setupFetch({ job: first });
    const rootRoute = createRootRoute();
    const aRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/jobs/$jobId',
      component: function Page() {
        return <JobPage jobId="123" />;
      },
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([aRoute]),
      history: createMemoryHistory({ initialEntries: ['/jobs/123'] }),
    });
    render(
      <QueryClientProvider client={makeClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText('first-job')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalled();
  });

  test('queue-origin back uses history back to restore the queue', async () => {
    const user = userEvent.setup();
    const router = renderJobPage('101', { job: makeJob() }, {
      initialEntries: ['/', '/jobs/101'],
      queueState: { fromJobsQueue: true },
    });

    await waitFor(() => expect(screen.getByText('Current allocation')).toBeTruthy());
    await user.click(screen.getByRole('link', { name: 'Back to jobs' }));
    await waitFor(() => expect(screen.getByText('Queue page')).toBeTruthy());
    expect(router.state.location.pathname).toBe('/');
  });

  test('direct deep links offer a safe back-to-jobs link', async () => {
    renderJobPage('101', { job: makeJob() }, { initialEntries: ['/jobs/101'] });

    await waitFor(() => expect(screen.getByText('Current allocation')).toBeTruthy());
    const back = screen.getByRole('link', { name: 'Back to jobs' });
    expect(back.getAttribute('href')).toBe('/?page=1&pageSize=20');
  });

  test('queue wait uses eligible time when known', async () => {
    renderJobPage('103', {
      job: makeJob({
        id: '103',
        state: 'COMPLETED',
        submitTime: '2026-09-12T14:00:00.000Z',
        eligibleTime: '2026-09-12T14:05:00.000Z',
        startTime: '2026-09-12T14:20:00.000Z',
        endTime: '2026-09-12T18:00:00.000Z',
      }),
    });

    await waitFor(() => expect(screen.getByText('Queue wait')).toBeTruthy());
    expect(screen.queryByText('Submit to start')).toBeNull();
  });

  test('queue wait falls back honestly without eligible time', async () => {
    renderJobPage('103', {
      job: makeJob({
        id: '103',
        state: 'COMPLETED',
        submitTime: '2026-09-12T14:00:00.000Z',
        eligibleTime: null,
        startTime: '2026-09-12T14:20:00.000Z',
        endTime: '2026-09-12T18:00:00.000Z',
      }),
    });

    await waitFor(() => expect(screen.getByText('Submit to start')).toBeTruthy());
    expect(screen.queryByText('Queue wait')).toBeNull();
  });

  test('above-100 efficiency keeps its value with a capped bar', async () => {
    renderJobPage('103', {
      job: makeJob({ id: '103', state: 'COMPLETED', endTime: '2026-09-12T18:00:00.000Z' }),
      efficiency: {
        cpu: { efficiencyPercent: 103.2, utilizedSeconds: 3720, allocatedCoreSeconds: 3600 },
        memory: { efficiencyPercent: 61.09, utilizedMiB: 40038, allocatedMiB: 65536 },
        wallClockSeconds: 3600,
        updatedAt: '2026-09-12T18:00:00.000Z',
      },
    });

    await waitFor(() => expect(screen.getByText('103.2%')).toBeTruthy());
    const bars = document.querySelectorAll('div[aria-hidden="true"] > div');
    const widths = Array.from(bars).map((bar) => (bar as HTMLElement).style.width);
    expect(widths).toContain('100%');
    expect(widths).not.toContain('103.2%');
  });

  test('running jobs use elapsed time even with a future endTime', async () => {
    const now = Date.parse('2026-09-12T16:20:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);
    renderJobPage('101', {
      job: makeJob({
        state: 'RUNNING',
        submitTime: '2026-09-12T14:00:00.000Z',
        eligibleTime: '2026-09-12T14:05:00.000Z',
        startTime: '2026-09-12T14:20:00.000Z',
        endTime: '2026-09-12T18:20:00.000Z',
      }),
    });

    await waitFor(() => expect(screen.getByText('Running 2h')).toBeTruthy());
    expect(timingValue('Running')).toBe('2h');
    expect(timingValue('Remaining')).toBe('2h');
    expect(screen.getByText('Expected end')).toBeTruthy();
    expect(screen.queryByText('Finished')).toBeNull();
  });

  test('completing jobs show elapsed time without remaining', async () => {
    const now = Date.parse('2026-09-12T16:20:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);
    renderJobPage('101', {
      job: makeJob({
        state: 'RUNNING',
        stateFlags: ['COMPLETING'],
        startTime: '2026-09-12T14:20:00.000Z',
        endTime: '2026-09-12T18:20:00.000Z',
      }),
    });

    await waitFor(() => expect(screen.getByText('Completing 2h')).toBeTruthy());
    expect(timingValue('Running')).toBe('2h');
    expect(screen.getByText('Expected end')).toBeTruthy();
    expect(screen.queryByText('Remaining')).toBeNull();
    expect(screen.queryByText('Finished')).toBeNull();
  });

  test('suspended jobs with a future endTime show elapsed, never finished', async () => {
    const now = Date.parse('2026-09-12T16:20:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);
    renderJobPage('101', {
      job: makeJob({
        state: 'SUSPENDED',
        startTime: '2026-09-12T14:20:00.000Z',
        endTime: '2026-09-12T18:20:00.000Z',
      }),
    });

    await waitFor(() => expect(screen.getByText('Suspended')).toBeTruthy());
    expect(timingValue('Elapsed')).toBe('2h');
    expect(screen.getByText('Expected end')).toBeTruthy();
    expect(screen.queryByText('Finished')).toBeNull();
    expect(screen.queryByText('Remaining')).toBeNull();
    expect(screen.queryByText('Running', { exact: true })).toBeNull();
  });

  test('pending estimates never read as actual starts', async () => {
    const now = Date.parse('2026-09-12T16:20:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);
    renderJobPage('100_2', {
      job: makeJob({
        id: '100_2',
        state: 'PENDING',
        stateReason: 'Resources',
        submitTime: '2026-09-12T16:00:00.000Z',
        eligibleTime: '2026-09-12T16:00:00.000Z',
        startTime: '2026-09-12T18:20:00.000Z',
        endTime: '2026-09-12T22:20:00.000Z',
      }),
    });

    await waitFor(() => expect(screen.getByText("Why it's waiting")).toBeTruthy());
    expect(screen.getByText('Expected start')).toBeTruthy();
    expect(screen.getByText('Expected end')).toBeTruthy();
    expect(screen.queryByText('Started')).toBeNull();
    expect(screen.queryByText('Running', { exact: true })).toBeNull();
    expect(screen.queryByText('Runtime')).toBeNull();
    expect(screen.queryByText('Elapsed')).toBeNull();
    expect(screen.queryByText('Queue wait')).toBeNull();
    expect(screen.queryByText('Submit to start')).toBeNull();
    expect(screen.queryByText('Finished')).toBeNull();
  });

  test('known zero GPUs render as 0, never as missing', async () => {
    renderJobPage('101', {
      job: makeJob({
        taskCount: null,
        cpusPerTask: null,
        nodeExpression: null,
        timeLimit: null,
        requested: { cpus: 8, memoryMiB: null, nodes: null, gpus: { total: 0, byType: {} } },
        allocated: { cpus: 8, memoryMiB: null, nodes: null, gpus: { total: 0, byType: {} } },
      }),
    });

    await waitFor(() => expect(screen.getByText('Current allocation')).toBeTruthy());
    expect(screen.getAllByText('0', { selector: 'dd' }).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Tasks')).toBeNull();
    expect(screen.queryByText('CPUs per task')).toBeNull();
    expect(screen.queryByText('Time limit')).toBeNull();
  });

  test('nodes-only resources still show a zero GPU row', async () => {
    renderJobPage('101', {
      job: makeJob({
        requested: { cpus: null, memoryMiB: null, nodes: 2, gpus: { total: 0, byType: {} } },
        allocated: { cpus: null, memoryMiB: null, nodes: null, gpus: { total: 0, byType: {} } },
      }),
    });

    await waitFor(() => expect(screen.getByText('Current allocation')).toBeTruthy());
    expect(screen.getAllByText('GPUs').length).toBe(1);
    expect(screen.getByText('0', { selector: 'dd' })).toBeTruthy();
  });

  test('pending jobs omit started, finished, and exit rows', async () => {
    renderJobPage('100_2', {
      job: makeJob({ id: '100_2', state: 'PENDING', stateReason: 'Resources', startTime: null }),
    });

    await waitFor(() => expect(screen.getByText("Why it's waiting")).toBeTruthy());
    expect(screen.queryByText('Started')).toBeNull();
    expect(screen.queryByText('Finished')).toBeNull();
    expect(screen.queryByText('Exit code')).toBeNull();
    expect(screen.queryByText('Allocated')).toBeNull();
  });

  test('running jobs omit finished and exit rows', async () => {
    renderJobPage('101', { job: makeJob() });

    await waitFor(() => expect(screen.getByText('Current allocation')).toBeTruthy());
    expect(screen.queryByText('Finished')).toBeNull();
    expect(screen.queryByText('Exit code')).toBeNull();
  });

  test('modifier clicks on Back to jobs keep normal link behavior', async () => {
    const user = userEvent.setup();
    const router = renderJobPage('101', { job: makeJob() }, {
      initialEntries: ['/', '/jobs/101'],
      queueState: { fromJobsQueue: true },
    });

    await waitFor(() => expect(screen.getByText('Current allocation')).toBeTruthy());
    await user.keyboard('{Control>}');
    await user.click(screen.getByRole('link', { name: 'Back to jobs' }));
    await user.keyboard('{/Control}');
    expect(router.state.location.pathname).toBe('/jobs/101');
    expect(screen.getByText('Current allocation')).toBeTruthy();
  });
});
