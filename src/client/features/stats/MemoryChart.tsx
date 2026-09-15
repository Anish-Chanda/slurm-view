import { useMemo } from 'react';
import type { MemoryStatsDto } from '../../../shared/api/v1/stats.ts';
import { Sunburst } from './Sunburst.tsx';
import type { SunburstNode } from './Sunburst.tsx';
import { buildMemoryChartData, formatMiB } from './chart-data.ts';

const MEMORY_COLORS: Record<string, string> = {
  Allocated: '#e63946',
  Unallocated: '#2a9d8f',
  Unavailable: '#f4a261',
  Used: '#c1121f',
  Unused: '#f28482',
};

function memoryColorFor(node: SunburstNode): string {
  return MEMORY_COLORS[node.data.name] ?? '#888888';
}

function MemoryChart({
  memory,
  showSecondaryLayer,
}: {
  memory: MemoryStatsDto;
  showSecondaryLayer: boolean;
}) {
  const model = useMemo(
    () => buildMemoryChartData(memory, { showSecondaryLayer }),
    [memory, showSecondaryLayer]
  );
  return (
    <div className="w-full">
      <Sunburst
        model={model}
        center={{ title: 'Memory', total: formatMiB(memory.totalMiB) }}
        ariaLabel={`Memory utilization: ${formatMiB(memory.allocatedMiB)} allocated, ${formatMiB(memory.unallocatedMiB)} unallocated, ${formatMiB(memory.unavailableMiB)} unavailable of ${formatMiB(memory.totalMiB)} total`}
        colorFor={memoryColorFor}
      />
      <p className="mt-3 text-center text-xs text-gray-500">
        {memory.freeMiB === null
          ? 'OS-reported free memory not available on every node.'
          : `OS-reported free (informational): ${formatMiB(memory.freeMiB)}`}
      </p>
    </div>
  );
}

export { MemoryChart };
