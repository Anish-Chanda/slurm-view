// Cached sacctmgr association snapshot for pending analysis.
import { fetchAssocSnapshot } from '../adapters/slurm/sacctmgr-assoc.js';
import type { AssocSnapshot } from '../adapters/slurm/sacctmgr-assoc.js';
import type { SlurmContext } from '../adapters/slurm/context.js';
import { TtlDataCache } from './ttl-data-cache.js';

const ASSOC_TTL_MS = 600_000;

interface AssocCacheOptions {
  ttlMs?: number;
}

class AssocCache {
  private readonly snapshots: TtlDataCache<AssocSnapshot>;

  constructor(
    private readonly context: SlurmContext,
    options: AssocCacheOptions = {}
  ) {
    this.snapshots = new TtlDataCache<AssocSnapshot>(
      options.ttlMs ?? ASSOC_TTL_MS,
      (signal) => fetchAssocSnapshot(this.context, { signal })
    );
  }

  getOrLoad(options: { signal?: AbortSignal } = {}): Promise<AssocSnapshot> {
    return this.snapshots.getOrLoad(options);
  }

  refresh(options: { signal?: AbortSignal } = {}): Promise<AssocSnapshot> {
    return this.snapshots.refresh(options);
  }

  peek(): AssocSnapshot | undefined {
    return this.snapshots.peek();
  }

  invalidate(): void {
    this.snapshots.invalidate();
  }
}

export { ASSOC_TTL_MS, AssocCache };
export type { AssocCacheOptions, AssocSnapshot };
