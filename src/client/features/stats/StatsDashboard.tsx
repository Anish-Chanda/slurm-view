import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { fetchPartitions } from '../../api/partitions.ts';
import { fetchStats } from '../../api/stats.ts';
import { partitionKeys, statsKeys } from '../../api/query-keys.ts';
import { ErrorPanel } from '../../components/ErrorPanel.tsx';
import { RefreshWarning } from '../../components/RefreshWarning.tsx';
import { CpuChart } from './CpuChart.tsx';
import { GpuChart } from './GpuChart.tsx';
import { MemoryChart } from './MemoryChart.tsx';
import { PartitionSelect } from './PartitionSelect.tsx';

function ChartSkeleton() {
  return (
    <div className="flex items-center justify-center p-4" aria-busy="true" aria-label="Loading chart">
      <div className="h-48 w-48 animate-pulse rounded-full bg-gray-200" />
    </div>
  );
}

function StatsDashboard() {
  const [partition, setPartition] = useState<string | null>(null);

  const partitionsQuery = useQuery({
    queryKey: partitionKeys.list,
    queryFn: ({ signal }) => fetchPartitions({ signal }),
    staleTime: 600_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // No placeholder data: a scope change must show the new scope loading,
  // never the previous scope's charts under the new partition label.
  // Same-key background refetches keep existing data naturally.
  const statsQuery = useQuery({
    queryKey: statsKeys.detail(partition),
    queryFn: ({ signal }) => fetchStats(partition, { signal }),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const partitionsUnavailable =
    partitionsQuery.data === undefined && partitionsQuery.isError;
  const partitionsStale =
    partitionsQuery.data !== undefined && partitionsQuery.isError;

  return (
    <div id="resource-utilization" className="mb-12 scroll-mt-24">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">Resource Utilization</h2>
        <div className="flex flex-col items-end gap-1">
          <PartitionSelect
            value={partition}
            partitions={partitionsQuery.data?.partitions ?? []}
            disabled={partitionsUnavailable}
            onChange={setPartition}
          />
          {partitionsUnavailable ? (
            <p className="text-sm text-amber-700" role="status">
              Partition list unavailable.{' '}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => partitionsQuery.refetch()}
              >
                Retry
              </button>
            </p>
          ) : partitionsStale ? (
            <p className="text-sm text-gray-500" role="status">
              Partition list may be out of date.
            </p>
          ) : null}
        </div>
      </div>

      {partition !== null ? (
        <div className="mb-4">
          <span className="inline-flex items-center rounded-full bg-gray-200 px-3 py-1 text-sm text-gray-700">
            Showing stats for: <span className="ml-1 font-semibold">{partition}</span>
          </span>
        </div>
      ) : null}

      {statsQuery.data === undefined ? (
        statsQuery.isPending ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <ChartSkeleton />
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
        ) : (
          <ErrorPanel
            message={errorMessage(statsQuery.error)}
            onRetry={() => statsQuery.refetch()}
          />
        )
      ) : (
        <div>
          <div className="mb-2 flex items-center justify-end gap-3 text-sm text-gray-600">
            {statsQuery.isFetching ? <span aria-live="polite">Refreshing…</span> : null}
            <span>Last updated: {new Date(statsQuery.data.updatedAt).toLocaleTimeString()}</span>
            <button
              type="button"
              className="rounded bg-gray-200 px-3 py-1 hover:bg-gray-300"
              onClick={() => statsQuery.refetch()}
            >
              Refresh
            </button>
          </div>
          {statsQuery.isError ? (
            <div className="mb-2">
              <RefreshWarning
                message="Showing previous stats because the latest refresh failed."
                onRetry={() => statsQuery.refetch()}
              />
            </div>
          ) : null}
          {/* TODO: Respect the existing showSecondaryLayer chart setting before React becomes the default UI. */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="flex flex-col rounded-lg border bg-white shadow">
              <div className="border-b p-4 pb-2">
                <h3 className="text-lg font-medium">CPU Utilization</h3>
              </div>
              <div className="flex flex-1 items-center justify-center p-4">
                <CpuChart cpu={statsQuery.data.cpu} />
              </div>
            </div>
            <div className="flex flex-col rounded-lg border bg-white shadow">
              <div className="border-b p-4 pb-2">
                <h3 className="text-lg font-medium">Memory Utilization</h3>
              </div>
              <div className="flex flex-1 items-center justify-center p-4">
                <MemoryChart memory={statsQuery.data.memory} />
              </div>
            </div>
            <div className="flex flex-col rounded-lg border bg-white shadow">
              <div className="border-b p-4 pb-2">
                <h3 className="text-lg font-medium">GPU Utilization</h3>
              </div>
              <div className="flex flex-1 items-center justify-center p-4">
                <GpuChart gpu={statsQuery.data.gpu} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { StatsDashboard };
