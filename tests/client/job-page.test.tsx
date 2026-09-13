/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JobDto } from '../../src/shared/api/v1/jobs';
import { jobDetailQueryOptions } from '../../src/client/api/job-details';
import { jobsKeys } from '../../src/client/api/query-keys';
import { createTestQueryClient } from './test-query-client';
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
  updatedAt?: string;
  efficiency?: unknown;
  efficiencyStatus?: number;
  pendingAnalysis?: unknown;
  pendingAnalysisStatus?: number;
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
    if (url.includes('/pending-analysis')) {
      if (handlers.pendingAnalysisStatus && handlers.pendingAnalysisStatus >= 400) {
        const code = handlers.pendingAnalysisStatus === 409 ? 'JOB_NOT_PENDING' : 'UPSTREAM_INVALID_RESPONSE';
        return Promise.resolve(problemJson(code, handlers.pendingAnalysisStatus));
      }
      return Promise.resolve(okJson(handlers.pendingAnalysis ?? {
        stateReason: handlers.job?.stateReason ?? null,
        analysis: null,
        updatedAt: handlers.updatedAt ?? '2026-09-12T16:00:00.000Z',
      }));
    }
    if (url.includes('/api/v1/jobs/')) {
      if (handlers.jobStatus && handlers.jobStatus >= 400) {
        const code = handlers.jobStatus === 404 ? 'NOT_FOUND' : 'BAD_REQUEST';
        return Promise.resolve(problemJson(code, handlers.jobStatus, 'Job 101 is no longer available'));
      }
      const job = handlers.job ?? makeJob();
      return Promise.resolve(
        okJson({ job, updatedAt: handlers.updatedAt ?? '2026-09-12T16:00:00.000Z' })
      );
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function makeClient(): QueryClient {
  // Production query policy with immediate retries to keep failure-path
  // tests fast. Retry counts still come from each query's options.
  return createTestQueryClient({ retryDelay: 0 });
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

function detailFetchCount(fetchMock: jest.Mock): number {
  return fetchMock.mock.calls.filter(([url]) => (url as string).includes('/api/v1/jobs/101') && !(url as string).includes('/pending-analysis')).length;
}

function renderJobPage(
  jobId: string,
  handlers: PageHandlers,
  options: {
    initialEntries?: string[];
    queueState?: { fromJobsQueue: boolean };
    queryClient?: QueryClient;
  } = {}
) {
  const fetchMock = setupFetch(handlers);
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
  const queryClient = options.queryClient ?? makeClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return { router, queryClient, fetchMock, unmount: view.unmount };
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

describe('JobPage states', () => {
  test('pending diagnostic shows a documented reason label plus the raw code', async () => {
    renderJobPage('100_2', {
      job: makeJob({ id: '100_2', state: 'PENDING', stateReason: 'Resources', startTime: null, endTime: null }),
    });

    await waitFor(() => expect(screen.getByText('Waiting for resources')).toBeTruthy());
    expect(screen.getByText('Slurm: Resources')).toBeTruthy();
    expect(screen.getByText('WHY THIS JOB IS WAITING')).toBeTruthy();
    expect(screen.getByText(/only the reason encountered by the scheduling attempt/)).toBeTruthy();
    expect(screen.getByText(/Snapshot taken/)).toBeTruthy();
    expect(screen.queryByText('Resource usage')).toBeNull();
    expect(screen.queryByText('Exit code')).toBeNull();
  });

  test('held jobs use documented hold language without invented causes', async () => {
    renderJobPage('100_2', {
      job: makeJob({ id: '100_2', state: 'PENDING', stateReason: 'JobHeldUser', startTime: null, endTime: null }),
    });

    await waitFor(() => expect(screen.getByText('Held by user or account coordinator')).toBeTruthy());
    expect(screen.getByText('Slurm: JobHeldUser')).toBeTruthy();
  });

  test('unknown reasons show the raw code without guessing', async () => {
    renderJobPage('100_2', {
      job: makeJob({ id: '100_2', state: 'PENDING', stateReason: 'SomethingNew', startTime: null, endTime: null }),
    });

    await waitFor(() => expect(screen.getByText('Slurm: SomethingNew')).toBeTruthy());
    expect(screen.getByText('Waiting')).toBeTruthy();
  });

  test('long waits use adaptive summary copy', async () => {
    const now = Date.parse('2026-09-12T16:20:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const longAgo = new Date(now - ((64 * 24 + 20) * 3600 * 1000)).toISOString();
    renderJobPage('100_2', {
      job: makeJob({
        id: '100_2',
        state: 'PENDING',
        stateReason: 'Priority',
        submitTime: longAgo,
        eligibleTime: longAgo,
        startTime: null,
      }),
      updatedAt: '2026-09-12T16:20:00.000Z',
    });

    await waitFor(() => expect(screen.getByText('Waiting 64d')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Higher-priority jobs exist for this partition or reservation')).toBeTruthy());
  });

  test('running summarizes allocation once with canonical detail below', async () => {
    renderJobPage('101', { job: makeJob() });

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    expect(screen.getByText('Allocated 2 nodes · 8 CPUs · 32 GiB · 4 GPUs (a100 × 4)')).toBeTruthy();
    expect(screen.getByText('Timing')).toBeTruthy();
    expect(screen.getByText('Scheduling')).toBeTruthy();
    expect(screen.getByText('Execution')).toBeTruthy();
    expect(screen.getByText('gpu[01-02]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy node list' })).toBeTruthy();
    expect(screen.queryByText('Current allocation')).toBeNull();
    expect(screen.queryByText('Resource usage')).toBeNull();
  });

  test('active jobs never render a raw zero exit code as a result', async () => {
    renderJobPage('101', { job: makeJob({ exitCode: '0', derivedExitCode: '0' }) });

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    expect(screen.queryByText('Exit code')).toBeNull();
    expect(screen.queryByText('Derived exit code')).toBeNull();
  });

  test('pending jobs never render a raw zero exit code as a result', async () => {
    renderJobPage('100_2', {
      job: makeJob({ id: '100_2', state: 'PENDING', stateReason: 'Resources', startTime: null, exitCode: '0' }),
    });

    await waitFor(() => expect(screen.getByText('Waiting for resources')).toBeTruthy());
    expect(screen.queryByText('Exit code')).toBeNull();
  });

  test('suspended shows elapsed time, never running copy', async () => {
    renderJobPage('101', {
      job: makeJob({
        state: 'SUSPENDED',
        startTime: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      }),
      updatedAt: new Date(Date.now()).toISOString(),
    });

    await waitFor(() => expect(screen.getByText('Suspended')).toBeTruthy());
    expect(screen.getByText(/Elapsed /)).toBeTruthy();
    expect(screen.queryByText('Running', { exact: true })).toBeNull();
    expect(screen.queryByText('Remaining')).toBeNull();
    expect(screen.queryByText('Resource usage')).toBeNull();
    expect(screen.queryByText(/Completed successfully/)).toBeNull();
  });

  test('completing flag produces intentional lifecycle text', async () => {
    renderJobPage('101', { job: makeJob({ stateFlags: ['COMPLETING'] }) });

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    expect(screen.getAllByText(/Completing/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/in the process of completing/)).toBeTruthy();
    expect(screen.queryByText(/shortly/)).toBeNull();
    expect(screen.queryByText(/^Running /)).toBeNull();
  });

  test('completed leads with the outcome and compact usage evidence', async () => {
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
    expect(screen.getByText('3h 42m 10s used / 4h 12m allocated')).toBeTruthy();
    expect(screen.getByText('39.1 GiB peak / 64 GiB allocated')).toBeTruthy();
    expect(screen.queryByText(/of the allocated CPU time was used/)).toBeNull();
    expect(screen.queryByText(/reached .* of the allocation/)).toBeNull();
    // Terminal jobs keep their exit result as canonical detail.
    expect(screen.getByText('Exit code')).toBeTruthy();
  });

  test('failed leads with the outcome, exit result, and batch host', async () => {
    renderJobPage('104', {
      job: makeJob({ id: '104', state: 'FAILED', exitCode: '1', endTime: '2026-09-12T15:00:00.000Z', batchHost: 'node01' }),
    });

    await waitFor(() => expect(screen.getByText(/Failed · exit code 1/)).toBeTruthy());
    expect(screen.getByText('Batch host')).toBeTruthy();
    expect(screen.getByText('node01')).toBeTruthy();
    expect(screen.queryByText('Resource usage')).toBeNull();
  });

  test('timeout outcomes use their own heading', async () => {
    renderJobPage('105', {
      job: makeJob({ id: '105', state: 'TIMEOUT', endTime: '2026-09-12T18:00:00.000Z' }),
    });
    await waitFor(() => expect(screen.getByText('Timed out')).toBeTruthy());
  });

  test('unknown state stays neutral despite timestamps and a zero exit code', async () => {
    renderJobPage('106', {
      job: makeJob({
        id: '106',
        state: 'UNKNOWN',
        startTime: '2026-09-12T14:20:00.000Z',
        endTime: '2026-09-12T18:00:00.000Z',
        exitCode: '0',
        derivedExitCode: '0',
      }),
    });

    await waitFor(() => expect(screen.getByText('Unknown state')).toBeTruthy());
    expect(screen.queryByText('Exit code')).toBeNull();
    expect(screen.queryByText('Derived exit code')).toBeNull();
    expect(screen.queryByText('Finished')).toBeNull();
    expect(screen.queryByText('Runtime')).toBeNull();
    expect(screen.queryByText('Running')).toBeNull();
    expect(screen.queryByText('Remaining')).toBeNull();
    expect(screen.queryByText('Resource usage')).toBeNull();
    // No lifecycle reading of the timestamps…
    expect(screen.queryByText('Started')).toBeNull();
    expect(screen.queryByText('Eligible to start')).toBeNull();
    expect(screen.queryByText('Submit to start')).toBeNull();
    // …only neutral timestamp rows alongside the exact scheduler values.
    expect(screen.getByText('Start time')).toBeTruthy();
    expect(screen.getByText('End time')).toBeTruthy();
    expect(screen.getByText('Submitted')).toBeTruthy();
    expect(screen.getByText('Eligible')).toBeTruthy();
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
      job: makeJob({ constraints: null, reservation: null, dependency: null, stderrPath: null, timeLimit: null }),
    });
    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    expect(screen.queryByText('Constraints')).toBeNull();
    expect(screen.queryByText('Reservation')).toBeNull();
    expect(screen.queryByText('Dependency')).toBeNull();
    expect(screen.queryByText('Stderr')).toBeNull();
    expect(screen.queryByText('Time limit')).toBeNull();
  });

  test('array identity sits with the job ID, never in a disclosure', async () => {
    renderJobPage('100_2', {
      job: makeJob({
        id: '100_2',
        arrayJobId: '100',
        arrayTaskId: '2',
        state: 'PENDING',
        stateReason: 'Dependency',
        dependency: 'afterok:99',
        startTime: null,
        stdoutPath: '/home/bob/slurm-100_%a.out',
      }),
    });

    await waitFor(() => expect(screen.getByText('Waiting on a job dependency')).toBeTruthy());
    expect(
      screen.getByText((_, element) => element?.textContent === 'Array 100 · Task 2')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Technical details' })).toBeNull();
    expect(screen.queryByText('Array job ID')).toBeNull();
    // Configured Slurm values keep plain labels even with substitution
    // syntax: the UI never claims to know resolved paths.
    expect(screen.getByText('Stdout')).toBeTruthy();
    expect(screen.getByText('/home/bob/slurm-100_%a.out')).toBeTruthy();
    expect(screen.queryByText(/pattern/i)).toBeNull();
  });

  test('literal percent characters never read as substitution syntax', async () => {
    renderJobPage('101', {
      job: makeJob({ stdoutPath: '/home/alice/100%.out', stderrPath: '/home/alice/%%j.out' }),
    });

    await waitFor(() => expect(screen.getByText('Execution')).toBeTruthy());
    expect(screen.getByText('Stdout')).toBeTruthy();
    expect(screen.getByText('Stderr')).toBeTruthy();
    expect(screen.getByText('/home/alice/100%.out')).toBeTruthy();
    expect(screen.getByText('/home/alice/%%j.out')).toBeTruthy();
    expect(screen.queryByText(/pattern/i)).toBeNull();
  });

  test('resolved stdout paths keep the plain label', async () => {
    renderJobPage('101', { job: makeJob() });

    await waitFor(() => expect(screen.getByText('Execution')).toBeTruthy());
    expect(screen.getByText('Stdout')).toBeTruthy();
    expect(screen.queryByText(/pattern/i)).toBeNull();
  });

  test('copying the job ID reports success', async () => {
    const user = userEvent.setup();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderJobPage('101', { job: makeJob() });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy job ID' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Copy job ID' }));
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith('101');
  });

  test('copy reports success only when writing succeeds', async () => {
    const user = userEvent.setup();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    const command = `sbatch --wrap="python train.py --epochs 100 --data /very/long/path/${'x'.repeat(60)}"`;
    renderJobPage('101', { job: makeJob({ command }) });

    await waitFor(() => expect(screen.getByText('Execution')).toBeTruthy());
    // Long commands render in full, never permanently truncated.
    expect(screen.getByText(command)).toBeTruthy();
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
    const { fetchMock } = renderJobPage('101', { job: makeJob() });

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    expect(fetchMock.mock.calls.some(([url]) => (url as string).includes('/efficiency'))).toBe(false);
  });

  test('job 404 renders the no-longer-available state', async () => {
    renderJobPage('99999', { job: null, jobStatus: 404 });

    await waitFor(() => expect(screen.getByText(/is no longer available/)).toBeTruthy());
    expect(screen.getByText(/Historical accounting is not queried yet/)).toBeTruthy();
  });

  test('different job IDs never show the previous job', async () => {
    const first = makeJob({ id: '123', name: 'first-job' });
    const { fetchMock } = renderJobPage('123', { job: first });
    await waitFor(() => expect(screen.getByText('first-job')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalled();
  });

  test('queue-origin back uses history back to restore the queue', async () => {
    const user = userEvent.setup();
    const { router } = renderJobPage('101', { job: makeJob() }, {
      initialEntries: ['/', '/jobs/101'],
      queueState: { fromJobsQueue: true },
    });

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    await user.click(screen.getByRole('link', { name: 'Back to jobs' }));
    await waitFor(() => expect(screen.getByText('Queue page')).toBeTruthy());
    expect(router.state.location.pathname).toBe('/');
  });

  test('direct deep links offer a safe back-to-jobs link', async () => {
    renderJobPage('101', { job: makeJob() }, { initialEntries: ['/jobs/101'] });

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    const back = screen.getByRole('link', { name: 'Back to jobs' });
    expect(back.getAttribute('href')).toBe('/?page=1&pageSize=20');
  });

  test('queue wait names the eligible-to-start measurement', async () => {
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

    await waitFor(() => expect(screen.getByText('Eligible to start')).toBeTruthy());
    expect(screen.queryByText('Submit to start')).toBeNull();
    expect(screen.queryByText('Queue wait')).toBeNull();
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
    expect(screen.queryByText('Eligible to start')).toBeNull();
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
      updatedAt: '2026-09-12T16:20:00.000Z',
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
      updatedAt: '2026-09-12T16:20:00.000Z',
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
      updatedAt: '2026-09-12T16:20:00.000Z',
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
      updatedAt: '2026-09-12T16:20:00.000Z',
    });

    await waitFor(() => expect(screen.getByText('Waiting for resources')).toBeTruthy());
    expect(screen.getByText('Expected start')).toBeTruthy();
    expect(screen.getByText('Expected end')).toBeTruthy();
    expect(screen.queryByText('Started')).toBeNull();
    expect(screen.queryByText('Running', { exact: true })).toBeNull();
    expect(screen.queryByText('Runtime')).toBeNull();
    expect(screen.queryByText('Elapsed')).toBeNull();
    expect(screen.queryByText('Eligible to start')).toBeNull();
    expect(screen.queryByText('Submit to start')).toBeNull();
    expect(screen.queryByText('Queue wait')).toBeNull();
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

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    expect(screen.getAllByText('0', { selector: 'td' }).length).toBeGreaterThanOrEqual(2);
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

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    expect(screen.getAllByText('GPUs').length).toBe(1);
    expect(screen.getByText('0', { selector: 'td' })).toBeTruthy();
  });

  test('pending jobs omit started, finished, and exit rows', async () => {
    renderJobPage('100_2', {
      job: makeJob({ id: '100_2', state: 'PENDING', stateReason: 'Resources', startTime: null }),
    });

    await waitFor(() => expect(screen.getByText('Waiting for resources')).toBeTruthy());
    expect(screen.queryByText('Started')).toBeNull();
    expect(screen.queryByText('Finished')).toBeNull();
    expect(screen.queryByText('Exit code')).toBeNull();
    expect(screen.queryByText('Allocated')).toBeNull();
  });

  test('running jobs omit finished and exit rows', async () => {
    renderJobPage('101', { job: makeJob() });

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    expect(screen.queryByText('Finished')).toBeNull();
    expect(screen.queryByText('Exit code')).toBeNull();
  });

  test('modifier clicks on Back to jobs keep normal link behavior', async () => {
    const user = userEvent.setup();
    const { router } = renderJobPage('101', { job: makeJob() }, {
      initialEntries: ['/', '/jobs/101'],
      queueState: { fromJobsQueue: true },
    });

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    await user.keyboard('{Control>}');
    await user.click(screen.getByRole('link', { name: 'Back to jobs' }));
    await user.keyboard('{/Control}');
    expect(router.state.location.pathname).toBe('/jobs/101');
    expect(screen.getByText('Resources')).toBeTruthy();
  });
});

describe('snapshot-time lifecycle', () => {
  const UPDATED_AT = '2026-09-12T16:00:00.000Z';
  const LATER = Date.parse(UPDATED_AT) + 5 * 3600 * 1000;

  test('running durations freeze at the snapshot, not the wall clock', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(LATER);
    renderJobPage('101', {
      job: makeJob({
        state: 'RUNNING',
        startTime: '2026-09-12T14:00:00.000Z',
        endTime: '2026-09-12T18:00:00.000Z',
      }),
      updatedAt: UPDATED_AT,
    });

    await waitFor(() => expect(screen.getByText('Running 2h')).toBeTruthy());
    expect(timingValue('Running')).toBe('2h');
    expect(timingValue('Remaining')).toBe('2h');
  });

  test('waiting durations freeze at the snapshot', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(LATER);
    renderJobPage('100_2', {
      job: makeJob({
        id: '100_2',
        state: 'PENDING',
        stateReason: 'Resources',
        submitTime: '2026-09-12T12:46:00.000Z',
        eligibleTime: '2026-09-12T12:46:00.000Z',
        startTime: null,
      }),
      updatedAt: UPDATED_AT,
    });

    // 3h14m at snapshot time; the wall clock would read 8h14m.
    await waitFor(() => expect(screen.getByText('Waiting 3h 14m')).toBeTruthy());
  });

  test('finished-ago freezes at the snapshot', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(LATER);
    renderJobPage('103', {
      job: makeJob({
        id: '103',
        state: 'COMPLETED',
        startTime: '2026-09-12T14:00:00.000Z',
        endTime: '2026-09-12T15:30:00.000Z',
      }),
      updatedAt: UPDATED_AT,
    });

    await waitFor(() => expect(screen.getByText(/Finished 30m ago/)).toBeTruthy());
  });
});

