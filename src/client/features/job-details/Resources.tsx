import type { JobDto } from '../../../shared/api/v1/jobs.ts';
import { formatMemoryMiB, formatTimeLimit } from '../jobs/formatting.ts';
import { DetailList, DetailRow, DetailSection } from './DetailList.tsx';
import { GpuCount, showGpuRow } from './StateDetails.tsx';

function RequestedColumn({ job }: { job: JobDto }) {
  const nodes = job.requested.nodes ?? (job.state === 'PENDING' ? job.nodeCount : null);
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700">Requested</h3>
      <div className="mt-1">
        <DetailList>
          {nodes !== null ? <DetailRow label="Nodes">{nodes}</DetailRow> : null}
          {job.taskCount !== null ? <DetailRow label="Tasks">{job.taskCount}</DetailRow> : null}
          {job.requested.cpus !== null ? (
            <DetailRow label="CPUs">{job.requested.cpus}</DetailRow>
          ) : null}
          {job.cpusPerTask !== null ? (
            <DetailRow label="CPUs per task">{job.cpusPerTask}</DetailRow>
          ) : null}
          {job.requested.memoryMiB !== null ? (
            <DetailRow label="Memory">{formatMemoryMiB(job.requested.memoryMiB)}</DetailRow>
          ) : null}
          {showGpuRow(job.requested) ? (
            <DetailRow label="GPUs">
              <GpuCount total={job.requested.gpus.total} byType={job.requested.gpus.byType} />
            </DetailRow>
          ) : null}
          {job.timeLimit !== null ? (
            <DetailRow label="Time limit">{formatTimeLimit(job.timeLimit)}</DetailRow>
          ) : null}
        </DetailList>
      </div>
    </div>
  );
}

function AllocatedColumn({ job }: { job: JobDto }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700">Allocated</h3>
      <div className="mt-1">
        <DetailList>
          {(job.allocated.nodes ?? job.nodeCount) !== null ? (
            <DetailRow label="Nodes">{job.allocated.nodes ?? job.nodeCount}</DetailRow>
          ) : null}
          {job.allocated.cpus !== null ? (
            <DetailRow label="CPUs">{job.allocated.cpus}</DetailRow>
          ) : null}
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
      </div>
    </div>
  );
}

function Resources({ job }: { job: JobDto }) {
  if (job.state === 'PENDING') {
    return (
      <DetailSection id="resources" title="Resources">
        <RequestedColumn job={job} />
      </DetailSection>
    );
  }
  return (
    <DetailSection id="resources" title="Resources">
      <div className="grid gap-6 md:grid-cols-2">
        <RequestedColumn job={job} />
        <AllocatedColumn job={job} />
      </div>
    </DetailSection>
  );
}

export { Resources };
