import type { PartitionsResponse } from '../../shared/api/v1/partitions.ts';
import { apiUrl } from './base.ts';
import { fetchJson } from './client.ts';

function fetchPartitions(options: { signal?: AbortSignal } = {}): Promise<PartitionsResponse> {
  return fetchJson<PartitionsResponse>(apiUrl('partitions'), options);
}

export { fetchPartitions };
