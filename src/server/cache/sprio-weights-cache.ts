// Cached sprio weights from slurm.conf PriorityWeight*.
import { fetchSprioWeights } from '../adapters/slurm/sprio.js';
import type { SlurmContext } from '../adapters/slurm/context.js';
import { TtlDataCache } from './ttl-data-cache.js';

const SPRIO_WEIGHTS_TTL_MS = 600_000;

interface SprioWeightsSnapshot {
  readonly weights: Readonly<Record<string, number | null>>;
  readonly capturedAt: Date;
}

interface SprioWeightsCacheOptions {
  ttlMs?: number;
}

class SprioWeightsCache {
  private readonly snapshots: TtlDataCache<SprioWeightsSnapshot>;

  constructor(
    private readonly context: SlurmContext,
    options: SprioWeightsCacheOptions = {}
  ) {
    this.snapshots = new TtlDataCache<SprioWeightsSnapshot>(
      options.ttlMs ?? SPRIO_WEIGHTS_TTL_MS,
      async (signal) => ({
        weights: await fetchSprioWeights(this.context, { signal }),
        capturedAt: new Date(),
      })
    );
  }

  getOrLoad(options: { signal?: AbortSignal } = {}): Promise<SprioWeightsSnapshot> {
    return this.snapshots.getOrLoad(options);
  }

  peek(): SprioWeightsSnapshot | undefined {
    return this.snapshots.peek();
  }

  invalidate(): void {
    this.snapshots.invalidate();
  }
}

export { SPRIO_WEIGHTS_TTL_MS, SprioWeightsCache };
export type { SprioWeightsCacheOptions, SprioWeightsSnapshot };
