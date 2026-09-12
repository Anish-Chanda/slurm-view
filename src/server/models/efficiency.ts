interface CpuEfficiency {
  efficiencyPercent: number | null;
  utilizedSeconds: number | null;
  allocatedCoreSeconds: number | null;
}

interface MemoryEfficiency {
  efficiencyPercent: number | null;
  utilizedMiB: number | null;
  allocatedMiB: number | null;
}

interface Efficiency {
  cpu: CpuEfficiency;
  memory: MemoryEfficiency;
  wallClockSeconds: number | null;
}

export type { CpuEfficiency, Efficiency, MemoryEfficiency };
