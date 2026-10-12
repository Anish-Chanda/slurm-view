/** @jest-environment jsdom */
import { QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JobDto } from '../../src/shared/api/v1/jobs';
import type { ArrayOverviewDto, ArrayTasksResponse } from '../../src/shared/api/v1/jobs';
import { arrayTasksQueryOptions } from '../../src/client/api/array-tasks';
import { createTestQueryClient } from './test-query-client';
import { JobPage } from '../../src/client/features/job-details/JobPage';

function makeArrayJob(overrides: Partial<JobDto> = {}): JobDto {
  return {
    id: '100_2',
    jobId: '102',
    arrayJobId: '100',
    arrayTaskId: '2',
    partition: 'debug',
    name: 'array-sweep',
    user: 'alice',
    account: 'organization-a',
    qos: 'normal',
    state: 'PENDING',
    stateFlags: [],
    stateReason: 'Resources',
    timeLimit: { kind: 'finite', seconds: 3600 },
    submitTime: '2026-09-12T14:00:00.000Z',
    eligibleTime: '2026-09-12T14:05:00.000Z',
    startTime: null,
    endTime: null,
    priority: 100,
    taskCount: null,
    cpusPerTask: null,
    constraints: null,
    reservation: null,
    nodeCount: null,
    nodeExpression: null,
    requested: { cpus: 4, memoryMiB: 8192, nodes: 1, gpus: { total: 0, byType: {} } },
    allocated: { cpus: 4, memoryMiB: 8192, nodes: 1, gpus: { total: 0, byType: {} } },
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
    ...overrides,
  };
}

function makeArrayTasks(): ArrayTasksResponse {
  return {
    tasks: [
      { taskId: 1, state: 'COMPLETED', elapsedSeconds: 60, nodeExpression: 'node01', exitCode: '0' },
      { taskId: 2, state: 'PENDING', elapsedSeconds: null, nodeExpression: null, exitCode: null },
      { taskId: 3, state: 'RUNNING', elapsedSeconds: 120, nodeExpression: 'node02', exitCode: null },
      { taskId: 4, state: 'FAILED', elapsedSeconds: 30, nodeExpression: 'node03', exitCode: '1' },
      { taskId: 5, state: 'COMPLETED', elapsedSeconds: 90, nodeExpression: 'node01', exitCode: '0' },
    ],
  };
}

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

interface ArrayHandlers {
  job?: JobDto;
  arrayThrottle?: number | null;
  arrayOverview?: ArrayOverviewDto | null;
  arrayTasks?: ArrayTasksResponse | null;
  arrayStatus?: number;
}

const LIVE_OVERVIEW: ArrayOverviewDto = {
  runningTasks: 3,
  pendingTasks: 7,
  pendingReasons: [
    { reason: 'Resources', count: 4 },
    { reason: 'Priority', count: 2 },
    { reason: null, count: 1 },
  ],
};

const UI_SETTINGS_BODY = {
  charts: {
    cpu: { showSecondaryLayer: true },
    memory: { showSecondaryLayer: true },
    gpu: { showSecondaryLayer: true },
  },
  navbar: { enabled: true, title: 'Slurm View', color: '#1f2937' },
};

