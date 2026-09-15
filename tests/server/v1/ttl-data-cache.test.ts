import { TtlDataCache } from '../../../src/server/cache/ttl-data-cache.js';

// TTLCache reads the global performance clock, so tests drive time by
// mocking performance.now instead of sleeping.
function useMockClock(startMs = 1_000_000): { advance: (ms: number) => void } {
  let nowMs = startMs;
  jest.spyOn(performance, 'now').mockImplementation(() => nowMs);
  return {
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe('TtlDataCache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('serves the valid snapshot without reloading', async () => {
    useMockClock();
    const loader = jest.fn().mockResolvedValue('snap-1');
    const cache = new TtlDataCache<string>(60_000, loader);

    await expect(cache.getOrLoad()).resolves.toBe('snap-1');
    await expect(cache.getOrLoad()).resolves.toBe('snap-1');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('expired entries miss and reload exactly once', async () => {
    const clock = useMockClock();
    let count = 0;
    const cache = new TtlDataCache<string>(60_000, () => Promise.resolve(`snap-${++count}`));

    await expect(cache.getOrLoad()).resolves.toBe('snap-1');
    clock.advance(59_999);
    await expect(cache.getOrLoad()).resolves.toBe('snap-1');
    clock.advance(1);
    await expect(cache.getOrLoad()).resolves.toBe('snap-2');
  });

  test('reads do not slide expiration', async () => {
    const clock = useMockClock();
    let count = 0;
    const cache = new TtlDataCache<string>(60_000, () => Promise.resolve(`snap-${++count}`));

    await cache.getOrLoad();
    clock.advance(50_000);
    await cache.getOrLoad();
    clock.advance(10_000);
    await expect(cache.getOrLoad()).resolves.toBe('snap-2');
  });

  test('refresh() forces a reload while the entry is still valid', async () => {
    useMockClock();
    let count = 0;
    const cache = new TtlDataCache<string>(60_000, () => Promise.resolve(`snap-${++count}`));

    await expect(cache.getOrLoad()).resolves.toBe('snap-1');
    await expect(cache.refresh()).resolves.toBe('snap-2');
    await expect(cache.getOrLoad()).resolves.toBe('snap-2');
  });

  test('forced refresh resets the TTL', async () => {
    const clock = useMockClock();
    let count = 0;
    const cache = new TtlDataCache<string>(60_000, () => Promise.resolve(`snap-${++count}`));

    await cache.getOrLoad();
    clock.advance(50_000);
    await cache.refresh();
    clock.advance(50_000);
    await expect(cache.getOrLoad()).resolves.toBe('snap-2');
    expect(count).toBe(2);
  });

  test('concurrent getOrLoad + refresh share one in-flight load', async () => {
    useMockClock();
    let calls = 0;
    let resolveLoad: (value: string) => void = () => undefined;
    const cache = new TtlDataCache<string>(
      60_000,
      () =>
        new Promise<string>((resolve) => {
          calls += 1;
          resolveLoad = resolve;
        })
    );

    const pending = Promise.all([cache.getOrLoad(), cache.refresh(), cache.getOrLoad()]);
    await Promise.resolve();
    expect(calls).toBe(1);
    resolveLoad('snap-1');
    await expect(pending).resolves.toEqual(['snap-1', 'snap-1', 'snap-1']);
  });

  test('failed refresh rejects all joiners and inserts nothing', async () => {
    useMockClock();
    const failure = new Error('slurm down');
    const loader = jest
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce('recovered');
    const cache = new TtlDataCache<string>(60_000, loader);

    await expect(cache.getOrLoad()).rejects.toBe(failure);
    expect(cache.peek()).toBeUndefined();
    await expect(cache.getOrLoad()).resolves.toBe('recovered');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test('failed refresh() keeps the previous valid snapshot', async () => {
    useMockClock();
    let count = 0;
    const cache = new TtlDataCache<string>(60_000, () => {
      count += 1;
      return count === 2 ? Promise.reject(new Error('flaky')) : Promise.resolve(`snap-${count}`);
    });

    await expect(cache.getOrLoad()).resolves.toBe('snap-1');
    await expect(cache.refresh()).rejects.toThrow('flaky');
    await expect(cache.getOrLoad()).resolves.toBe('snap-1');
  });

  test('peek never triggers a load and invalidate forces a miss', async () => {
    useMockClock();
    const loader = jest.fn().mockResolvedValue('snap');
    const cache = new TtlDataCache<string>(60_000, loader);

    expect(cache.peek()).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();
    await cache.getOrLoad();
    expect(cache.peek()).toBe('snap');
    cache.invalidate();
    expect(cache.peek()).toBeUndefined();
  });

  test('forwards the abort signal to the loader', async () => {
    useMockClock();
    const seen: Array<AbortSignal | undefined> = [];
    const cache = new TtlDataCache<string>(60_000, (signal) => {
      seen.push(signal);
      return Promise.resolve('snap');
    });
    const controller = new AbortController();
    await cache.refresh({ signal: controller.signal });
    expect(seen).toEqual([controller.signal]);
  });
});
