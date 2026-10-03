import { fetchJobs } from '../adapters/slurm/jobs.js';
import type { SlurmContext } from '../adapters/slurm/context.js';
import type { QueueJob } from '../models/queue-job.js';
import { TtlDataCache } from './ttl-data-cache.js';

// Replace the snapshot as one value, then filter and paginate it in memory.
interface JobSnapshot {
  jobs: readonly QueueJob[];
  byId: ReadonlyMap<string, QueueJob>;
  capturedAt: Date;
}

// The TTL exceeds the poll interval slightly to absorb scheduling jitter.
const JOBS_TTL_MS = 60_000;
const JOBS_POLL_INTERVAL_MS = 30_000;

function createJobSnapshot(jobs: QueueJob[], capturedAt: Date = new Date()): JobSnapshot {
  const byId = new Map<string, QueueJob>();
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
