import { TTLCache } from '@isaacs/ttlcache';
import { fetchArrayTasks, type ArrayTaskRecord } from '../adapters/slurm/array-tasks.js';
import type { SlurmContext } from '../adapters/slurm/context.js';

// Per-array sacct cache with in-flight request deduplication.
const ARRAY_TASKS_TTL_MS = 60_000;

interface ArrayTasksCacheOptions {
  ttlMs?: number;
}

class ArrayTasksCache {
  private readonly entries: TTLCache<string, readonly ArrayTaskRecord[]>;
  private readonly inFlight = new Map<string, Promise<readonly ArrayTaskRecord[]>>();

  constructor(
    private readonly context: SlurmContext,
    private readonly options: ArrayTasksCacheOptions = {}
  ) {
    const ttlMs = options.ttlMs ?? ARRAY_TASKS_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new TypeError('ttlMs must be a positive finite number');
    }
    this.entries = new TTLCache<string, readonly ArrayTaskRecord[]>({
      ttl: ttlMs,
      updateAgeOnGet: false,
      checkAgeOnGet: true,
    });
  }

  get ttlMs(): number {
    return this.options.ttlMs ?? ARRAY_TASKS_TTL_MS;
  }

  peek(arrayJobId: string): readonly ArrayTaskRecord[] | undefined {
    return this.entries.get(arrayJobId);
  }

  getOrLoad(
    arrayJobId: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<readonly ArrayTaskRecord[]> {
    const cached = this.peek(arrayJobId);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    const flight = this.inFlight.get(arrayJobId);
    if (flight !== undefined) {
      return flight;
    }
    const started = fetchArrayTasks(this.context, arrayJobId, { signal: options.signal }).then(
      (records) => {
        const value = [...records];
        this.entries.set(arrayJobId, value);
        this.inFlight.delete(arrayJobId);
        return value;
      },
      (error) => {
        this.inFlight.delete(arrayJobId);
        throw error;
      }
    );
    this.inFlight.set(arrayJobId, started);
    return started;
  }

  invalidate(arrayJobId?: string): void {
    if (arrayJobId === undefined) {
      this.entries.clear();
      return;
    }
    this.entries.delete(arrayJobId);
  }
}

export { ARRAY_TASKS_TTL_MS, ArrayTasksCache };
export type { ArrayTasksCacheOptions };