function setupFetch(handlers: ArrayHandlers) {
  const fetchMock = jest.fn((url: string) => {
    if (url.includes('/api/v1/ui-settings')) {
      return Promise.resolve(okJson(UI_SETTINGS_BODY));
    }
    if (url.includes('/pending-analysis')) {
      return Promise.resolve(okJson({ stateReason: 'Resources', analysis: null, updatedAt: '2026-09-12T16:00:00.000Z' }));
    }
    if (url.includes('/api/v1/jobs/') && url.includes('/array')) {
      if (handlers.arrayStatus && handlers.arrayStatus >= 400) {
        return Promise.resolve(problemJson('SLURM_UNAVAILABLE', handlers.arrayStatus, 'sacct unavailable'));
      }
      return Promise.resolve(okJson(handlers.arrayTasks ?? makeArrayTasks()));
    }
    if (url.includes('/api/v1/jobs/')) {
      const job = handlers.job ?? makeArrayJob();
      const arrayThrottle = handlers.arrayThrottle === undefined ? 2 : handlers.arrayThrottle;
      const arrayOverview = handlers.arrayOverview === undefined ? LIVE_OVERVIEW : handlers.arrayOverview;
      return Promise.resolve(
        okJson({ job, arrayThrottle, arrayOverview, updatedAt: '2026-09-12T16:00:00.000Z' })
      );
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderArrayPage(jobId: string, handlers: ArrayHandlers) {
  setupFetch(handlers);
  const rootRoute = createRootRoute();
  const jobRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/jobs/$jobId',
    component: () => <JobPage jobId={jobId} />,
  });
  const history = createMemoryHistory({ initialEntries: [`/jobs/${jobId}`] });
  const router = createRouter({ routeTree: rootRoute.addChildren([jobRoute]), history });
  const queryClient = createTestQueryClient({ retryDelay: 0 });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('ArrayExplorer', () => {
  test('array query options refresh about every 30s', () => {
    const options = arrayTasksQueryOptions('100') as Record<string, unknown>;
    expect(options.refetchInterval).toBe(30_000);
    expect(options.queryKey).toEqual(['jobs', 'array', { arrayJobId: '100' }]);
  });

  test('overview shows the array and throttle without duplicating task counts', async () => {
    renderArrayPage('100_2', {});

    const overview = await waitFor(() => screen.getByLabelText('Array overview'));
    expect(within(overview).getByText('Array overview')).toBeTruthy();
    expect(within(overview).getByText('Array 100')).toBeTruthy();
    expect(within(overview).getByText('Allows 2 at a time')).toBeTruthy();
    expect(within(overview).queryByText(/running/i)).toBeNull();
    expect(within(overview).queryByText(/pending/i)).toBeNull();

    expect(await screen.findByRole('button', { name: 'Completed 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Running 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pending 1' })).toBeTruthy();
  });

  test('overview omits concurrency when no throttle is available', async () => {
    renderArrayPage('100_2', { arrayThrottle: null });

    const overview = await waitFor(() => screen.getByLabelText('Array overview'));
    expect(within(overview).getByText('Array 100')).toBeTruthy();
    expect(within(overview).queryByText(/allows/i)).toBeNull();
    expect(within(overview).queryByText(/running/i)).toBeNull();
    expect(within(overview).queryByText(/pending/i)).toBeNull();
  });

  test('a missing live overview does not hide the task map', async () => {
    renderArrayPage('100_2', { arrayOverview: null });

    await waitFor(() => expect(screen.getByLabelText('Array overview')).toBeTruthy());
    expect(await screen.findByLabelText('Tasks in numeric order')).toBeTruthy();
  });

  test('the opened task is selected by default with its details in place', async () => {
    renderArrayPage('100_2', {});

    const inspector = await waitFor(() => screen.getByLabelText('Selected array task'));
    expect(within(inspector).getByText('100_2')).toBeTruthy();
    expect(within(inspector).getByText('PENDING')).toBeTruthy();
  });

  test('clicking a task selects it without navigating', async () => {
    const user = userEvent.setup();
    renderArrayPage('100_2', {});

    await waitFor(() => expect(screen.getByLabelText('Tasks in numeric order')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Task 4, FAILED' }));

    const inspector = screen.getByLabelText('Selected array task');
    expect(within(inspector).getByText('100_4')).toBeTruthy();
    expect(within(inspector).getByText('FAILED')).toBeTruthy();
    expect(within(inspector).getByText('30s')).toBeTruthy();
    expect(within(inspector).getByText('node03')).toBeTruthy();
    expect(screen.getByText('array-sweep')).toBeTruthy();
  });

  test('problem states are broken down when present', async () => {
    renderArrayPage('100_2', {});

    await waitFor(() => expect(screen.getByText('FAILED ×1')).toBeTruthy());
  });

  test('filters dim instead of removing or reordering tasks', async () => {
    const user = userEvent.setup();
    renderArrayPage('100_2', {});

    await waitFor(() => expect(screen.getByLabelText('Tasks in numeric order')).toBeTruthy());
    const map = screen.getByLabelText('Tasks in numeric order');
    await user.click(screen.getByRole('button', { name: 'Completed 2' }));

    const cells = within(map).getAllByRole('button');
    expect(cells.map((cell) => cell.textContent)).toEqual(['1', '2', '3', '4', '5']);
    expect(screen.getByRole('button', { name: 'Task 1, COMPLETED' }).className).toContain('opacity-30');
    expect(screen.getByRole('button', { name: 'Task 3, RUNNING' }).className).not.toContain('opacity-30');
  });

  test('suspended and unknown tasks belong to the problem group', async () => {
    const user = userEvent.setup();
    renderArrayPage('100_2', {
      arrayTasks: {
        tasks: [
          { taskId: 1, state: 'COMPLETED', elapsedSeconds: 60, nodeExpression: 'node01', exitCode: '0' },
          { taskId: 2, state: 'SUSPENDED', elapsedSeconds: 10, nodeExpression: 'node02', exitCode: null },
          { taskId: 3, state: 'UNKNOWN', elapsedSeconds: null, nodeExpression: null, exitCode: null },
          { taskId: 4, state: 'FAILED', elapsedSeconds: 30, nodeExpression: 'node03', exitCode: '1' },
        ],
      },
    });

    await waitFor(() => expect(screen.getByLabelText('Tasks in numeric order')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Failed 3' })).toBeTruthy();
    expect(screen.getByText(/FAILED ×1/)).toBeTruthy();
    expect(screen.getByText(/SUSPENDED ×1/)).toBeTruthy();
    expect(screen.getByText(/UNKNOWN ×1/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Failed 3' }));
    expect(screen.getByRole('button', { name: 'Task 2, SUSPENDED' }).className).toContain('opacity-30');
    expect(screen.getByRole('button', { name: 'Task 1, COMPLETED' }).className).not.toContain('opacity-30');
  });

  test('binned mode dims fully filtered bins and colors mixed bins by dominance', async () => {
    const user = userEvent.setup();
    const tasks: ArrayTasksResponse = {
      tasks: Array.from({ length: 1200 }, (_, index) => ({
        taskId: index + 1,
        state: index < 600 ? ('COMPLETED' as const) : ('FAILED' as const),
        elapsedSeconds: (index + 1) * 10,
        nodeExpression: 'node01',
        exitCode: index < 600 ? '0' : '1',
      })),
    };
    renderArrayPage('100_2', { arrayTasks: tasks });

    const map = await waitFor(() => screen.getByLabelText('Task bins in numeric order'));
    const bins = within(map).getAllByRole('button');
    await user.click(screen.getByRole('button', { name: 'Completed 600' }));

    const rerendered = screen.getByLabelText('Task bins in numeric order');
    const rerenderedBins = within(rerendered).getAllByRole('button');
    expect(rerenderedBins[0].className).toContain('opacity-30');
    const lastBin = rerenderedBins[rerenderedBins.length - 1];
    expect(lastBin.className).not.toContain('opacity-30');
    expect(lastBin.className).toContain('bg-red-200');
    expect(lastBin.className).not.toContain('bg-gray-300');
  });

  test('large arrays are binned with interaction instead of unbounded cells', async () => {
    const user = userEvent.setup();
    const tasks: ArrayTasksResponse = {
      tasks: Array.from({ length: 1200 }, (_, index) => ({
        taskId: index + 1,
        state: index % 10 === 0 ? ('FAILED' as const) : ('COMPLETED' as const),
        elapsedSeconds: (index + 1) * 10,
        nodeExpression: 'node01',
        exitCode: index % 10 === 0 ? '1' : '0',
      })),
    };
    renderArrayPage('100_2', { arrayTasks: tasks });

    const expandedLabel = await waitFor(() => screen.getByText(/Tasks 1–35 in numeric order/));
    expect(expandedLabel).toBeTruthy();
    const map = screen.getByLabelText('Task bins in numeric order');
    const binButtons = within(map).getAllByRole('button');
    expect(binButtons.length).toBeLessThan(100);
    const expandedCells = within(screen.getByLabelText('Tasks 1 to 35')).getAllByRole('button');
    expect(expandedCells).toHaveLength(35);

    await user.click(screen.getByRole('button', { name: 'Task 11, FAILED' }));
    const inspector = screen.getByLabelText('Selected array task');
    expect(within(inspector).getByText('100_11')).toBeTruthy();
    expect(within(inspector).getByText('FAILED')).toBeTruthy();
  });

  test('array failure keeps the array overview with a neutral notice', async () => {
    renderArrayPage('100_2', { arrayStatus: 503 });

    const overview = await waitFor(() => screen.getByLabelText('Array overview'));
    expect(within(overview).getByText('Array overview')).toBeTruthy();
    expect(within(overview).getByText('Array 100')).toBeTruthy();
    expect(within(overview).getByText('Allows 2 at a time')).toBeTruthy();
    expect(within(overview).queryByText(/running/i)).toBeNull();
    expect(within(overview).queryByText(/pending/i)).toBeNull();

    await waitFor(() =>
      expect(screen.getByText('Array task history is not available on this cluster.')).toBeTruthy()
    );
    expect(screen.queryByLabelText('Tasks in numeric order')).toBeNull();
    expect(screen.queryByLabelText('Selected array task')).toBeNull();
  });

  test('non-array jobs render no array UI', async () => {
    const plain: JobDto = makeArrayJob({
      id: '101',
      jobId: '101',
      arrayJobId: null,
      arrayTaskId: null,
      state: 'RUNNING',
      stateReason: null,
      startTime: '2026-09-12T14:20:00.000Z',
    });
    renderArrayPage('101', { job: plain, arrayThrottle: null, arrayOverview: null });

    await waitFor(() => expect(screen.getByText('Resources')).toBeTruthy());
    expect(screen.queryByLabelText('Array overview')).toBeNull();
    expect(screen.queryByLabelText('Array task map')).toBeNull();
  });
});
