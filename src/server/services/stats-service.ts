import { nodeAvailability } from '../models/node.js';
import type { NodeSnapshot } from '../cache/nodes-cache.js';
import type { ClusterNode } from '../models/node.js';
import { classifyCpuLoadBucket, emptyCpuLoadGroups } from '../models/stats.js';
import type {
  ClusterStats,
  CpuLoadThresholds,
  CpuStats,
  GpuStats,
  MemoryStats,
} from '../models/stats.js';

// Aggregates CPU/memory/GPU from one node snapshot.
//
// CPU invariant: allocated + available + unavailable === configured.
// Hard-down nodes count whole as unavailable. Otherwise configured
// capacity outside the effective set counts as unavailable, allocations
// persist, and only the unallocated effective remainder is available on
// schedulable nodes or unavailable on restricted ones. Memory invariant:
// allocated + unallocated + unavailable === total. `freeMiB` sums
// OS-reported FreeMem over every node except hard-down ones and sits
// outside that invariant.
interface StatsSource {
  getOrLoad(options?: { signal?: AbortSignal }): Promise<NodeSnapshot>;
}

const DEFAULT_CPU_LOAD_THRESHOLDS: CpuLoadThresholds = {
  lowMax: 0.33,
  mediumMax: 0.66,
};

function emptyCpuStats(): CpuStats {
  return {
    configuredCpus: 0,
    effectiveCpus: 0,
    allocatedCpus: 0,
    availableCpus: 0,
    unavailableCpus: 0,
    loadGroups: { ...emptyCpuLoadGroups(), unclassified: 0 },
  };
}

function emptyMemoryStats(): MemoryStats {
  return { totalMiB: 0, allocatedMiB: 0, allocatedUsedMiB: 0, unallocatedMiB: 0, unavailableMiB: 0, freeMiB: 0 };
}

function emptyGpuStats(): GpuStats {
  return { total: 0, allocated: 0, available: 0, unavailable: 0, byType: {} };
}

function summarizeCpu(nodes: readonly ClusterNode[], thresholds: CpuLoadThresholds): CpuStats {
  const stats = emptyCpuStats();
  for (const node of nodes) {
    const availability = nodeAvailability(node.state, node.stateFlags);
    stats.configuredCpus += node.cpus;
    stats.effectiveCpus += node.effectiveCpus;
    if (availability === 'down') {
      stats.unavailableCpus += node.cpus;
      continue;
    }
    // Configured capacity outside the effective set is specialized away
    // from scheduling entirely.
    stats.unavailableCpus += Math.max(0, node.cpus - node.effectiveCpus);
    stats.allocatedCpus += node.allocCpus;
    if (node.allocCpus > 0) {
      if (node.cpuLoad === null) {
        stats.loadGroups.unclassified += node.allocCpus;
      } else {
        const bucket = classifyCpuLoadBucket(node.cpuLoad / node.allocCpus, thresholds);
        stats.loadGroups[bucket] += node.allocCpus;
      }
    }
    const remainingEffective = Math.max(0, node.effectiveCpus - node.allocCpus);
    if (availability === 'restricted') {
      stats.unavailableCpus += remainingEffective;
    } else {
      stats.availableCpus += remainingEffective;
    }
  }
  return stats;
}

function summarizeMemory(nodes: readonly ClusterNode[]): MemoryStats {
  const stats = emptyMemoryStats();
  let freeSum = 0;
  let freeComplete = true;
  let usedSum = 0;
  let usedComplete = true;
  let counted = 0;
  for (const node of nodes) {
    stats.totalMiB += node.totalMemoryMiB;
    const availability = nodeAvailability(node.state, node.stateFlags);
    if (availability === 'down') {
      stats.unavailableMiB += node.totalMemoryMiB;
      continue;
    }
    counted += 1;
    const allocated = Math.min(node.allocMemoryMiB, node.totalMemoryMiB);
    stats.allocatedMiB += allocated;
    const remainder = Math.max(0, node.totalMemoryMiB - allocated);
    if (availability === 'restricted') {
      stats.unavailableMiB += remainder;
    } else {
      stats.unallocatedMiB += remainder;
    }
    if (node.freeMemoryMiB === null) {
      freeComplete = false;
      usedComplete = false;
    } else {
      freeSum += node.freeMemoryMiB;
      // Ported from the legacy getAllocatedMemoryInUse(realMem, allocMem,
      // freeMem): usedByOs = max(0, real - free), used = min(alloc, usedByOs).
      usedSum += Math.min(allocated, Math.max(0, node.totalMemoryMiB - node.freeMemoryMiB));
    }
  }
  stats.freeMiB = counted === 0 || freeComplete ? freeSum : null;
  stats.allocatedUsedMiB = counted === 0 || usedComplete ? usedSum : null;
  return stats;
}

function summarizeGpu(nodes: readonly ClusterNode[]): GpuStats {
  const stats = emptyGpuStats();
  for (const node of nodes) {
    const availability = nodeAvailability(node.state, node.stateFlags);
    stats.total += node.gpu.total;
    if (availability === 'down') {
      stats.unavailable += node.gpu.total;
    } else {
      const allocated = Math.min(node.gpu.allocated, node.gpu.total);
      const remainder = Math.max(0, node.gpu.total - allocated);
      stats.allocated += allocated;
      if (availability === 'restricted') {
        stats.unavailable += remainder;
      } else {
        stats.available += remainder;
      }
    }
    for (const [gpuType, entry] of Object.entries(node.gpu.byType)) {
      const typeStats = stats.byType[gpuType] ?? { total: 0, allocated: 0, available: 0, unavailable: 0 };
      typeStats.total += entry.total;
      if (availability === 'down') {
        typeStats.unavailable += entry.total;
      } else {
        const allocated = Math.min(entry.allocated, entry.total);
        const remainder = Math.max(0, entry.total - allocated);
        typeStats.allocated += allocated;
        if (availability === 'restricted') {
          typeStats.unavailable += remainder;
        } else {
          typeStats.available += remainder;
        }
      }
      stats.byType[gpuType] = typeStats;
    }
  }
  return stats;
}

interface StatsResult {
  stats: ClusterStats;
  updatedAt: Date;
}

class StatsService {
  constructor(
    private readonly source: StatsSource,
    private readonly thresholds: CpuLoadThresholds = DEFAULT_CPU_LOAD_THRESHOLDS
  ) {}

  // A partition scopes to member nodes; null counts every node once.
  async getStats(partition: string | null = null): Promise<StatsResult> {
    const snapshot = await this.source.getOrLoad();
    const nodes =
      partition === null
        ? snapshot.nodes
        : snapshot.nodes.filter((node) => node.partitions.includes(partition));
    return {
      stats: {
        cpu: summarizeCpu(nodes, this.thresholds),
        memory: summarizeMemory(nodes),
        gpu: summarizeGpu(nodes),
      },
      updatedAt: snapshot.capturedAt,
    };
  }
}

export {
  DEFAULT_CPU_LOAD_THRESHOLDS,
  StatsService,
  summarizeCpu,
  summarizeGpu,
  summarizeMemory,
};
export type { StatsResult, StatsSource };
