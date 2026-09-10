import type { JobsResponse } from '../../shared/api/v1/jobs.ts';
import { apiUrl } from './base.ts';
import { fetchJson } from './client.ts';
import type { JobsListInput } from './query-keys.ts';

function fetchJobs(input: JobsListInput, options: { signal?: AbortSignal } = {}): Promise<JobsResponse> {
  const params = new URLSearchParams();
  params.set('page', String(input.page));
  params.set('pageSize', String(input.pageSize));
  if (input.id !== undefined) params.set('id', input.id);
  if (input.partition !== undefined) params.set('partition', input.partition);
  if (input.name !== undefined) params.set('name', input.name);
  if (input.user !== undefined) params.set('user', input.user);
  if (input.account !== undefined) params.set('account', input.account);
  if (input.state !== undefined) params.set('state', input.state);
  if (input.stateReason !== undefined) params.set('stateReason', input.stateReason);
  return fetchJson<JobsResponse>(apiUrl(`jobs?${params.toString()}`), options);
}

export { fetchJobs };
