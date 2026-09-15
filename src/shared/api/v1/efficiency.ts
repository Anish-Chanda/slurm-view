// Public v1 efficiency contract: semantic numerics with explicit units.
// Percentages are descriptive data as reported by seff, never grades.
export interface CpuEfficiencyDto {
  efficiencyPercent: number | null;
  utilizedSeconds: number | null;
  allocatedCoreSeconds: number | null;
}

export interface MemoryEfficiencyDto {
  efficiencyPercent: number | null;
  utilizedMiB: number | null;
  allocatedMiB: number | null;
}

export interface EfficiencyResponse {
  cpu: CpuEfficiencyDto;
  memory: MemoryEfficiencyDto;
  wallClockSeconds: number | null;
  updatedAt: string;
}
