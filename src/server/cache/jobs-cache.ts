import { fetchJobs } from '../adapters/slurm/jobs.js';
import type { SlurmContext } from '../adapters/slurm/context.js';
import type { Job } from '../models/job.js';
import { TtlDataCache } from './ttl-data-cache.js';

// Replaced as one value; filtering and pagination run in memory over it.
interface JobSnapshot {
  jobs: readonly Job[];
  byId: ReadonlyMap<string, Job>;
  capturedAt: Date;
}

// TTL margin over the poll cadence absorbs scheduling jitter.
const JOBS_TTL_MS = 60_000;
const JOBS_POLL_INTERVAL_MS = 30_000;

function createJobSnapshot(jobs: Job[], capturedAt: Date = new Date()): JobSnapshot {
  const byId = new Map<string, Job>();
  for (const job of jobs) {
    byId.set(job.id, job);
  }
  return { jobs: [...jobs], byId, capturedAt };
}

interface JobsCacheOptions {
  ttlMs?: number;
}

class JobsCache {
  private readonly snapshots: TtlDataCache<JobSnapshot>;

  constructor(
    private readonly context: SlurmContext,
    options: JobsCacheOptions = {}
  ) {
    this.snapshots = new TtlDataCache<JobSnapshot>(
      options.ttlMs ?? JOBS_TTL_MS,
      (signal) => this.load(signal)
    );
  }

  getOrLoad(options: { signal?: AbortSignal } = {}): Promise<JobSnapshot> {
    return this.snapshots.getOrLoad(options);
  }

  refresh(options: { signal?: AbortSignal } = {}): Promise<JobSnapshot> {
    return this.snapshots.refresh(options);
  }

  peek(): JobSnapshot | undefined {
    return this.snapshots.peek();
  }

  invalidate(): void {
    this.snapshots.invalidate();
  }

  private async load(signal?: AbortSignal): Promise<JobSnapshot> {
    const jobs = await fetchJobs(this.context, { signal });
    return createJobSnapshot(jobs);
  }
}

export { JOBS_POLL_INTERVAL_MS, JOBS_TTL_MS, JobsCache, createJobSnapshot };
export type { JobSnapshot, JobsCacheOptions };
