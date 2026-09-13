// Cached sacctmgr QOS snapshot for pending analysis.
import { fetchQosSnapshot } from '../adapters/slurm/sacctmgr-qos.js';
import type { QosSnapshot } from '../adapters/slurm/sacctmgr-qos.js';
import type { SlurmContext } from '../adapters/slurm/context.js';
import { TtlDataCache } from './ttl-data-cache.js';

const QOS_TTL_MS = 600_000;

interface QosCacheOptions {
  ttlMs?: number;
}

class QosCache {
  private readonly snapshots: TtlDataCache<QosSnapshot>;

  constructor(
    private readonly context: SlurmContext,
    options: QosCacheOptions = {}
  ) {
    this.snapshots = new TtlDataCache<QosSnapshot>(
      options.ttlMs ?? QOS_TTL_MS,
      (signal) => fetchQosSnapshot(this.context, { signal })
    );
  }

  getOrLoad(options: { signal?: AbortSignal } = {}): Promise<QosSnapshot> {
    return this.snapshots.getOrLoad(options);
  }

  refresh(options: { signal?: AbortSignal } = {}): Promise<QosSnapshot> {
    return this.snapshots.refresh(options);
  }

  peek(): QosSnapshot | undefined {
    return this.snapshots.peek();
  }

  invalidate(): void {
    this.snapshots.invalidate();
  }
}

export { QOS_TTL_MS, QosCache };
export type { QosCacheOptions, QosSnapshot };
