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

interface ChartLayerPolicy {
  showSecondaryLayer: boolean;
}

// Sort segments for stable layout across refreshes. Children cover their
// parent because D3 sums leaf values; DTO labels retain the legacy color groups.
function buildCpuChartData(cpu: CpuStatsDto, policy: ChartLayerPolicy = { showSecondaryLayer: true }): ChartModel {
  if (!policy.showSecondaryLayer) {
    return {
      name: 'CPU Utilization',
      children: [
        { name: 'Allocated', value: cpu.allocatedCpus },
        { name: 'Available', value: cpu.availableCpus },
        { name: 'Unavailable', value: cpu.unavailableCpus },
      ],
    };
  }
  // Keep unexplained allocated CPUs visible as unclassified.
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

function buildMemoryChartData(
  memory: MemoryStatsDto,
  policy: ChartLayerPolicy = { showSecondaryLayer: true },
): ChartModel {
  const flat: ChartModel = {
    name: 'Memory Utilization',
    children: [
      { name: 'Allocated', value: memory.allocatedMiB },
      { name: 'Unallocated', value: memory.unallocatedMiB },
      { name: 'Unavailable', value: memory.unavailableMiB },
    ],
  };
  // Split used and unused memory only when every counted non-down node
  // reports OS free memory; otherwise the value is null and the chart stays flat.
  const usedTotal = memory.allocatedUsedMiB ?? null;
  if (!policy.showSecondaryLayer || usedTotal === null) {
    return flat;
  }
  const used = Math.min(usedTotal, memory.allocatedMiB);
  const unused = Math.max(0, memory.allocatedMiB - used);
  const children: ChartDatum[] = [];
  if (used > 0) children.push({ name: 'Used', value: used });
  if (unused > 0) children.push({ name: 'Unused', value: unused });
  if (children.length === 0) {
    return flat;
  }
  return {
    name: 'Memory Utilization',
    children: [
      { name: 'Allocated', value: memory.allocatedMiB, children },
      { name: 'Unallocated', value: memory.unallocatedMiB },
      { name: 'Unavailable', value: memory.unavailableMiB },
    ],
  };
}

function buildGpuChartData(
  gpu: GpuStatsDto,
  policy: ChartLayerPolicy = { showSecondaryLayer: true },
): ChartModel {
  const collapse = (name: string, value: number): ChartDatum => ({ name, value });
  if (!policy.showSecondaryLayer) {
    return {
      name: 'GPU Utilization',
      children: [
        collapse('Allocated', gpu.allocated),
        collapse('Available', gpu.available),
        collapse('Unavailable', gpu.unavailable),
      ],
    };
  }
  const types = Object.keys(gpu.byType).sort();
  // Add a remainder when type totals are short; discard breakdowns that
  // exceed the API total so the chart geometry stays consistent.
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
export type { ChartDatum, ChartLayerPolicy, ChartModel };
