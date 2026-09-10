import { PartitionsCache } from '../../../src/server/cache/partitions-cache.js';
import {
  fetchPartitions,
  normalizePartitionName,
  parsePartitionsStdout,
} from '../../../src/server/adapters/slurm/partitions.js';
import type { SlurmRunFn } from '../../../src/server/adapters/slurm/context.js';
import { SlurmUpstreamError, UpstreamInvalidError } from '../../../src/server/adapters/slurm/errors.js';

function envelope(partitions: unknown): string {
  return JSON.stringify({ meta: {}, errors: [], warnings: [], partitions });
}

function runFor(stdout: string): SlurmRunFn {
  return jest.fn().mockResolvedValue({ stdout, stderr: '' });
}

describe.each(['v0.0.43', 'v0.0.44', 'v0.0.45'] as const)('parsePartitionsStdout (%s)', (parser) => {
  test('returns real partition names in order', () => {
    const names = parsePartitionsStdout(
      parser,
      envelope([{ name: 'gpu' }, { name: 'debug' }, { name: 'all' }])
    );
    expect(names).toEqual(['gpu', 'debug', 'all']);
  });

  test('ignores unconsumed partition metadata', () => {
    const names = parsePartitionsStdout(
      parser,
      envelope([{ name: 'gpu', nodes: 'gpu[01-04]', state: 'UP', extra: { deep: true } }])
    );
    expect(names).toEqual(['gpu']);
  });

  test('rejects invalid JSON', () => {
    expect(() => parsePartitionsStdout(parser, 'not json {')).toThrow(UpstreamInvalidError);
  });

  test('rejects a missing partitions array', () => {
    expect(() => parsePartitionsStdout(parser, JSON.stringify({ meta: {} }))).toThrow(
      UpstreamInvalidError
    );
  });

  test('rejects an empty partition name', () => {
    expect(() => parsePartitionsStdout(parser, envelope([{ name: '  ' }]))).toThrow(
      UpstreamInvalidError
    );
  });

  test('non-empty Slurm errors become upstream errors', () => {
    const stdout = JSON.stringify({
      errors: [{ description: 'slurmctld refused the request' }],
      partitions: [],
    });
    expect(() => parsePartitionsStdout(parser, stdout)).toThrow(SlurmUpstreamError);
  });
});

describe('normalizePartitionName', () => {
  test('trims surrounding whitespace without mutating the name', () => {
    expect(normalizePartitionName({ name: '  GPU_Long-1  ' })).toBe('GPU_Long-1');
  });
});

describe('fetchPartitions', () => {
  test('runs sinfo with the negotiated parser and forwards the signal', async () => {
    const stdout = envelope([{ name: 'gpu' }]);
    const run: SlurmRunFn = jest.fn().mockResolvedValue({ stdout, stderr: '' });
    const controller = new AbortController();
    const names = await fetchPartitions(
      { parser: 'v0.0.45', run },
      { signal: controller.signal }
    );
    expect(names).toEqual(['gpu']);
    expect(run).toHaveBeenCalledWith('sinfo', ['--json=v0.0.45'], expect.objectContaining({ signal: controller.signal }));
  });
});

describe('PartitionsCache', () => {
  test('caches the snapshot and reloads after invalidate', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce({ stdout: envelope([{ name: 'gpu' }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: envelope([{ name: 'gpu' }, { name: 'debug' }]), stderr: '' });
    const cache = new PartitionsCache({ parser: 'v0.0.45', run });
    const first = await cache.getOrLoad();
    expect(first.partitions).toEqual(['gpu']);
    expect(await cache.getOrLoad()).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);
    cache.invalidate();
    const second = await cache.getOrLoad();
    expect(second.partitions).toEqual(['gpu', 'debug']);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
