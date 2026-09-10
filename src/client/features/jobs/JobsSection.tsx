import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTable } from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { JOB_STATES, JOBS_PAGE_DEFAULT, JOBS_PAGE_SIZE_DEFAULT } from '../../../shared/api/v1/jobs.ts';
import type { JobState } from '../../../shared/api/v1/jobs.ts';
import { errorMessage } from '../../api/client.ts';
import { fetchJobs } from '../../api/jobs.ts';
import { fetchPartitions } from '../../api/partitions.ts';
import { jobsKeys, partitionKeys } from '../../api/query-keys.ts';
import type { JobsListInput } from '../../api/query-keys.ts';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ErrorPanel } from '../../components/ErrorPanel.tsx';
import { RefreshWarning } from '../../components/RefreshWarning.tsx';
import { columns, jobsTableFeatures } from './columns.tsx';
import { EMPTY_FILTERS, JobsFilters, filtersEqual } from './JobsFilters.tsx';
import type { JobsFilterValues } from './JobsFilters.tsx';
import { JobsPagination, PAGE_SIZE_OPTIONS } from './JobsPagination.tsx';
import { JobsTable, JobsTableSkeleton } from './JobsTable.tsx';

const PARTITION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function readTextParam(params: URLSearchParams, key: string, maxLength: number): string {
  const value = (params.get(key) ?? '').trim();
  return value.length > 0 && value.length <= maxLength ? value : '';
}

function readJobsUrlState(): { filters: JobsFilterValues; page: number; pageSize: number } {
  const params = new URLSearchParams(window.location.search);
  const rawPartition = readTextParam(params, 'partition', 64);
  const rawState = readTextParam(params, 'state', 64);
  const parsedPage = Number.parseInt(params.get('page') ?? '', 10);
  const parsedPageSize = Number.parseInt(params.get('pageSize') ?? '', 10);
  return {
    filters: {
      id: readTextParam(params, 'id', 64),
      partition: PARTITION_PATTERN.test(rawPartition) ? rawPartition : '',
      name: readTextParam(params, 'name', 200),
      user: readTextParam(params, 'user', 64),
      account: readTextParam(params, 'account', 64),
      state: (JOB_STATES as readonly string[]).includes(rawState) ? (rawState as JobState) : '',
      stateReason: readTextParam(params, 'stateReason', 128),
    },
    page: Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : JOBS_PAGE_DEFAULT,
    pageSize: PAGE_SIZE_OPTIONS.includes(parsedPageSize) ? parsedPageSize : JOBS_PAGE_SIZE_DEFAULT,
  };
}

function toQueryInput(filters: JobsFilterValues, page: number, pageSize: number): JobsListInput {
  return {
    page,
    pageSize,
    ...(filters.id !== '' ? { id: filters.id } : {}),
    ...(filters.partition !== '' ? { partition: filters.partition } : {}),
    ...(filters.name !== '' ? { name: filters.name } : {}),
    ...(filters.user !== '' ? { user: filters.user } : {}),
    ...(filters.account !== '' ? { account: filters.account } : {}),
    ...(filters.state !== '' ? { state: filters.state } : {}),
    ...(filters.stateReason !== '' ? { stateReason: filters.stateReason } : {}),
  };
}

