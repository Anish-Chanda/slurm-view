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

// ratio < lowMax → low; ratio <= mediumMax → medium; else high.
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
  unallocatedMiB: number;
  unavailableMiB: number;
  // OS-reported free memory, informational only. Null unless every
  // counted node reports it; never a partial sum. Outside the invariant.
  //
  // Invariant: allocatedMiB + unallocatedMiB + unavailableMiB === totalMiB
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
