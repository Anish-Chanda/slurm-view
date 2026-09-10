import { useMemo } from 'react';
import type { CpuStatsDto } from '../../../shared/api/v1/stats.ts';
import { Sunburst } from './Sunburst.tsx';
import type { SunburstNode } from './Sunburst.tsx';
import { buildCpuChartData } from './chart-data.ts';

const CPU_COLORS: Record<string, string> = {
  Allocated: '#e63946',
  Available: '#2a9d8f',
  Unavailable: '#f4a261',
  Low: '#8ecf7b',
  Medium: '#f6bd60',
  High: '#e76f51',
  Unclassified: '#9aa3ad',
};

function cpuColorFor(node: SunburstNode): string {
  return CPU_COLORS[node.data.name] ?? '#888888';
}

function CpuChart({ cpu, showSecondaryLayer }: { cpu: CpuStatsDto; showSecondaryLayer: boolean }) {
  const model = useMemo(
    () => buildCpuChartData(cpu, { showSecondaryLayer }),
    [cpu, showSecondaryLayer]
  );
  return (
    <div>
      <Sunburst
        model={model}
        center={{ title: 'CPU', total: String(cpu.configuredCpus) }}
        ariaLabel={`CPU utilization: ${cpu.allocatedCpus} allocated, ${cpu.availableCpus} available, ${cpu.unavailableCpus} unavailable of ${cpu.configuredCpus} configured CPUs`}
        colorFor={cpuColorFor}
      />
      <p className="mt-1 text-center text-xs text-gray-500">
        {cpu.effectiveCpus} effective CPUs of {cpu.configuredCpus} configured.
      </p>
    </div>
  );
}

export { CpuChart };
