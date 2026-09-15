import { expandSlurmHostlist } from '../../../src/server/adapters/slurm/hostlist.js';

describe('expandSlurmHostlist', () => {
  test('expands a simple range', () => {
    expect(expandSlurmHostlist('node[01-03]')).toEqual(['node01', 'node02', 'node03']);
  });

  test('expands comma lists inside brackets alongside top-level names', () => {
    expect(expandSlurmHostlist('node[01-02,05],gpu09')).toEqual([
      'node01',
      'node02',
      'node05',
      'gpu09',
    ]);
  });

  test('expands multiple bracket groups as a cartesian product', () => {
    expect(expandSlurmHostlist('rack[1-2]n[01-02]')).toEqual([
      'rack1n01',
      'rack1n02',
      'rack2n01',
      'rack2n02',
    ]);
  });

  test('returns an empty list for missing input', () => {
    expect(expandSlurmHostlist(null)).toEqual([]);
    expect(expandSlurmHostlist(undefined)).toEqual([]);
    expect(expandSlurmHostlist('')).toEqual([]);
  });
});