function JobsSection() {
  const [urlState] = useState(readJobsUrlState);
  const [filters, setFilters] = useState<JobsFilterValues>(urlState.filters);
  const [page, setPage] = useState(urlState.page);
  const [pageSize, setPageSize] = useState(urlState.pageSize);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    if (filters.id !== '') params.set('id', filters.id);
    if (filters.partition !== '') params.set('partition', filters.partition);
    if (filters.name !== '') params.set('name', filters.name);
    if (filters.user !== '') params.set('user', filters.user);
    if (filters.account !== '') params.set('account', filters.account);
    if (filters.state !== '') params.set('state', filters.state);
    if (filters.stateReason !== '') params.set('stateReason', filters.stateReason);
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [filters, page, pageSize]);

  const handleFiltersChange = useCallback((next: JobsFilterValues) => {
    setFilters(next);
    setPage(1);
  }, []);

  const queryInput = useMemo(() => toQueryInput(filters, page, pageSize), [filters, page, pageSize]);

  const partitionsQuery = useQuery({
    queryKey: partitionKeys.list,
    queryFn: ({ signal }) => fetchPartitions({ signal }),
    staleTime: 600_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const jobsQuery = useQuery({
    queryKey: jobsKeys.list(queryInput),
    queryFn: ({ signal }) => fetchJobs(queryInput, { signal }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  const totalPages = jobsQuery.data?.pagination.totalPages ?? 0;
  useEffect(() => {
    if (jobsQuery.data !== undefined && totalPages > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [jobsQuery.data, totalPages, page]);

  const table = useTable({
    features: jobsTableFeatures,
    columns,
    data: jobsQuery.data?.jobs ?? [],
    getRowId: (job) => job.id,
    manualPagination: true,
    rowCount: jobsQuery.data?.pagination.totalItems ?? 0,
    state: { pagination: { pageIndex: page - 1, pageSize } },
    onPaginationChange: (updater) => {
      const prev = { pageIndex: page - 1, pageSize };
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next.pageSize !== prev.pageSize) {
        setPageSize(next.pageSize);
        setPage(1);
      } else if (next.pageIndex !== prev.pageIndex) {
        setPage(next.pageIndex + 1);
      }
    },
  });

  const partitionsUnavailable =
    partitionsQuery.data === undefined && partitionsQuery.isError;
  const partitionsStale =
    partitionsQuery.data !== undefined && partitionsQuery.isError;

  if (jobsQuery.data === undefined) {
    return (
      <section aria-label="Slurm job queue">
        <h2 id="job-queue" className="mb-6 scroll-mt-24 text-center text-2xl text-gray-800">
          Slurm Job Queue
        </h2>
        <JobsFilters
          filters={filters}
          partitions={[]}
          partitionsUnavailable={partitionsUnavailable}
          partitionsStale={partitionsStale}
          onPartitionsRetry={() => partitionsQuery.refetch()}
          onFiltersChange={handleFiltersChange}
        />
        {jobsQuery.isPending ? (
          <JobsTableSkeleton columnCount={columns.length} />
        ) : (
          <ErrorPanel message={errorMessage(jobsQuery.error)} onRetry={() => jobsQuery.refetch()} />
        )}
      </section>
    );
  }

  const { pagination } = jobsQuery.data;
  const isPlaceholder = jobsQuery.isPlaceholderData === true;
  const lastUpdated = new Date(jobsQuery.data.updatedAt).toLocaleTimeString();
  const refreshFailed = jobsQuery.isError;

  return (
    <section aria-label="Slurm job queue">
      <h2 id="job-queue" className="mb-6 scroll-mt-24 text-center text-2xl text-gray-800">
        Slurm Job Queue
      </h2>
      <JobsFilters
        filters={filters}
        partitions={partitionsQuery.data?.partitions ?? []}
        partitionsUnavailable={partitionsUnavailable}
        partitionsStale={partitionsStale}
        onPartitionsRetry={() => partitionsQuery.refetch()}
        onFiltersChange={handleFiltersChange}
      />
      {pagination.totalItems === 0 ? (
        <EmptyState
          message="No jobs match the current filters."
          action={
            filtersEqual(filters, EMPTY_FILTERS) ? undefined : (
              <button
                type="button"
                className="rounded bg-blue-500 px-3 py-1.5 text-white hover:bg-blue-600"
                onClick={() => handleFiltersChange(EMPTY_FILTERS)}
              >
                Clear filters
              </button>
            )
          }
        />
      ) : (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
            <span>Last updated: {lastUpdated}</span>
            <span className="flex items-center gap-3">
              {isPlaceholder ? (
                <span aria-live="polite">Updating results…</span>
              ) : jobsQuery.isFetching ? (
                <span aria-live="polite">Refreshing…</span>
              ) : null}
              <button
                type="button"
                className="rounded bg-gray-200 px-3 py-1 hover:bg-gray-300"
                onClick={() => jobsQuery.refetch()}
              >
                Refresh
              </button>
            </span>
          </div>
          {refreshFailed ? (
            <div className="mb-2">
              <RefreshWarning
                message="Showing previous results because the latest request failed."
                onRetry={() => jobsQuery.refetch()}
              />
            </div>
          ) : null}
          <div className={isPlaceholder ? 'opacity-60' : undefined}>
            <JobsTable table={table} />
          </div>
          <JobsPagination
            table={table}
            pagination={pagination}
            disabled={isPlaceholder || jobsQuery.isFetching}
          />
        </div>
      )}
    </section>
  );
}

export { JobsSection };
