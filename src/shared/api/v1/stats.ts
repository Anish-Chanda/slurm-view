// Public v1 stats contract: semantic data with explicit MiB units.
export interface CpuStatsDto {
  configuredCpus: number;
  effectiveCpus: number;
  allocatedCpus: number;
  // Schedulable and unallocated. Invariant:
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
   * Estimated portion of allocated memory in use (see server MemoryStats).
   * Null unless every counted non-down node reports free memory; never a
   * partial sum. When present, `allocatedMiB - allocatedUsedMiB` is the
   * unused (reserved but idle) portion. Not part of the invariant
   * allocated + unallocated + unavailable === total.
   */
  allocatedUsedMiB: number | null;
  unallocatedMiB: number;
  unavailableMiB: number;
  /**
   * OS-reported free memory (informational only). Null unless every counted
   * node reports it; never a partial sum. Not part of the invariant
   * allocated + unallocated + unavailable === total.
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
