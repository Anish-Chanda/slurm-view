import type { CpuStatsDto, GpuStatsDto, MemoryStatsDto } from '../../../shared/api/v1/stats.ts';

interface ChartDatum {
  name: string;
  value?: number;
  children?: ChartDatum[];
}

interface ChartModel {
  name: string;
  children: ChartDatum[];
}

// Segment order is fixed so slices never move around the circle when
// values change; D3 computes geometry from this already-ordered model.
//
// Child breakdowns always cover their parent completely: D3 sums leaf
// values only, so an incomplete breakdown would silently shrink the parent.
function buildCpuChartData(cpu: CpuStatsDto): ChartModel {
  // Load groups classify allocated CPUs; anything unexplained stays visible
  // as unclassified rather than disappearing from the chart.
  const unclassified = Math.max(
    0,
    cpu.allocatedCpus - cpu.loadGroups.low - cpu.loadGroups.medium - cpu.loadGroups.high,
  );
  return {
    name: 'CPU Utilization',
    children: [
      {
        name: 'Allocated',
        value: cpu.allocatedCpus,
        children: [
          { name: 'Low', value: cpu.loadGroups.low },
          { name: 'Medium', value: cpu.loadGroups.medium },
          { name: 'High', value: cpu.loadGroups.high },
          { name: 'Unclassified', value: unclassified },
        ],
      },
      { name: 'Available', value: cpu.availableCpus },
      { name: 'Unavailable', value: cpu.unavailableCpus },
    ],
  };
}

function buildMemoryChartData(memory: MemoryStatsDto): ChartModel {
  return {
    name: 'Memory Utilization',
    children: [
      { name: 'Allocated', value: memory.allocatedMiB },
      { name: 'Unallocated', value: memory.unallocatedMiB },
      { name: 'Unavailable', value: memory.unavailableMiB },
    ],
  };
}

function buildGpuChartData(gpu: GpuStatsDto): ChartModel {
  const types = Object.keys(gpu.byType).sort();
  // A type breakdown that does not cover its category gets a deterministic
  // remainder slice; one that exceeds it is dropped so the geometry never
  // contradicts the API total.
  const childrenFor = (
    total: number,
    pick: (type: string) => number,
  ): ChartDatum[] | undefined => {
    const typed = types.map((type) => ({ name: type, value: pick(type) }));
    const typedSum = typed.reduce((sum, entry) => sum + entry.value, 0);
    if (typedSum > total) return undefined;
    if (typedSum < total) return [...typed, { name: 'Unknown', value: total - typedSum }];
    return typed;
  };
  const allocatedChildren = childrenFor(gpu.allocated, (type) => gpu.byType[type]?.allocated ?? 0);
  const availableChildren = childrenFor(gpu.available, (type) => gpu.byType[type]?.available ?? 0);
  const unavailableChildren = childrenFor(
    gpu.unavailable,
    (type) => gpu.byType[type]?.unavailable ?? 0
  );
  return {
    name: 'GPU Utilization',
    children: [
      {
        name: 'Allocated',
        value: gpu.allocated,
        ...(allocatedChildren === undefined ? {} : { children: allocatedChildren }),
      },
      {
        name: 'Available',
        value: gpu.available,
        ...(availableChildren === undefined ? {} : { children: availableChildren }),
      },
      {
        name: 'Unavailable',
        value: gpu.unavailable,
        ...(unavailableChildren === undefined ? {} : { children: unavailableChildren }),
      },
    ],
  };
}

function formatMiB(mib: number): string {
  if (mib >= 1024 * 1024) {
    const tib = mib / (1024 * 1024);
    return `${tib >= 100 ? Math.round(tib) : Math.round(tib * 10) / 10} TiB`;
  }
  if (mib >= 1024) {
    const gib = mib / 1024;
    return `${gib >= 100 ? Math.round(gib) : Math.round(gib * 10) / 10} GiB`;
  }
  return `${mib} MiB`;
}

export { buildCpuChartData, buildGpuChartData, buildMemoryChartData, formatMiB };
export type { ChartDatum, ChartModel };
