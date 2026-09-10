import { fetchPartitions } from '../adapters/slurm/partitions.js';
import type { SlurmContext } from '../adapters/slurm/context.js';
import { TtlDataCache } from './ttl-data-cache.js';

interface PartitionSnapshot {
  partitions: readonly string[];
  capturedAt: Date;
}

// Partitions change infrequently; sinfo is an RPC to slurmctld, so cache
// lazily for about 10 minutes with no polling loop.
const PARTITIONS_TTL_MS = 600_000;

function createPartitionSnapshot(partitions: string[], capturedAt: Date = new Date()): PartitionSnapshot {
  return { partitions: [...partitions], capturedAt };
}

interface PartitionsCacheOptions {
  ttlMs?: number;
}

class PartitionsCache {
  private readonly snapshots: TtlDataCache<PartitionSnapshot>;

  constructor(
    private readonly context: SlurmContext,
    options: PartitionsCacheOptions = {}
  ) {
    this.snapshots = new TtlDataCache<PartitionSnapshot>(
      options.ttlMs ?? PARTITIONS_TTL_MS,
      (signal) => this.load(signal)
    );
  }

  getOrLoad(options: { signal?: AbortSignal } = {}): Promise<PartitionSnapshot> {
    return this.snapshots.getOrLoad(options);
  }

  refresh(options: { signal?: AbortSignal } = {}): Promise<PartitionSnapshot> {
    return this.snapshots.refresh(options);
  }

  peek(): PartitionSnapshot | undefined {
    return this.snapshots.peek();
  }

  invalidate(): void {
    this.snapshots.invalidate();
  }

  private async load(signal?: AbortSignal): Promise<PartitionSnapshot> {
    const partitions = await fetchPartitions(this.context, { signal });
    return createPartitionSnapshot(partitions);
  }
}

export { PARTITIONS_TTL_MS, PartitionsCache, createPartitionSnapshot };
export type { PartitionSnapshot, PartitionsCacheOptions };
