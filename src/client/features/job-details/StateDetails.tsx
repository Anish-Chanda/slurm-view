import type { JobDto, RequestedResourcesDto } from '../../../shared/api/v1/jobs.ts';
import { formatMemoryMiB } from '../jobs/formatting.ts';
import { DetailList, DetailRow, DetailSection } from './DetailList.tsx';

function PendingReasonSummary({ job }: { job: Pick<JobDto, 'stateReason'> }) {
  return (
    <DetailSection id="why-waiting" title="Why it's waiting">
      <div className="rounded-md border border-gray-200 bg-white px-4 py-3">
        <p className="text-sm text-gray-900">
          {job.stateReason !== null
            ? `Slurm currently reports this job is waiting: ${job.stateReason}.`
            : 'Slurm has not provided a reason for this wait yet.'}
        </p>
      </div>
      {/* TODO: Add richer pending analysis once the v1 analyzer is wired in. */}
    </DetailSection>
  );
}

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

function LiveAllocation({ job }: { job: JobDto }) {
  return (
    <DetailSection id="allocation" title="Current allocation">
      <DetailList>
        {(job.allocated.nodes ?? job.nodeCount) !== null ? (
          <DetailRow label="Nodes">{job.allocated.nodes ?? job.nodeCount}</DetailRow>
        ) : null}
        {job.allocated.cpus !== null ? <DetailRow label="CPUs">{job.allocated.cpus}</DetailRow> : null}
        {job.allocated.memoryMiB !== null ? (
          <DetailRow label="Memory">{formatMemoryMiB(job.allocated.memoryMiB)}</DetailRow>
        ) : null}
        {showGpuRow(job.allocated) ? (
          <DetailRow label="GPUs">
            <GpuCount total={job.allocated.gpus.total} byType={job.allocated.gpus.byType} />
          </DetailRow>
        ) : null}
        {job.nodeExpression !== null ? (
          <DetailRow label="Node list" mono>
            {job.nodeExpression}
          </DetailRow>
        ) : null}
      </DetailList>
    </DetailSection>
  );
}

function JobStateDetails({ job }: { job: JobDto }) {
  switch (job.state) {
    case 'PENDING':
      return <PendingReasonSummary job={job} />;
    case 'RUNNING':
    case 'SUSPENDED':
      return (
        <>
          <LiveAllocation job={job} />
          {job.stateFlags.includes('COMPLETING') ? (
            <p className="mt-2 text-sm text-gray-600" role="note">
              Completing — the job is finishing and will leave the queue shortly.
            </p>
          ) : null}
        </>
      );
    default:
      return null;
  }
}

export { GpuCount, JobStateDetails, showGpuRow };
