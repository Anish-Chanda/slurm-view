import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTable } from '@tanstack/react-table';
import { useCallback, useEffect, useMemo } from 'react';
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
import { JobsPagination } from './JobsPagination.tsx';
import { JobsTable, JobsTableSkeleton } from './JobsTable.tsx';
import { dashboardSearchParams, readDashboardSearch } from './jobs-search.ts';

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
  const search = useSearch({ from: '/' });
  const navigate = useNavigate();
  const { filters, page, pageSize } = useMemo(() => readDashboardSearch(search), [search]);

  const commitSearch = useCallback(
    (nextFilters: JobsFilterValues, nextPage: number, nextPageSize: number) => {
      void navigate({
        to: '/',
        search: dashboardSearchParams(nextFilters, nextPage, nextPageSize),
        replace: true,
      });
    },
    [navigate]
  );

  const handleFiltersChange = useCallback(
    (next: JobsFilterValues) => {
      commitSearch(next, 1, pageSize);
    },
    [commitSearch, pageSize]
  );

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
      commitSearch(filters, totalPages, pageSize);
    }
  }, [jobsQuery.data, totalPages, page, filters, pageSize, commitSearch]);

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
        commitSearch(filters, 1, next.pageSize);
      } else if (next.pageIndex !== prev.pageIndex) {
        commitSearch(filters, next.pageIndex + 1, pageSize);
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
