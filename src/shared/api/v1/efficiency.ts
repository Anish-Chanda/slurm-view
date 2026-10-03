// Efficiency API contract. Percentages are reported by seff; units are explicit.
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
