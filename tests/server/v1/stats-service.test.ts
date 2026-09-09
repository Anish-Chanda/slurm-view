import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseNodesStdout } from '../../../src/server/adapters/slurm/nodes.js';
import type { ClusterNode } from '../../../src/server/models/node.js';
import type { NodeSnapshot } from '../../../src/server/cache/nodes-cache.js';
import { StatsService } from '../../../src/server/services/stats-service.js';
import type { StatsSource } from '../../../src/server/services/stats-service.js';

const FIXTURES = path.join(__dirname, 'fixtures');

function loadNodes(): ClusterNode[] {
  const stdout = fs.readFileSync(path.join(FIXTURES, 'v45-nodes.json'), 'utf8');
  return parseNodesStdout('v0.0.45', stdout);
}

function serviceFor(nodes: ClusterNode[]): StatsService {
  const snapshot: NodeSnapshot = { nodes, capturedAt: new Date('2026-09-09T12:00:00.000Z') };
  const source: StatsSource = { getOrLoad: () => Promise.resolve(snapshot) };
  return new StatsService(source);
}

describe('StatsService.getStats', () => {
  test('aggregates overall CPU from the node snapshot', async () => {
    const { stats } = await serviceFor(loadNodes()).getStats(null);
    expect(stats.cpu).toEqual({
      configuredCpus: 192,
      effectiveCpus: 156,
      allocatedCpus: 16,
      // down01 contributes 32 whole-node unavailable; the IDLE+DRAIN
      // node contributes its 60 unallocated effective CPUs.
      unavailableCpus: 92,
      loadGroups: { low: 0, medium: 0, high: 16, unclassified: 0 },
    });
  });

  test('memory honors allocated + unallocated + unavailable === total', async () => {
    const { stats } = await serviceFor(loadNodes()).getStats(null);
    expect(stats.memory).toEqual({
      totalMiB: 768000,
      allocatedMiB: 64000,
      unallocatedMiB: 320000,
      // DRAIN remainder (256000) + DOWN node (128000).
      unavailableMiB: 384000,
      freeMiB: 550000,
    });
    expect(
      stats.memory.allocatedMiB + stats.memory.unallocatedMiB + stats.memory.unavailableMiB
    ).toBe(stats.memory.totalMiB);
  });

  test('GPU comes from node gres/gres_used, shard excluded', async () => {
    const { stats } = await serviceFor(loadNodes()).getStats(null);
    expect(stats.gpu).toEqual({
      total: 10,
      allocated: 2,
      available: 2,
      unavailable: 6,
      byType: {
        a100: { total: 8, allocated: 2, available: 2, unavailable: 4 },
        v100: { total: 2, allocated: 0, available: 0, unavailable: 2 },
      },
    });
    expect(stats.gpu.byType['shard']).toBeUndefined();
  });

  test('multi-partition nodes count once cluster-wide', async () => {
    const { stats } = await serviceFor(loadNodes()).getStats(null);
    // gpu01 belongs to gpu+debug but contributes its 64 CPUs once.
    expect(stats.cpu.configuredCpus).toBe(192);
  });

  test('partition scope filters by structured membership', async () => {
    const { stats } = await serviceFor(loadNodes()).getStats('gpu');
    expect(stats.cpu).toMatchObject({
      configuredCpus: 128,
      effectiveCpus: 124,
      allocatedCpus: 16,
      unavailableCpus: 60,
    });
    expect(stats.memory).toMatchObject({
      totalMiB: 512000,
      allocatedMiB: 64000,
      unallocatedMiB: 192000,
      unavailableMiB: 256000,
      freeMiB: 430000,
    });
    expect(stats.gpu).toMatchObject({ total: 8, allocated: 2, available: 2, unavailable: 4 });
  });

  test('partition without GPUs yields zero GPU stats, not pseudo-nodes', async () => {
    const { stats } = await serviceFor(loadNodes()).getStats('compute');
    expect(stats.gpu).toEqual({
      total: 2,
      allocated: 0,
      available: 0,
      unavailable: 2,
      byType: { v100: { total: 2, allocated: 0, available: 0, unavailable: 2 } },
    });
  });

  test('empty partition yields zeros with the invariant intact', async () => {
    const { stats } = await serviceFor(loadNodes()).getStats('no-such-partition');
    expect(stats.cpu.configuredCpus).toBe(0);
    expect(stats.memory.totalMiB).toBe(0);
    expect(stats.memory.freeMiB).toBe(0);
    expect(stats.gpu.total).toBe(0);
  });

  test('freeMiB is null when any counted node omits it', async () => {
    const nodes = loadNodes();
    const withoutFree: ClusterNode = { ...nodes[1]!, freeMemoryMiB: null };
    const { stats } = await serviceFor([nodes[0]!, withoutFree]).getStats(null);
    expect(stats.memory.freeMiB).toBeNull();
    expect(
      stats.memory.allocatedMiB + stats.memory.unallocatedMiB + stats.memory.unavailableMiB
    ).toBe(stats.memory.totalMiB);
  });

  test('allocated capacity without a usable load ratio is unclassified, never folded away', async () => {
    const nodes = loadNodes();
    const noLoad: ClusterNode = {
      ...nodes[0]!,
      name: 'mystery01',
      cpuLoad: null,
      gpu: { total: 0, allocated: 0, byType: {} },
      gresRaw: null,
      gresUsedRaw: null,
    };
    const { stats } = await serviceFor([noLoad]).getStats(null);
    expect(stats.cpu.allocatedCpus).toBe(16);
    expect(stats.cpu.loadGroups).toEqual({ low: 0, medium: 0, high: 0, unclassified: 16 });
  });

  test('load bucket boundaries follow lowMax/mediumMax', async () => {
    const nodes = loadNodes();
    const low: ClusterNode = { ...nodes[0]!, name: 'low01', allocCpus: 100, cpuLoad: 10 };
    const medium: ClusterNode = { ...nodes[0]!, name: 'med01', allocCpus: 100, cpuLoad: 50 };
    const high: ClusterNode = { ...nodes[0]!, name: 'high01', allocCpus: 100, cpuLoad: 90 };
    const { stats } = await serviceFor([low, medium, high]).getStats(null);
    // Ratios 0.1 / 0.5 / 0.9 against defaults 0.33 / 0.66.
    expect(stats.cpu.loadGroups).toEqual({ low: 100, medium: 100, high: 100, unclassified: 0 });
  });

  test('returns the snapshot timestamp', async () => {
    const { updatedAt } = await serviceFor(loadNodes()).getStats(null);
    expect(updatedAt).toEqual(new Date('2026-09-09T12:00:00.000Z'));
  });
});

