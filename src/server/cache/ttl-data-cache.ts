import { TTLCache } from '@isaacs/ttlcache';

type TtlDataLoader<T> = (signal?: AbortSignal) => Promise<T>;

const CACHE_KEY = 'value';

class TtlDataCache<T> {
  private readonly cache: TTLCache<string, T>;
  private inFlight: Promise<T> | undefined;

  constructor(
    ttlMs: number,
    private readonly loader: TtlDataLoader<T>
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new TypeError('ttlMs must be a positive finite number');
    }
    this.cache = new TTLCache<string, T>({
      ttl: ttlMs,
      updateAgeOnGet: false,
      checkAgeOnGet: true,
    });
  }

  peek(): T | undefined {
    return this.cache.get(CACHE_KEY);
  }

  getOrLoad(options: { signal?: AbortSignal } = {}): Promise<T> {
    const cached = this.peek();
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    return this.startFlight(options.signal);
  }

  refresh(options: { signal?: AbortSignal } = {}): Promise<T> {
    return this.startFlight(options.signal);
  }

  invalidate(): void {
    this.cache.delete(CACHE_KEY);
  }

  private startFlight(signal?: AbortSignal): Promise<T> {
    if (this.inFlight !== undefined) {
      return this.inFlight;
    }
    const flight = this.loader(signal).then(
      (snapshot) => {
        this.cache.set(CACHE_KEY, snapshot);
        this.inFlight = undefined;
        return snapshot;
      },
      (error) => {
        this.inFlight = undefined;
        throw error;
      }
    );
    this.inFlight = flight;
    return flight;
  }
}

export { TtlDataCache };
export type { TtlDataLoader };
