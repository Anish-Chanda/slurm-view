import type { JobSnapshot } from '../cache/jobs-cache.js';
import type { Job } from '../models/job.js';

// Filters and paginates in memory over the snapshot.
interface JobsSource {
  getOrLoad(options?: { signal?: AbortSignal }): Promise<JobSnapshot>;
}

interface JobsFilter {
  id?: string;
  partition?: string;
  name?: string;
  user?: string;
  account?: string;
  state?: string;
  stateReason?: string;
}

interface PaginationInput {
  page: number;
  pageSize: number;
}

interface Pagination extends PaginationInput {
  totalItems: number;
  totalPages: number;
}

interface JobsResult {
  jobs: Job[];
  pagination: Pagination;
  updatedAt: Date;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
}

function matchesWildcard(value: string, pattern: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => escapeRegExp(part))
    .join('.*');
  return new RegExp(`^${source}$`, 'i').test(value);
}

function equals(value: string | null, filter: string): boolean {
  return value !== null && value === filter.trim();
}

function equalsIgnoreCase(value: string | null, filter: string): boolean {
  return value !== null && value.toLowerCase() === filter.trim().toLowerCase();
}

function containsIgnoreCase(value: string | null, filter: string): boolean {
  return value !== null && value.toLowerCase().includes(filter.trim().toLowerCase());
}

function containsOrWildcard(value: string | null, filter: string): boolean {
  if (value === null) {
    return false;
  }
  const trimmed = filter.trim();
  if (trimmed.includes('*')) {
    return matchesWildcard(value, trimmed);
  }
  return containsIgnoreCase(value, trimmed);
}

function isBlank(filter: string | undefined): boolean {
  return filter === undefined || filter.trim().length === 0;
}

function applyJobsFilter(jobs: readonly Job[], filter: JobsFilter): Job[] {
  return jobs.filter((job) => {
    if (!isBlank(filter.id) && !equals(job.id, filter.id!)) {
      return false;
    }
    if (!isBlank(filter.partition) && !equalsIgnoreCase(job.partition, filter.partition!)) {
      return false;
    }
    if (!isBlank(filter.name) && !containsOrWildcard(job.name, filter.name!)) {
      return false;
    }
    if (!isBlank(filter.user) && !containsIgnoreCase(job.user, filter.user!)) {
      return false;
    }
    if (!isBlank(filter.account) && !containsIgnoreCase(job.account, filter.account!)) {
      return false;
    }
    if (!isBlank(filter.state) && !equals(job.state, filter.state!)) {
      return false;
    }
    if (!isBlank(filter.stateReason) && !containsOrWildcard(job.stateReason, filter.stateReason!)) {
      return false;
    }
    return true;
  });
}

class JobsService {
  constructor(private readonly source: JobsSource) {}

  async listJobs(filter: JobsFilter, pagination: PaginationInput): Promise<JobsResult> {
    const snapshot = await this.source.getOrLoad();
    const filtered = applyJobsFilter(snapshot.jobs, filter);
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    return {
      jobs: filtered.slice(start, start + pagination.pageSize),
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems,
        totalPages,
      },
      updatedAt: snapshot.capturedAt,
    };
  }
}

export { JobsService, applyJobsFilter };
export type { JobsFilter, JobsResult, JobsSource, Pagination, PaginationInput };
