import {
  parseGresDetailEntries,
  parseMemoryToMiB,
  parseTresString,
} from '../../../src/server/adapters/slurm/tres.js';
import { parseNodeGres } from '../../../src/server/adapters/slurm/gres.js';

describe('parseTresString', () => {
  test('parses cpu/mem/node with default MiB unit', () => {
    expect(parseTresString('cpu=8,mem=32768M,node=2')).toMatchObject({
      cpus: 8,
      memoryMiB: 32768,
      nodes: 2,
    });
  });

  test('bare mem number defaults to MiB', () => {
    expect(parseTresString('cpu=1,mem=8000')).toMatchObject({ memoryMiB: 8000 });
  });

  test.each([
    ['mem=1024K', 1],
    ['mem=8G', 8192],
    ['mem=2T', 2 * 1024 * 1024],
    ['mem=1P', 1024 * 1024 * 1024],
    ['mem=1.5G', 1536],
  ])('converts %s to MiB', (pair, expected) => {
    expect(parseTresString(`cpu=1,${pair}`)?.memoryMiB).toBe(expected);
  });

  test('generic and typed entries for the same GPUs do not double-count', () => {
    expect(parseTresString('cpu=1,gres/gpu=2')?.gpus).toEqual({
      total: 2,
      byType: { unknown: 2 },
    });
    expect(parseTresString('cpu=1,gres/gpu:a100=2')?.gpus).toEqual({
      total: 2,
      byType: { a100: 2 },
    });
    expect(parseTresString('cpu=1,gres/gpu=2,gres/gpu:a100=2')?.gpus).toEqual({
      total: 2,
      byType: { a100: 2 },
    });
    expect(parseTresString('cpu=1,gres/gpu=4,gres/gpu:a100=2,gres/gpu:h100=2')?.gpus).toEqual({
      total: 4,
      byType: { a100: 2, h100: 2 },
    });
    expect(parseTresString('cpu=1,gres/gpu=6,gres/gpu:a100=4,gres/gpu:h100=2')?.gpus).toEqual({
      total: 6,
      byType: { a100: 4, h100: 2 },
    });
  });

  test('accumulates multiple GPU types', () => {
    expect(parseTresString('cpu=4,gres/gpu:a100=4,gres/gpu:h100=2')?.gpus).toEqual({
      total: 6,
      byType: { a100: 4, h100: 2 },
    });
  });

  test('strips (IDX:...) suffixes without changing counts', () => {
    expect(parseTresString('cpu=1,gres/gpu:a100=4(IDX:0-3)')?.gpus).toEqual({
      total: 4,
      byType: { a100: 4 },
    });
  });

  test('keeps unknown resources verbatim without enum-locking', () => {
    const parsed = parseTresString('cpu=1,gres/shard=8,foo=bar');
    expect(parsed.other).toEqual({ 'gres/shard': '8', foo: 'bar' });
    expect(parsed.gpus.total).toBe(0);
  });

  test('tolerates empty/missing input and sentinels', () => {
    for (const input of [null, undefined, '', '   ', 'cpu=(null)']) {
      expect(parseTresString(input)?.cpus).toBeNull();
    }
  });

  test('malformed tokens do not throw', () => {
    expect(() => parseTresString('cpu=,mem=abc,node=-1,=5,noequals')).not.toThrow();
    expect(parseTresString('cpu=,mem=abc')).toMatchObject({ cpus: null, memoryMiB: null });
  });
});

describe('parseMemoryToMiB', () => {
  test.each([
    ['8000', 8000],
    ['8000M', 8000],
    ['8G', 8192],
    ['1024K', 1],
    ['abc', null],
    ['', null],
  ])('%s -> %s', (input, expected) => {
    expect(parseMemoryToMiB(input as string)).toBe(expected);
  });
});

describe('parseGresDetailEntries', () => {
  test('parses gpu:TYPE:N with IDX suffixes', () => {
    expect(parseGresDetailEntries(['gpu:a100:2(IDX:2-3)', 'gpu:v100:1'])).toEqual({
      total: 3,
      byType: { a100: 2, v100: 1 },
    });
  });

  test('ignores shard and unrelated GRES', () => {
    expect(parseGresDetailEntries(['shard:8(-/5,5/5)', 'gpu:a100:1', null])).toEqual({
      total: 1,
      byType: { a100: 1 },
    });
  });
});

describe('parseNodeGres', () => {
  test('derives configured vs allocated per type', () => {
    expect(parseNodeGres('gpu:a100:4', 'gpu:a100:2(IDX:0-1)')).toEqual({
      total: 4,
      allocated: 2,
      byType: { a100: { total: 4, allocated: 2 } },
    });
  });

  test('bare gpu:N counts as untyped, shard never counts', () => {
    const inventory = parseNodeGres('gpu:4,shard:8', 'gpu:1(IDX:0)');
    expect(inventory.total).toBe(4);
    expect(inventory.allocated).toBe(1);
    expect(inventory.byType).toEqual({ unknown: { total: 4, allocated: 1 } });
  });

  test('MIG-style typed entries keep their type', () => {
    const inventory = parseNodeGres('gpu:a100:4,gpu:mig-1g:2', null);
    expect(inventory.byType['mig-1g']).toEqual({ total: 2, allocated: 0 });
  });

  test('null sentinels mean no GPUs', () => {
    expect(parseNodeGres('(null)', '(null)')).toEqual({ total: 0, allocated: 0, byType: {} });
    expect(parseNodeGres(null, undefined)).toEqual({ total: 0, allocated: 0, byType: {} });
  });
});
