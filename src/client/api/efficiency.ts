import type { EfficiencyResponse } from '../../shared/api/v1/efficiency.ts';
import { apiUrl } from './base.ts';
import { fetchJson } from './client.ts';
import { efficiencyKeys } from './query-keys.ts';

// Completed-job efficiency settles slowly: cache for minutes without
// polling, and let inactive queries be garbage-collected.
const EFFICIENCY_STALE_TIME_MS = 10 * 60 * 1000;
const EFFICIENCY_GC_TIME_MS = 30 * 60 * 1000;

function fetchEfficiency(id: string, options: { signal?: AbortSignal } = {}): Promise<EfficiencyResponse> {
  return fetchJson<EfficiencyResponse>(apiUrl(`jobs/${encodeURIComponent(id)}/efficiency`), options);
}

function efficiencyQueryOptions(id: string) {
  return {
    queryKey: efficiencyKeys.detail(id),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchEfficiency(id, { signal }),
    staleTime: EFFICIENCY_STALE_TIME_MS,
    gcTime: EFFICIENCY_GC_TIME_MS,
    refetchInterval: false as const,
    refetchOnWindowFocus: false as const,
    refetchOnReconnect: false as const,
    retry: 1,
  };
}

export { EFFICIENCY_GC_TIME_MS, EFFICIENCY_STALE_TIME_MS, efficiencyQueryOptions, fetchEfficiency };
