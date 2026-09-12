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
import { JobsSection } from '../../src/client/features/jobs/JobsSection';
import { parseDashboardSearch } from '../../src/client/features/jobs/jobs-search';

interface JobOverrides {
  id?: string;
  partition?: string | null;
  name?: string | null;
  user?: string | null;
  account?: string | null;
  state?: string;
  stateReason?: string | null;
  nodeCount?: number | null;
}

function makeJob(overrides: JobOverrides = {}): Record<string, unknown> {
  return {
    id: '101',
    jobId: '101',
    arrayJobId: null,
    arrayTaskId: null,
    partition: 'gpu',
    name: 'train-model',
    user: 'alice',
    account: 'lab',
    qos: null,
    state: 'RUNNING',
    stateFlags: [],
    stateReason: null,
    timeLimit: { kind: 'finite', seconds: 7200 },
    submitTime: '2026-09-09T10:00:00.000Z',
    startTime: '2026-09-09T10:05:00.000Z',
    endTime: null,
    nodeCount: 2,
    nodeExpression: 'gpu[01-02]',
    requested: { cpus: 8, memoryMiB: 32768, gpus: { total: 2, byType: { a100: 2 } } },
    allocated: { cpus: 8, memoryMiB: 32768, nodes: 2, gpus: { total: 2, byType: { a100: 2 } } },
    workdir: null,
    command: null,
    stdoutPath: null,
    dependency: null,
    exitCode: null,
    derivedExitCode: null,
    flags: [],
    ...overrides,
  };
}

function jobsPage(ids: string[], page: number, pageSize: number, totalItems: number) {
  const totalPages = Math.ceil(totalItems / pageSize);
  return {
    jobs: ids.map((id, index) =>
      makeJob({ id, jobId: id, name: `job-${id}`, user: index % 2 === 0 ? 'alice' : 'bob' })
    ),
    pagination: { page, pageSize, totalItems, totalPages },
    updatedAt: '2026-09-09T12:00:00.000Z',
  };
}

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

const PARTITIONS_BODY = { partitions: ['gpu'], updatedAt: '2026-09-09T12:00:00.000Z' };

