interface CpuLoadThresholds {
  lowMax: number;
  mediumMax: number;
}

type CpuLoadBucket = 'low' | 'medium' | 'high';

interface CpuLoadGroups {
  low: number;
  medium: number;
  high: number;
}

// Ratios below lowMax are low, through mediumMax are medium, and higher ratios are high.
function classifyCpuLoadBucket(ratio: number, thresholds: CpuLoadThresholds): CpuLoadBucket {
  if (ratio < thresholds.lowMax) {
    return 'low';
  }
  if (ratio <= thresholds.mediumMax) {
    return 'medium';
  }
  return 'high';
}

function emptyCpuLoadGroups(): CpuLoadGroups {
  return { low: 0, medium: 0, high: 0 };
}

interface CpuStats {
  configuredCpus: number;
  effectiveCpus: number;
  allocatedCpus: number;
  // These CPUs are schedulable and unallocated. The totals must satisfy
  // allocatedCpus + availableCpus + unavailableCpus === configuredCpus.
  availableCpus: number;
  unavailableCpus: number;
  loadGroups: {
    low: number;
    medium: number;
    high: number;
    unclassified: number;
  };
}

interface MemoryStats {
  totalMiB: number;
  allocatedMiB: number;
  // This estimate sums min(allocated, total - free) across non-down nodes.
  // It is null if any counted node lacks free-memory data. Memory total
  // invariants do not depend on this estimate.
  allocatedUsedMiB: number | null;
  unallocatedMiB: number;
  unavailableMiB: number;
  // OS-reported free memory is separate from the capacity invariant. This is
  // null unless every counted node reports it.
  freeMiB: number | null;
}

interface GpuTypeStats {
  total: number;
  allocated: number;
  available: number;
  unavailable: number;
}

interface GpuStats {
  total: number;
  allocated: number;
  available: number;
  unavailable: number;
  byType: Record<string, GpuTypeStats>;
}

interface ClusterStats {
  cpu: CpuStats;
  memory: MemoryStats;
  gpu: GpuStats;
}

export {
  classifyCpuLoadBucket,
  emptyCpuLoadGroups,
};
export type {
  ClusterStats,
  CpuLoadBucket,
  CpuLoadGroups,
  CpuLoadThresholds,
  CpuStats,
  GpuStats,
  GpuTypeStats,
  MemoryStats,
};
