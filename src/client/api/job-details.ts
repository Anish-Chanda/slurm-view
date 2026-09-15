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

// A loaded job page is a stable snapshot for the visit: fresh enough when
// entering (the route loader establishes a fresh snapshot per visit), then
// stable while reading. Deliberately no polling here, and the shared
// QueryClient disables implicit mount/focus/reconnect refetching, so a job
// leaving the live squeue data cannot wipe a page someone is reading. A
// later failed refresh keeps the snapshot; the page surfaces it
// non-destructively instead. Shared by the route loader and the page. No
// placeholder data: a different job ID shows a loading state, never the
// previous job.
function jobDetailQueryOptions(id: string) {
  return {
    queryKey: jobsKeys.detail(id),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchJobDetails(id, { signal }),
    staleTime: JOB_DETAIL_STALE_TIME_MS,
    // Intentional override of the shared retry: a 404 means the job left
    // the live data, so retrying cannot help.
    retry: (failureCount: number, error: unknown) =>
      error instanceof ApiError && error.status === 404 ? false : failureCount < 1,
  };
}

// A new visit explicitly establishes its own scheduler snapshot. Freshness
// is time-based: an inherited snapshot younger than the detail stale time
// (for example from intent preload moments ago) is adopted as this visit's
// snapshot, while an older one is dropped so the visit cannot render it.
// Dropping matters because a fresh 404 must read as "no longer available",
// never as a refresh failure against somebody else's snapshot. An
// in-flight request is never cancelled here: prefetching below attaches to
// it instead of duplicating it.
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
