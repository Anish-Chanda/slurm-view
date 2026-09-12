import { JOB_STATES, JOBS_PAGE_DEFAULT, JOBS_PAGE_SIZE_DEFAULT } from '../../../shared/api/v1/jobs.ts';
import type { JobState } from '../../../shared/api/v1/jobs.ts';
import type { JobsFilterValues } from './JobsFilters.tsx';
import { PAGE_SIZE_OPTIONS } from './JobsPagination.tsx';

const PARTITION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Flat canonical dashboard search: numeric page/pageSize, non-empty
// filters only. Parsing is idempotent, so revalidation never loops.
interface DashboardSearch {
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

function readText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : '';
}

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(typeof value === 'string' ? value : '', 10);
  return Number.isInteger(parsed) && (parsed as number) >= 1 ? (parsed as number) : fallback;
}

function parseDashboardSearch(search: Record<string, unknown>): DashboardSearch {
  const rawPartition = readText(search.partition, 64);
  const rawState = readText(search.state, 64);
  const pageSize = readPositiveInt(search.pageSize, JOBS_PAGE_SIZE_DEFAULT);
  const params: DashboardSearch = {
    page: readPositiveInt(search.page, JOBS_PAGE_DEFAULT),
    pageSize: PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : JOBS_PAGE_SIZE_DEFAULT,
  };
  const id = readText(search.id, 64);
  if (id !== '') params.id = id;
  if (PARTITION_PATTERN.test(rawPartition)) params.partition = rawPartition;
  const name = readText(search.name, 200);
  if (name !== '') params.name = name;
  const user = readText(search.user, 64);
  if (user !== '') params.user = user;
  const account = readText(search.account, 64);
  if (account !== '') params.account = account;
  if ((JOB_STATES as readonly string[]).includes(rawState)) params.state = rawState as JobState;
  const stateReason = readText(search.stateReason, 128);
  if (stateReason !== '') params.stateReason = stateReason;
  return params;
}

function readDashboardSearch(search: DashboardSearch): {
  filters: JobsFilterValues;
  page: number;
  pageSize: number;
} {
  return {
    filters: {
      id: search.id ?? '',
      partition: search.partition ?? '',
      name: search.name ?? '',
      user: search.user ?? '',
      account: search.account ?? '',
      state: search.state ?? '',
      stateReason: search.stateReason ?? '',
    },
    page: search.page,
    pageSize: search.pageSize,
  };
}

function dashboardSearchParams(
  filters: JobsFilterValues,
  page: number,
  pageSize: number
): DashboardSearch {  return {
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

export { dashboardSearchParams, parseDashboardSearch, readDashboardSearch };
export type { DashboardSearch };

const EMPTY_DASHBOARD_SEARCH: DashboardSearch = {
  page: JOBS_PAGE_DEFAULT,
  pageSize: JOBS_PAGE_SIZE_DEFAULT,
};

export { EMPTY_DASHBOARD_SEARCH };
