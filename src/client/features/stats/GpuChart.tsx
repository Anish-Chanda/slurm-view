import { useCallback, useMemo } from 'react';
import type { GpuStatsDto } from '../../../shared/api/v1/stats.ts';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Sunburst } from './Sunburst.tsx';
import type { SunburstNode } from './Sunburst.tsx';
import { buildGpuChartData } from './chart-data.ts';

const GPU_STATE_COLORS: Record<string, string> = {
  Allocated: '#e63946',
  Available: '#2a9d8f',
  Unavailable: '#f4a261',
};

// Semantic shade families (ported from the legacy charts.js palettes).
// Each GPU type keeps one stable index from the globally sorted type list;
// the same relative shade is used inside every parent family so type
// identity is consistent while the parent state keeps its color meaning.
const ALLOCATED_SHADES = ['#e63946', '#f94144', '#f3722c', '#f8961e', '#f9844a'];
const AVAILABLE_SHADES = ['#2a9d8f', '#52b788', '#76c893', '#99d98c', '#b5e48c'];
const UNAVAILABLE_SHADES = ['#f4a261', '#f1a66b', '#edae74', '#e7b57f', '#e1bc8b'];

const PARENT_SHADES: Record<string, string[]> = {
  Allocated: ALLOCATED_SHADES,
  Available: AVAILABLE_SHADES,
  Unavailable: UNAVAILABLE_SHADES,
};

function gpuColorFor(node: SunburstNode, typeIndex: ReadonlyMap<string, number>): string {
  if (node.depth === 1) return GPU_STATE_COLORS[node.data.name] ?? '#888888';
  const parentName = node.parent?.data.name ?? '';
  const shades = PARENT_SHADES[parentName];
  if (!shades) return '#888888';
  // The `Unknown` remainder slice (untyped GPUs) takes the next slot after
  // the sorted types so it stays inside the parent family.
  const index = typeIndex.get(node.data.name) ?? typeIndex.size;
  return shades[index % shades.length] ?? '#888888';
}

function GpuChart({
  gpu,
  showSecondaryLayer,
}: {
  gpu: GpuStatsDto;
  showSecondaryLayer: boolean;
}) {
  const typeIndex = useMemo(() => {
    const types = Object.keys(gpu.byType).sort();
    return new Map(types.map((type, index) => [type, index] as const));
  }, [gpu]);
  const model = useMemo(
    () => buildGpuChartData(gpu, { showSecondaryLayer }),
    [gpu, showSecondaryLayer]
  );
  const colorFor = useCallback((node: SunburstNode) => gpuColorFor(node, typeIndex), [typeIndex]);
  if (gpu.total === 0) {
    return <EmptyState message="No GPUs in this scope." />;
  }
  return (
    <Sunburst
      model={model}
      center={{ title: 'GPU', total: String(gpu.total) }}
      ariaLabel={`GPU utilization: ${gpu.allocated} allocated, ${gpu.available} available, ${gpu.unavailable} unavailable of ${gpu.total} total GPUs`}
      colorFor={colorFor}
    />
  );
}

export { ALLOCATED_SHADES, AVAILABLE_SHADES, UNAVAILABLE_SHADES, gpuColorFor, GpuChart };
