import { useMemo } from 'react';
import type { GpuStatsDto } from '../../../shared/api/v1/stats.ts';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Sunburst } from './Sunburst.tsx';
import type { SunburstNode } from './Sunburst.tsx';
import { buildGpuChartData } from './chart-data.ts';

const GPU_COLORS: Record<string, string> = {
  Allocated: '#e63946',
  Available: '#2a9d8f',
  Unavailable: '#f4a261',
};

const GPU_TYPE_PALETTE = ['#e63946', '#f3722c', '#2a9d8f', '#52b788', '#f4a261', '#9aa3ad', '#8b5cf6'];

function hashTypeName(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function gpuColorFor(node: SunburstNode): string {
  if (node.depth === 1) return GPU_COLORS[node.data.name] ?? '#888888';
  return GPU_TYPE_PALETTE[hashTypeName(node.data.name) % GPU_TYPE_PALETTE.length] ?? '#888888';
}

function GpuChart({ gpu }: { gpu: GpuStatsDto }) {
  const model = useMemo(() => buildGpuChartData(gpu), [gpu]);
  if (gpu.total === 0) {
    return <EmptyState message="No GPUs in this scope." />;
  }
  return (
    <Sunburst
      model={model}
      centerText={`GPU Total: ${gpu.total}`}
      ariaLabel={`GPU utilization: ${gpu.allocated} allocated, ${gpu.available} available, ${gpu.unavailable} unavailable of ${gpu.total} total GPUs`}
      colorFor={gpuColorFor}
    />
  );
}

export { GpuChart };