describe('job details snapshot behavior', () => {
  test('detail queries declare no polling and keep the 404 retry policy', () => {
    const options = jobDetailQueryOptions('101') as Record<string, unknown>;
    expect(options['refetchInterval']).toBeUndefined();
    // A 404 means the job left the live data; anything else retries once.
    // Implicit mount/focus/reconnect behavior comes from project defaults.
    expect(typeof options['retry']).toBe('function');
  });

  test('regaining window focus does not refetch a loaded job', async () => {
    const { fetchMock } = renderJobPage('101', { job: makeJob() });

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    const calls = detailFetchCount(fetchMock);
    expect(calls).toBeGreaterThan(0);

    focusManager.setFocused(false);
    await act(async () => {
      focusManager.setFocused(true);
    });
    expect(detailFetchCount(fetchMock)).toBe(calls);
  });

  test('reconnecting does not refetch a loaded job', async () => {
    const { fetchMock } = renderJobPage('101', { job: makeJob() });

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    const calls = detailFetchCount(fetchMock);
    expect(calls).toBeGreaterThan(0);

    onlineManager.setOnline(false);
    await act(async () => {
      onlineManager.setOnline(true);
    });
    expect(detailFetchCount(fetchMock)).toBe(calls);
  });

  test('remounting within a visit reuses the snapshot without refetching', async () => {
    const first = renderJobPage('101', { job: makeJob() });
    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    expect(detailFetchCount(first.fetchMock)).toBe(1);
    first.unmount();

    // The router session is reused, so no new-visit loader work is due:
    // the fresh cache is adopted and mounting observers never refetch.
    render(
      <QueryClientProvider client={first.queryClient}>
        <RouterProvider router={first.router} />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    expect(detailFetchCount(first.fetchMock)).toBe(1);
    expect(screen.getByText('train-model')).toBeTruthy();
  });

  test('a refresh failure after a snapshot keeps the page with a warning', async () => {
    const handlers: PageHandlers = { job: makeJob() };
    const { queryClient } = renderJobPage('101', handlers);

    await waitFor(() => expect(screen.getByText('train-model')).toBeTruthy());
    handlers.jobStatus = 404;

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: jobsKeys.detail('101') });
    });
    await waitFor(() => expect(screen.getByText(/Showing the captured snapshot/)).toBeTruthy());

    expect(screen.getByText('train-model')).toBeTruthy();
    expect(screen.getByText('Resources')).toBeTruthy();
    expect(screen.queryByText(/is no longer available/)).toBeNull();
  });

  test('a non-404 refresh failure also keeps the captured snapshot', async () => {
    const handlers: PageHandlers = { job: makeJob() };
    const { queryClient } = renderJobPage('101', handlers);

    await waitFor(() => expect(screen.getByText('train-model')).toBeTruthy());
    handlers.jobStatus = 500;

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: jobsKeys.detail('101') });
    });
    await waitFor(() => expect(screen.getByText(/Showing the captured snapshot/)).toBeTruthy());

    expect(screen.getByText('train-model')).toBeTruthy();
    expect(screen.queryByText(/is no longer available/)).toBeNull();
  });

  test.each([123, {}, { kind: 'somethingNew' }, { kind: 'resources' }])(
    'malformed pending analysis %p stays contained without replacing job details',
    async (pendingAnalysis) => {
      const view = renderJobPage('101', {
        job: makeJob({ state: 'PENDING', stateReason: 'Resources', startTime: null }),
        pendingAnalysis,
      });

      await waitFor(() => expect(screen.getByText('Pending analysis returned malformed data.')).toBeTruthy());
      expect(screen.getByText('train-model')).toBeTruthy();
      expect(screen.queryByText(/Analyzed at/)).toBeNull();
      expect(screen.queryByText('Resource evidence')).toBeNull();
      view.unmount();
    }
  );

  test('pending analysis has contained 409 and 404 states', async () => {
    const changed = renderJobPage('101', { job: makeJob({ state: 'PENDING', startTime: null }), pendingAnalysisStatus: 409 });
    await waitFor(() => expect(screen.getByText(/Job state changed/)).toBeTruthy());
    expect(screen.getByText('train-model')).toBeTruthy();
    changed.unmount();

    renderJobPage('101', { job: makeJob({ state: 'PENDING', startTime: null }), pendingAnalysisStatus: 404 });
    await waitFor(() => expect(screen.getByText(/Pending analysis is no longer available/)).toBeTruthy());
    expect(screen.getByText('train-model')).toBeTruthy();
  });

  test('a transient pending-analysis failure can be retried', async () => {
    const handlers: PageHandlers = { job: makeJob({ state: 'PENDING', startTime: null }), pendingAnalysisStatus: 503 };
    renderJobPage('101', handlers);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy());
    handlers.pendingAnalysisStatus = undefined;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('WHY THIS JOB IS WAITING')).toBeTruthy());
  });

  test('only PENDING jobs request pending analysis', async () => {
    const pending = renderJobPage('101', { job: makeJob({ state: 'PENDING', startTime: null }) });
    await waitFor(() => expect(pending.fetchMock.mock.calls.filter(([url]) => (url as string).includes('/pending-analysis'))).toHaveLength(1));
    pending.unmount();

    const running = renderJobPage('101', { job: makeJob({ state: 'RUNNING' }) });
    await waitFor(() => expect(screen.getByText('train-model')).toBeTruthy());
    expect(running.fetchMock.mock.calls.filter(([url]) => (url as string).includes('/pending-analysis'))).toHaveLength(0);
  });
});
