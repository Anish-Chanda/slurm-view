import { ApiError } from './client.ts';
import type { JobDetailsResponse } from '../../shared/api/v1/jobs.ts';
import { apiUrl } from './base.ts';
import { fetchJson } from './client.ts';
import { jobsKeys } from './query-keys.ts';

const JOB_DETAIL_STALE_TIME_MS = 30_000;
const JOB_DETAIL_REFETCH_INTERVAL_MS = 30_000;

function fetchJobDetails(id: string, options: { signal?: AbortSignal } = {}): Promise<JobDetailsResponse> {
  return fetchJson<JobDetailsResponse>(apiUrl(`jobs/${encodeURIComponent(id)}`), options);
}

// Shared by the route loader and the page. No placeholder data: a different
// job ID shows a loading state, never the previous job.
function jobDetailQueryOptions(id: string) {
  return {
    queryKey: jobsKeys.detail(id),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchJobDetails(id, { signal }),
    staleTime: JOB_DETAIL_STALE_TIME_MS,
    refetchInterval: JOB_DETAIL_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: false,
    retry: (failureCount: number, error: unknown) =>
      error instanceof ApiError && error.status === 404 ? false : failureCount < 1,
  };
}

export { JOB_DETAIL_REFETCH_INTERVAL_MS, JOB_DETAIL_STALE_TIME_MS, fetchJobDetails, jobDetailQueryOptions };
