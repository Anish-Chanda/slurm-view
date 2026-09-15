import type { StatsResponse } from '../../shared/api/v1/stats.ts';
import { apiUrl } from './base.ts';
import { fetchJson } from './client.ts';

// Null means cluster-wide: the partition parameter is omitted, since a
// literal partition named "all" would be scoped by ?partition=all.
function fetchStats(partition: string | null, options: { signal?: AbortSignal } = {}): Promise<StatsResponse> {
  const params = new URLSearchParams();
  if (partition !== null) params.set('partition', partition);
  const query = params.toString();
  const suffix = query === '' ? '' : `?${query}`;
  return fetchJson<StatsResponse>(apiUrl(`stats${suffix}`), options);
}

export { fetchStats };