function setupFetch(jobsHandler: (url: string) => Promise<Response> | Response) {
  const fetchMock = jest.fn((url: string) => {
    if (url.includes('/api/v1/partitions')) {
      return Promise.resolve(okJson(PARTITIONS_BODY));
    }
    return Promise.resolve(jobsHandler(url));
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderSection(initialUrl: string) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    validateSearch: (search: Record<string, unknown>) => parseDashboardSearch(search),
    component: JobsSection,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  });
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('JobsSection', () => {
  test('long job names truncate visually with the full value in title', async () => {
    const longName = `train-model-with-an-excessively-long-descriptive-name-${'x'.repeat(80)}`;
    setupFetch(() =>
      okJson({
        ...jobsPage(['101'], 1, 20, 1),
        jobs: [makeJob({ id: '101', name: longName })],
      })
    );
    renderSection('/');

    await waitFor(() => expect(screen.getByTitle(longName)).toBeTruthy());
    const cell = screen.getByTitle(longName);
    expect(cell.textContent).toBe(longName);
    expect(cell.className).toContain('truncate');
  });

  test('renders DTO rows with nulls as em dashes, never N/A', async () => {
    setupFetch(() =>
      okJson({
        ...jobsPage(['101'], 1, 20, 1),
        jobs: [makeJob({ id: '101', name: null, account: null, stateReason: null })],
      })
    );
    renderSection('/');

    await waitFor(() => expect(screen.getByText('101')).toBeTruthy());
    expect(screen.queryByText('N/A')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  test('page change requests the correct page', async () => {
    const pageOne = Array.from({ length: 10 }, (_, i) => String(i + 1));
    const pageTwo = Array.from({ length: 5 }, (_, i) => String(i + 11));
    const fetchMock = setupFetch((url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      return okJson(page === 1 ? jobsPage(pageOne, 1, 10, 15) : jobsPage(pageTwo, 2, 10, 15));
    });
    renderSection('/?page=1&pageSize=10');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('job-1')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => (url as string).includes('page=2'))).toBe(true)
    );
    await waitFor(() => expect(screen.getByText('job-11')).toBeTruthy());
  });

  test('single filter commits on Enter with page reset, not while typing', async () => {
    const fetchMock = setupFetch(() => okJson(jobsPage(['9'], 1, 20, 1)));
    renderSection('/?page=2');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('job-9')).toBeTruthy());
    // The fixture reports one page while the URL asks for page 2; wait for
    // the clamp refetch to settle before asserting typing fires nothing.
    await waitFor(() => expect(screen.getByText('Showing 1 to 1 of 1 jobs')).toBeTruthy());
    fetchMock.mockClear();
    await user.selectOptions(screen.getByLabelText('Filter field'), 'user');
    await user.type(screen.getByLabelText('Filter value'), 'bob');

    // Typing only edits the draft: no request fires mid-query.
    expect(fetchMock).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');

    await waitFor(
      () =>
        expect(
          fetchMock.mock.calls.some(
            ([url]) =>
              (url as string).includes('user=bob') && (url as string).includes('page=1')
          )
        ).toBe(true),
      { timeout: 5000 }
    );
    // Committed filters surface as removable chips.
    await waitFor(() => expect(screen.getByText('User: bob')).toBeTruthy());
  });

  test('compound filters commit every pair at once', async () => {
    const fetchMock = setupFetch(() => okJson(jobsPage(['9'], 1, 20, 1)));
    renderSection('/');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('job-9')).toBeTruthy());
    fetchMock.mockClear();
    await user.type(screen.getByLabelText('Filter value'), 'user:alice state:RUNNING');
    await user.keyboard('{Enter}');

    await waitFor(
      () =>
        expect(
          fetchMock.mock.calls.some(
            ([url]) =>
              (url as string).includes('user=alice') &&
              (url as string).includes('state=RUNNING') &&
              (url as string).includes('page=1')
          )
        ).toBe(true),
      { timeout: 5000 }
    );
  });

  test('invalid colon input shows a hint and commits nothing', async () => {
    const fetchMock = setupFetch(() => okJson(jobsPage(['9'], 1, 20, 1)));
    renderSection('/');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('job-9')).toBeTruthy());
    fetchMock.mockClear();
    await user.type(screen.getByLabelText('Filter value'), 'bogus:');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByText('Invalid format! Use: key1:value1 key2:value2')).toBeTruthy()
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('columns follow the agreed order without State reason', async () => {
    setupFetch(() => okJson(jobsPage(['1'], 1, 20, 1)));
    renderSection('/');

    await waitFor(() => expect(screen.getByText('job-1')).toBeTruthy());
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual([
      'Job ID',
      'Partition',
      'Name',
      'User',
      'State',
      'Time limit',
      'Time left',
      'Nodes',
      'Account',
      'Submitted',
    ]);
  });

  test('error state offers retry, empty state offers clear filters', async () => {    let shouldFail = true;
    setupFetch(() => {
      if (shouldFail) {
        return Promise.reject(new TypeError('fetch failed'));
      }
      return okJson(jobsPage([], 1, 20, 0));
    });
    renderSection('/');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 8000 });
    shouldFail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByText('No jobs match the current filters.')).toBeTruthy()
    );
  });

  test('page transition keeps previous rows without claiming the new page', async () => {
    const pageOne = Array.from({ length: 10 }, (_, i) => String(i + 1));
    const pageTwoIds = Array.from({ length: 5 }, (_, i) => String(i + 11));
    let pageTwoGate: Promise<Response> | null = null;
    const fetchMock = setupFetch((url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      if (page === 1) return okJson(jobsPage(pageOne, 1, 10, 15));
      if (pageTwoGate !== null) return pageTwoGate;
      return okJson(jobsPage(pageTwoIds, 2, 10, 15));
    });
    renderSection('/?page=1&pageSize=10');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('job-1')).toBeTruthy());
    let resolvePageTwo!: (response: Response) => void;
    pageTwoGate = new Promise<Response>((resolve) => {
      resolvePageTwo = resolve;
    });
    fetchMock.mockClear();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(screen.getByText('Updating results…')).toBeTruthy());
    expect(screen.getByText('job-1')).toBeTruthy();
    expect(screen.getByText('Showing 1 to 10 of 15 jobs')).toBeTruthy();
    expect(screen.queryByText('Showing 11 to 15 of 15 jobs')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled
    ).toBe(true);

    resolvePageTwo(okJson(jobsPage(pageTwoIds, 2, 10, 15)));
    await waitFor(() => expect(screen.getByText('job-11')).toBeTruthy());
    expect(screen.getByText('Showing 11 to 15 of 15 jobs')).toBeTruthy();
    expect(screen.queryByText('Updating results…')).toBeNull();
  });

  test('ordinary background refresh says Refreshing… and keeps rows', async () => {
    const fetchMock = setupFetch(() => okJson(jobsPage(['1'], 1, 20, 1)));
    renderSection('/');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('job-1')).toBeTruthy());
    let resolveRefresh!: (response: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    fetchMock.mockImplementation((url: string) =>
      (url as string).includes('/api/v1/partitions')
        ? Promise.resolve(okJson(PARTITIONS_BODY))
        : gate
    );
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(screen.getByText('Refreshing…')).toBeTruthy());
    expect(screen.getByText('job-1')).toBeTruthy();

    resolveRefresh(okJson(jobsPage(['1'], 1, 20, 1)));
    await waitFor(() => expect(screen.queryByText('Refreshing…')).toBeNull());
    expect(screen.getByText('job-1')).toBeTruthy();
  });

  test('background refresh failure keeps rows with a warning', async () => {
    let shouldFail = false;
    setupFetch(() => {
      if (shouldFail) {
        return Promise.reject(new TypeError('fetch failed'));
      }
      return okJson(jobsPage(['1'], 1, 20, 1));
    });
    renderSection('/');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('job-1')).toBeTruthy());
    shouldFail = true;
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(
      () =>
        expect(
          screen.getByText('Showing previous results because the latest request failed.')
        ).toBeTruthy(),
      { timeout: 8000 }
    );
    expect(screen.getByText('job-1')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  test('partition list failure leaves cluster-wide jobs usable with retry', async () => {
    let partitionsFail = true;
    global.fetch = jest.fn((url: string) =>
      (url as string).includes('/api/v1/partitions')
        ? partitionsFail
          ? Promise.reject(new TypeError('fetch failed'))
          : Promise.resolve(okJson(PARTITIONS_BODY))
        : Promise.resolve(okJson(jobsPage(['1'], 1, 20, 1)))
    ) as unknown as typeof fetch;
    renderSection('/');
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('job-1')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Partition list unavailable.')).toBeTruthy(), {
      timeout: 8000,
    });
    // The single intelligent input stays usable without live partitions.
    expect(screen.getByLabelText('Filter value')).toBeTruthy();
    expect(screen.getByLabelText('Filter field')).toBeTruthy();

    partitionsFail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('Partition list unavailable.')).toBeNull());
    // Live partitions feed autocomplete once reloaded.
    await user.type(screen.getByLabelText('Filter value'), 'partition:g');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());
    expect(screen.getByRole('option', { name: /gpu/ })).toBeTruthy();
  });
});