describe('restricted nodes keep their allocations', () => {
  function makeNode(overrides: Partial<ClusterNode>): ClusterNode {
    return {
      name: 'test01',
      partitions: ['p'],
      state: 'IDLE',
      stateFlags: [],
      cpus: 16,
      effectiveCpus: 16,
      allocCpus: 0,
      allocIdleCpus: 0,
      cpuLoad: null,
      totalMemoryMiB: 64000,
      allocMemoryMiB: 0,
      freeMemoryMiB: 64000,
      gresRaw: null,
      gresUsedRaw: null,
      gpu: { total: 0, allocated: 0, byType: {} },
      ...overrides,
    };
  }

  test('IDLE+DRAIN: no allocation, capacity unavailable for new work', async () => {
    const { stats } = await serviceFor([
      makeNode({ stateFlags: ['DRAIN'] }),
    ]).getStats(null);
    expect(stats.cpu).toMatchObject({ allocatedCpus: 0, unavailableCpus: 16 });
    expect(stats.memory).toMatchObject({
      allocatedMiB: 0,
      unallocatedMiB: 0,
      unavailableMiB: 64000,
    });
  });

  test('MIXED+DRAIN with allocations keeps them and classifies load', async () => {
    const { stats } = await serviceFor([
      makeNode({
        state: 'MIXED',
        stateFlags: ['DRAIN'],
        allocCpus: 8,
        cpuLoad: 4,
        allocMemoryMiB: 32000,
        freeMemoryMiB: 20000,
        gpu: { total: 2, allocated: 1, byType: { a100: { total: 2, allocated: 1 } } },
      }),
    ]).getStats(null);
    expect(stats.cpu.allocatedCpus).toBe(8);
    expect(stats.cpu.unavailableCpus).toBe(8);
    expect(stats.cpu.loadGroups).toMatchObject({ medium: 8, unclassified: 0 });
    expect(stats.memory).toMatchObject({
      allocatedMiB: 32000,
      unallocatedMiB: 0,
      unavailableMiB: 32000,
    });
    expect(stats.gpu).toMatchObject({ total: 2, allocated: 1, available: 0, unavailable: 1 });
  });

  test('ALLOCATED+DRAIN keeps the full allocation', async () => {
    const { stats } = await serviceFor([
      makeNode({
        state: 'ALLOCATED',
        stateFlags: ['DRAIN'],
        allocCpus: 16,
        cpuLoad: 15,
        allocMemoryMiB: 64000,
        freeMemoryMiB: 1000,
      }),
    ]).getStats(null);
    expect(stats.cpu).toMatchObject({ allocatedCpus: 16, unavailableCpus: 0 });
    expect(stats.memory).toMatchObject({ allocatedMiB: 64000, unavailableMiB: 0 });
  });

  test('FAILING keeps allocations, remainder unavailable', async () => {
    const { stats } = await serviceFor([
      makeNode({
        state: 'MIXED',
        stateFlags: ['FAILING'],
        allocCpus: 8,
        cpuLoad: 4,
        allocMemoryMiB: 32000,
        gpu: { total: 2, allocated: 2, byType: { a100: { total: 2, allocated: 2 } } },
      }),
    ]).getStats(null);
    expect(stats.cpu).toMatchObject({ allocatedCpus: 8, unavailableCpus: 8 });
    expect(stats.memory).toMatchObject({ allocatedMiB: 32000, unavailableMiB: 32000 });
    expect(stats.gpu).toMatchObject({ total: 2, allocated: 2, available: 0, unavailable: 0 });
  });

  test('FAIL, POWERED_DOWN, and POWERING_DOWN count whole', async () => {
    const { stats } = await serviceFor([
      makeNode({ name: 'fail01', stateFlags: ['FAIL'], allocCpus: 8, allocMemoryMiB: 32000 }),
      makeNode({ name: 'pd01', stateFlags: ['POWERED_DOWN'] }),
      makeNode({ name: 'png01', stateFlags: ['POWERING_DOWN'], allocCpus: 4, allocMemoryMiB: 8000 }),
    ]).getStats(null);
    expect(stats.cpu).toMatchObject({ allocatedCpus: 0, unavailableCpus: 48 });
    expect(stats.memory).toMatchObject({ allocatedMiB: 0, unavailableMiB: 192000 });
  });

  test('DOWN discards stale allocations as whole-node unavailable', async () => {
    const { stats } = await serviceFor([
      makeNode({
        state: 'DOWN',
        allocCpus: 8,
        allocMemoryMiB: 32000,
        gpu: { total: 2, allocated: 2, byType: { a100: { total: 2, allocated: 2 } } },
      }),
    ]).getStats(null);
    expect(stats.cpu).toMatchObject({ allocatedCpus: 0, unavailableCpus: 16 });
    expect(stats.memory).toMatchObject({ allocatedMiB: 0, unavailableMiB: 64000 });
    expect(stats.gpu).toMatchObject({ allocated: 0, available: 0, unavailable: 2 });
  });

  test('normal MIXED leaves unallocated capacity idle, normal ALLOCATED is fully allocated', async () => {
    const { stats } = await serviceFor([
      makeNode({ state: 'MIXED', allocCpus: 4, cpuLoad: 1, allocMemoryMiB: 16000 }),
      makeNode({
        name: 'test02',
        state: 'ALLOCATED',
        allocCpus: 16,
        cpuLoad: 15,
        allocMemoryMiB: 64000,
      }),
    ]).getStats(null);
    expect(stats.cpu).toMatchObject({ allocatedCpus: 20, unavailableCpus: 0 });
    expect(stats.cpu.loadGroups).toMatchObject({ low: 4, high: 16 });
    expect(stats.memory).toMatchObject({
      allocatedMiB: 80000,
      unallocatedMiB: 48000,
      unavailableMiB: 0,
    });
  });
});
