// Stats API contract. Memory values are in MiB.
export interface CpuStatsDto {
  configuredCpus: number;
  effectiveCpus: number;
  allocatedCpus: number;
  // These counts partition configured CPUs:
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

export interface MemoryStatsDto {
  totalMiB: number;
  allocatedMiB: number;
  /**
   * Estimated allocated memory in use. Null unless every counted non-down
   * node reports free memory; partial sums are not returned. The difference
   * from allocatedMiB is reserved but idle memory. This value is excluded
   * from the allocated + unallocated + unavailable === total invariant.
   */
  allocatedUsedMiB: number | null;
  unallocatedMiB: number;
  unavailableMiB: number;
  /**
   * OS-reported free memory, for information only. Null unless every counted
   * node reports it; partial sums are not returned. Excluded from the
   * allocated + unallocated + unavailable === total invariant.
   */
  freeMiB: number | null;
}

export interface GpuTypeStatsDto {
  total: number;
  allocated: number;
  available: number;
  unavailable: number;
}

export interface GpuStatsDto {
  total: number;
  allocated: number;
  available: number;
  unavailable: number;
  byType: Record<string, GpuTypeStatsDto>;
}

export interface StatsResponse {
  cpu: CpuStatsDto;
  memory: MemoryStatsDto;
  gpu: GpuStatsDto;
  updatedAt: string;
}
