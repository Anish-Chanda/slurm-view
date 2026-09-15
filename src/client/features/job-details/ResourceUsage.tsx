import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CpuEfficiencyDto, MemoryEfficiencyDto } from '../../../shared/api/v1/efficiency.ts';
import { efficiencyQueryOptions } from '../../api/efficiency.ts';
import { errorMessage } from '../../api/client.ts';
import { RefreshWarning } from '../../components/RefreshWarning.tsx';
import { MISSING, formatDuration, formatMemoryMiB } from '../jobs/formatting.ts';

// Bars are decorative: every value they encode also appears as text.
function UsageBar({ percent }: { percent: number | null }) {
  if (percent === null) {
    return null;
  }
  return (
    <div aria-hidden="true" className="mt-1.5 h-1.5 w-full rounded bg-gray-200">
      <div
        className="h-1.5 rounded bg-blue-600"
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

function formatPercent(value: number | null): string {
  return value === null ? MISSING : `${value}%`;
}

function UsageBlock({
  label,
  percent,
  evidence,
}: {
  label: string;
  percent: number | null;
  evidence: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-gray-700">{label}</h3>
        <span className="text-lg font-semibold tabular-nums text-gray-900">{formatPercent(percent)}</span>
      </div>
      <UsageBar percent={percent} />
      <p className="mt-1.5 text-sm tabular-nums text-gray-600">{evidence}</p>
    </div>
  );
}

function CpuBlock({ cpu }: { cpu: CpuEfficiencyDto }) {
  const used = cpu.utilizedSeconds !== null ? formatDuration(cpu.utilizedSeconds) : MISSING;
  const allocated = cpu.allocatedCoreSeconds !== null ? formatDuration(cpu.allocatedCoreSeconds) : MISSING;
  return <UsageBlock label="CPU" percent={cpu.efficiencyPercent} evidence={`${used} used / ${allocated} allocated`} />;
}

function MemoryBlock({ memory }: { memory: MemoryEfficiencyDto }) {
  const used = memory.utilizedMiB !== null ? formatMemoryMiB(memory.utilizedMiB) : MISSING;
  const allocated = memory.allocatedMiB !== null ? formatMemoryMiB(memory.allocatedMiB) : MISSING;
  return <UsageBlock label="Memory" percent={memory.efficiencyPercent} evidence={`${used} peak / ${allocated} allocated`} />;
}

function ResourceUsageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading resource usage" className="grid gap-6 md:grid-cols-2">
      {[0, 1].map((index) => (
        <div key={index}>
          <div className="h-5 w-24 animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-2 animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

// Mounted only for completed jobs: seff data describes finished execution.
// Percentages are descriptive data as reported, never grades. A future GPU
// block slots in beside CPU and Memory.
function ResourceUsage({ jobId }: { jobId: string }) {
  const efficiencyQuery = useQuery(efficiencyQueryOptions(jobId));

  let body: ReactNode;
  if (efficiencyQuery.data === undefined) {
    body = efficiencyQuery.isPending ? (
      <ResourceUsageSkeleton />
    ) : (
      <div className="border border-gray-200 bg-white px-4 py-3">
        <p className="text-sm text-gray-700">Efficiency data is unavailable for this job.</p>
        <p className="mt-1 text-xs text-gray-500">{errorMessage(efficiencyQuery.error)}</p>
        <button
          type="button"
          onClick={() => void efficiencyQuery.refetch()}
          className="mt-2 rounded bg-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Retry
        </button>
      </div>
    );
  } else {
    body = (
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        <CpuBlock cpu={efficiencyQuery.data.cpu} />
        <MemoryBlock memory={efficiencyQuery.data.memory} />
      </div>
    );
  }

  return (
    <section id="resource-usage" aria-label="Resource usage">
      <h2 className="text-base font-semibold tracking-tight text-gray-900">Resource usage</h2>
      <div className="mt-3">{body}</div>
      {efficiencyQuery.data !== undefined && efficiencyQuery.isError ? (
        <div className="mt-3">
          <RefreshWarning
            message="Showing previous efficiency data because the latest request failed."
            onRetry={() => void efficiencyQuery.refetch()}
          />
        </div>
      ) : null}
    </section>
  );
}

export { ResourceUsage };
