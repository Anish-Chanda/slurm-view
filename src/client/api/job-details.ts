import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client.ts';
import type { JobDetailsResponse } from '../../shared/api/v1/jobs.ts';
import { apiUrl } from './base.ts';
import { fetchJson } from './client.ts';
import { jobsKeys } from './query-keys.ts';

const JOB_DETAIL_STALE_TIME_MS = 30_000;

function fetchJobDetails(id: string, options: { signal?: AbortSignal } = {}): Promise<JobDetailsResponse> {
  return fetchJson<JobDetailsResponse>(apiUrl(`jobs/${encodeURIComponent(id)}`), options);
}

// Refresh details on each visit. The page keeps that snapshot and does not
// poll or show another job as placeholder data.
function jobDetailQueryOptions(id: string) {
  return {
    queryKey: jobsKeys.detail(id),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchJobDetails(id, { signal }),
    staleTime: JOB_DETAIL_STALE_TIME_MS,
    // A 404 means the job left live scheduler data; retrying cannot help.
    retry: (failureCount: number, error: unknown) =>
      error instanceof ApiError && error.status === 404 ? false : failureCount < 1,
  };
}

// Reuse only fresh snapshots. Drop stale data before fetching so a 404
// reflects current scheduler state; leave in-flight preloads shareable.
function prepareJobVisitSnapshot(queryClient: QueryClient, id: string): void {
  const queryKey = jobsKeys.detail(id);
  const cached = queryClient.getQueryCache().find({ queryKey, exact: true });
  const hasFreshSnapshot =
    cached !== undefined &&
    cached.state.data !== undefined &&
    !cached.isStaleByTime(JOB_DETAIL_STALE_TIME_MS);
  if (!hasFreshSnapshot && cached?.state.fetchStatus !== 'fetching') {
    queryClient.removeQueries({ queryKey, exact: true });
  }
  void queryClient.prefetchQuery(jobDetailQueryOptions(id));
}

export { JOB_DETAIL_STALE_TIME_MS, fetchJobDetails, jobDetailQueryOptions, prepareJobVisitSnapshot };
