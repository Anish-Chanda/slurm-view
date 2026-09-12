import type { JobDto, RequestedResourcesDto } from '../../../shared/api/v1/jobs.ts';
import { MISSING, formatMemoryMiB } from '../jobs/formatting.ts';
import { CopyButton } from './CopyButton.tsx';

function GpuCount({ total, byType }: { total: number; byType: Record<string, number> }) {
  const known = Object.entries(byType).filter(([type, count]) => type !== 'unknown' && count > 0);
  if (known.length === 0) {
    return <>{String(total)}</>;
  }
  return (
    <>
      {String(total)}{' '}
      <span className="text-gray-500">
        ({known.map(([type, count]) => `${type} × ${count}`).join(', ')})
      </span>
    </>
  );
}

// A zero GPU total means "none" only when sibling resource data came
// through; with no resource data at all the row is omitted instead.
function showGpuRow(resources: RequestedResourcesDto): boolean {
  return (
    resources.gpus.total > 0 ||
    Object.keys(resources.gpus.byType).length > 0 ||
    resources.cpus !== null ||
    resources.memoryMiB !== null ||
    resources.nodes !== null
  );
}

function ResourceCell({ value, mono }: { value: string | null; mono?: boolean }) {
  if (value === null) {
    return <span className="text-gray-400">{MISSING}</span>;
  }
  return <span className={mono === true ? 'font-mono' : undefined}>{value}</span>;
}

// Requested vs allocated, side by side. Missing is an em dash, never zero;
// invented allocations are worse than empty cells. Node identity lives in
// the node-list row below the table; time limit belongs to Timing.
function Resources({ job }: { job: JobDto }) {
  const pending = job.state === 'PENDING';
  const requestedNodes = job.requested.nodes ?? (pending ? job.nodeCount : null);
  const allocatedNodes = pending ? null : (job.allocated.nodes ?? job.nodeCount);
  const gpuRow = showGpuRow(job.requested) || showGpuRow(job.allocated);
  const rows: Array<{
    key: string;
    label: string;
    requested: string | null;
    allocated: string | null;
  }> = [
    {
      key: 'nodes',
      label: 'Nodes',
      requested: requestedNodes !== null ? String(requestedNodes) : null,
      allocated: allocatedNodes !== null ? String(allocatedNodes) : null,
    },
    {
      key: 'cpus',
      label: 'CPUs',
      requested: job.requested.cpus !== null ? String(job.requested.cpus) : null,
      allocated: pending ? null : job.allocated.cpus !== null ? String(job.allocated.cpus) : null,
    },
    {
      key: 'memory',
      label: 'Memory',
      requested: job.requested.memoryMiB !== null ? formatMemoryMiB(job.requested.memoryMiB) : null,
      allocated:
        pending || job.allocated.memoryMiB === null ? null : formatMemoryMiB(job.allocated.memoryMiB),
    },
  ];

  return (
    <section id="resources" aria-label="Resources">
      <h2 className="text-base font-semibold tracking-tight text-gray-900">Resources</h2>
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left">
            <th scope="col" className="w-24 py-1.5 pr-3 font-normal text-gray-500">
              Resource
            </th>
            <th scope="col" className="py-1.5 pr-3 font-normal text-gray-500">
              Requested
            </th>
            {pending ? null : (
              <th scope="col" className="py-1.5 font-normal text-gray-500">
                Allocated
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-gray-100">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-gray-500">
                {row.label}
              </th>
              <td className="py-1.5 pr-3 tabular-nums text-gray-900">
                <ResourceCell value={row.requested} />
              </td>
              {pending ? null : (
                <td className="py-1.5 tabular-nums text-gray-900">
                  <ResourceCell value={row.allocated} />
                </td>
              )}
            </tr>
          ))}
          {gpuRow ? (
            <tr className="border-b border-gray-100">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-gray-500">
                GPUs
              </th>
              <td className="py-1.5 pr-3 text-gray-900">
                {showGpuRow(job.requested) ? (
                  <GpuCount total={job.requested.gpus.total} byType={job.requested.gpus.byType} />
                ) : (
                  <ResourceCell value={null} />
                )}
              </td>
              {pending ? null : (
                <td className="py-1.5 text-gray-900">
                  {showGpuRow(job.allocated) ? (
                    <GpuCount total={job.allocated.gpus.total} byType={job.allocated.gpus.byType} />
                  ) : (
                    <ResourceCell value={null} />
                  )}
                </td>
              )}
            </tr>
          ) : null}
        </tbody>
      </table>
      {job.taskCount !== null || job.cpusPerTask !== null ? (
        <p className="mt-2 text-sm text-gray-600">
          {[
            job.taskCount !== null ? `${job.taskCount} task${job.taskCount === 1 ? '' : 's'}` : null,
            job.cpusPerTask !== null
              ? `${job.cpusPerTask} CPU${job.cpusPerTask === 1 ? '' : 's'} per task`
              : null,
          ]
            .filter((part): part is string => part !== null)
            .join(' · ')}
        </p>
      ) : null}
      {!pending && job.nodeExpression !== null ? (
        <div className="mt-2 flex items-start justify-between gap-3 text-sm">
          <p className="min-w-0 break-all font-mono text-gray-900">{job.nodeExpression}</p>
          <CopyButton value={job.nodeExpression} label="Copy node list" />
        </div>
      ) : null}
    </section>
  );
}

export { GpuCount, Resources, showGpuRow };
