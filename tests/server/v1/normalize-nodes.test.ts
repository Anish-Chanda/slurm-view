import * as fs from 'node:fs';
import * as path from 'node:path';
import { fetchNodes, parseNodesStdout } from '../../../src/server/adapters/slurm/nodes.js';
import { UpstreamInvalidError } from '../../../src/server/adapters/slurm/errors.js';
import type { SupportedDataParser } from '../../../src/server/adapters/slurm/parser-version.js';

const FIXTURES = path.join(__dirname, 'fixtures');

function nodesFixture(version: string): string {
  return fs.readFileSync(path.join(FIXTURES, `${version}-nodes.json`), 'utf8');
}

describe('parseNodesStdout', () => {
  test.each([
    ['v0.0.43', 'v43'],
    ['v0.0.44', 'v44'],
    ['v0.0.45', 'v45'],
  ] as Array<[SupportedDataParser, string]>)('normalizes %s fixture', (parser, version) => {
    const nodes = parseNodesStdout(parser, nodesFixture(version));
    expect(nodes).toHaveLength(4);

    const gpu = nodes[0]!;
    expect(gpu.name).toBe('gpu01');
    expect(gpu.state).toBe('MIXED');
    expect(gpu.stateFlags).toEqual([]);
    expect(gpu.partitions).toEqual(['gpu', 'debug']);
    expect(gpu.cpus).toBe(64);
    expect(gpu.allocCpus).toBe(16);
    expect(gpu.cpuLoad).toBe(12.5);
    expect(gpu.totalMemoryMiB).toBe(256000);
    expect(gpu.allocMemoryMiB).toBe(64000);
    expect(gpu.freeMemoryMiB).toBe(180000);
    expect(gpu.gpu).toEqual({
      total: 4,
      allocated: 2,
      byType: { a100: { total: 4, allocated: 2 } },
    });
  });

  test('plain numbers and (null) sentinels normalize', () => {
    const nodes = parseNodesStdout('v0.0.45', nodesFixture('v43'));
    const idle = nodes[1]!;
    expect(idle.cpuLoad).toBe(0.05);
    expect(idle.gpu).toEqual({ total: 0, allocated: 0, byType: {} });
    expect(idle.gresRaw).toBe('(null)');
  });

  test('drain flags split from base; shard excluded from GPU totals', () => {
    const nodes = parseNodesStdout('v0.0.45', nodesFixture('v43'));
    const drained = nodes[2]!;
    expect(drained.state).toBe('IDLE');
    expect(drained.stateFlags).toEqual(['DRAIN']);
    expect(drained.gpu.total).toBe(4);
    expect(drained.gpu.byType['shard']).toBeUndefined();
  });

  test('down node keeps capacity numbers for unavailable accounting', () => {
    const nodes = parseNodesStdout('v0.0.45', nodesFixture('v43'));
    const down = nodes[3]!;
    expect(down.state).toBe('DOWN');
    expect(down.cpus).toBe(32);
    expect(down.cpuLoad).toBeNull();
    expect(down.gpu.total).toBe(2);
  });

  test.each([
    ['missing cpus', { name: 'bad01', effective_cpus: 4, real_memory: 8000, alloc_cpus: 0, alloc_memory: 0 }],
    ['missing effective_cpus', { name: 'bad02', cpus: 4, real_memory: 8000, alloc_cpus: 0, alloc_memory: 0 }],
    ['missing real_memory', { name: 'bad03', cpus: 4, effective_cpus: 4, alloc_cpus: 0, alloc_memory: 0 }],
    ['missing alloc_cpus', { name: 'bad04', cpus: 4, effective_cpus: 4, real_memory: 8000, alloc_memory: 0 }],
    ['missing alloc_memory', { name: 'bad05', cpus: 4, effective_cpus: 4, real_memory: 8000, alloc_cpus: 0 }],
    ['unset cpus wrapper', { name: 'bad06', cpus: { number: 0, set: false }, effective_cpus: 4, real_memory: 8000, alloc_cpus: 0, alloc_memory: 0 }],
  ])('node with %s rejects the payload instead of zero-filling', (_label, node) => {
    expect(() =>
      parseNodesStdout('v0.0.45', JSON.stringify({ nodes: [node] }))
    ).toThrow(UpstreamInvalidError);
  });

  test('explicit zeros are valid; absent free_mem stays null', () => {
    const nodes = parseNodesStdout(
      'v0.0.45',
      JSON.stringify({
        nodes: [{ name: 'ok01', cpus: 4, effective_cpus: 4, real_memory: 8000, alloc_cpus: 0, alloc_memory: 0 }],
      })
    );
    expect(nodes[0]).toMatchObject({ allocCpus: 0, allocMemoryMiB: 0, freeMemoryMiB: null, cpuLoad: null });
  });
});

describe('fetchNodes', () => {
  test('issues versioned scontrol argv', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: nodesFixture('v45'), stderr: '' });
    const nodes = await fetchNodes({ parser: 'v0.0.45', run });
    expect(run).toHaveBeenCalledWith(
      'scontrol',
      ['--json=v0.0.45', 'show', 'node'],
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
    expect(nodes).toHaveLength(4);
  });
});
