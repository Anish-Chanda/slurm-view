import { JOBS_PAGE_DEFAULT, JOBS_PAGE_SIZE_DEFAULT } from '../../shared/api/v1/jobs.ts';
import type { JobState } from '../../shared/api/v1/jobs.ts';

interface JobsListInput {
  page: number;
  pageSize: number;
  id?: string;
  partition?: string;
  name?: string;
  user?: string;
  account?: string;
  state?: JobState;
  stateReason?: string;
}

function jobsListKey(input: JobsListInput): readonly unknown[] {
  const { page, pageSize, id, partition, name, user, account, state, stateReason } = input;
  return [
    'jobs',
    'list',
    {
      page,
      pageSize,
      ...(id !== undefined ? { id } : {}),
      ...(partition !== undefined ? { partition } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(user !== undefined ? { user } : {}),
      ...(account !== undefined ? { account } : {}),
      ...(state !== undefined ? { state } : {}),
      ...(stateReason !== undefined ? { stateReason } : {}),
    },
  ];
}

const jobsKeys = {
  all: ['jobs'] as const,
  list: jobsListKey,
};

function statsDetailKey(partition: string | null): readonly unknown[] {
  return ['stats', 'detail', { partition }];
}

const statsKeys = {
  all: ['stats'] as const,
  detail: statsDetailKey,
};

const partitionKeys = {
  all: ['partitions'] as const,
  list: ['partitions', 'list'] as const,
};

// UI settings are effectively immutable for the lifetime of the server:
// fetch once and cache indefinitely (staleTime: Infinity at the call
// site). The frontend holds no copy of the admin defaults.
const uiSettingsKeys = {
  all: ['ui-settings'] as const,
  detail: ['ui-settings', 'detail'] as const,
};

export { JOBS_PAGE_DEFAULT, JOBS_PAGE_SIZE_DEFAULT, jobsKeys, partitionKeys, statsKeys, uiSettingsKeys };
export type { JobsListInput };
