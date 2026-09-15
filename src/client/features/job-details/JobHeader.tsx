import { Link, useLocation, useRouter } from '@tanstack/react-router';
import type { MouseEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { JobDto } from '../../../shared/api/v1/jobs.ts';
import { StateBadge } from '../../components/StateBadge.tsx';
import { hasJobsQueueOrigin } from '../../queue-origin.ts';
import { EMPTY_DASHBOARD_SEARCH } from '../jobs/jobs-search.ts';
import { formatAdaptiveDuration, formatDateTime, formatMemoryMiB } from '../jobs/formatting.ts';
import { CopyButton } from './CopyButton.tsx';
import { remainingSeconds, runtimeSeconds, waitingSeconds } from './lifecycle.ts';

function BackToJobs() {
  const router = useRouter();
  const location = useLocation();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (hasJobsQueueOrigin(location.state)) {
      event.preventDefault();
      router.history.back();
    }
  }

  return (
    <Link
      to="/"
      search={EMPTY_DASHBOARD_SEARCH}
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to jobs
    </Link>
  );
}

function lifecycleSummary(job: JobDto, snapshotMs: number): { primary: string; secondary: string | null } {
  switch (job.state) {
    case 'PENDING': {
      const waiting = waitingSeconds(job, snapshotMs);
      const primary = waiting !== null ? `Waiting ${formatAdaptiveDuration(waiting)}` : 'Waiting to start';
      const submitted = job.submitTime !== null ? `Submitted ${formatDateTime(job.submitTime)}` : null;
      const eligible = job.eligibleTime !== null ? `Eligible since ${formatDateTime(job.eligibleTime)}` : null;
      const secondary = [submitted, eligible].filter((part): part is string => part !== null).join(' · ');
      return { primary, secondary: secondary === '' ? null : secondary };
    }
    case 'RUNNING':
    case 'SUSPENDED': {
      const completing = job.stateFlags.includes('COMPLETING');
      const runtime = runtimeSeconds({ startTime: job.startTime, endTime: null }, snapshotMs);
      const verb = job.state === 'RUNNING' ? (completing ? 'Completing' : 'Running') : 'Suspended';
      const primary = runtime !== null && job.state === 'RUNNING' ? `${verb} ${formatAdaptiveDuration(runtime)}` : verb;
      const elapsed =
        job.state === 'SUSPENDED' && runtime !== null ? `Elapsed ${formatAdaptiveDuration(runtime)}` : null;
      const started = job.startTime !== null ? `Started ${formatDateTime(job.startTime)}` : null;
      const remaining =
        job.state === 'RUNNING' && !completing
          ? remainingSeconds(job, snapshotMs)
          : null;
      const remainingPart = remaining !== null ? `${formatAdaptiveDuration(remaining)} remaining` : null;
      const secondary = [elapsed, started, remainingPart]
        .filter((part): part is string => part !== null)
        .join(' · ');
      return { primary, secondary: secondary === '' ? null : secondary };
    }
    case 'COMPLETED':
    case 'FAILED':
    case 'TIMEOUT':
    case 'OUT_OF_MEMORY':
    case 'CANCELLED':
    case 'NODE_FAIL':
    case 'PREEMPTED':
    case 'BOOT_FAIL':
    case 'DEADLINE': {
      const headings: Record<string, string> = {
        COMPLETED: 'Completed successfully',
        FAILED: job.exitCode !== null ? `Failed · exit code ${job.exitCode}` : 'Failed',
        TIMEOUT: 'Timed out',
        OUT_OF_MEMORY: 'Out of memory',
        CANCELLED: 'Cancelled',
        NODE_FAIL: 'Node failure',
        PREEMPTED: 'Preempted',
        BOOT_FAIL: 'Boot failure',
        DEADLINE: 'Deadline exceeded',
      };
      const primary = headings[job.state] ?? job.state;
      const runtime = runtimeSeconds(job, snapshotMs);
      if (runtime === null) {
        const submitted = job.submitTime !== null ? `Submitted ${formatDateTime(job.submitTime)}` : null;
        const ended = job.endTime !== null ? `Ended ${formatDateTime(job.endTime)}` : null;
        const secondary = [submitted, ended].filter((part): part is string => part !== null).join(' · ');
        return { primary, secondary: secondary === '' ? null : secondary };
      }
      const ran = job.state === 'TIMEOUT' ? `Ran ${formatAdaptiveDuration(runtime)} · Reached its time limit` : `Ran ${formatAdaptiveDuration(runtime)}`;
      const finished =
        job.endTime !== null
          ? `Finished ${formatAdaptiveDuration(Math.max(0, (snapshotMs - Date.parse(job.endTime)) / 1000))} ago`
          : null;
      const secondary = [ran, finished].filter((part): part is string => part !== null).join(' · ');
      return { primary, secondary };
    }
    case 'UNKNOWN': {
      // Uncertainty, not termination: neutral presentation, no runtime or
      // finished arithmetic, no exit results.
      const submitted = job.submitTime !== null ? `Submitted ${formatDateTime(job.submitTime)}` : null;
      return { primary: 'Unknown state', secondary: submitted };
    }
  }
}

function formatGpuSummary(total: number, byType: Record<string, number>): string {
  const known = Object.entries(byType).filter(([type, count]) => type !== 'unknown' && count > 0);
  if (known.length === 0) {
    return `${total} GPU${total === 1 ? '' : 's'}`;
  }
  return `${total} GPU${total === 1 ? '' : 's'} (${known.map(([type, count]) => `${type} × ${count}`).join(', ')})`;
}

// One-line allocation/request recap for the overview. Resources owns the
// full comparison; this strip only orients. Missing is omitted, never zero.
function allocationSummary(job: JobDto): string | null {
  const pending = job.state === 'PENDING';
  const source = pending ? job.requested : job.allocated;
  const nodes = pending ? (job.requested.nodes ?? job.nodeCount) : (job.allocated.nodes ?? job.nodeCount);
  const parts: string[] = [];
  if (nodes !== null) {
    parts.push(`${nodes} node${nodes === 1 ? '' : 's'}`);
  }
  if (source.cpus !== null) {
    parts.push(`${source.cpus} CPU${source.cpus === 1 ? '' : 's'}`);
  }
  if (source.memoryMiB !== null) {
    parts.push(formatMemoryMiB(source.memoryMiB));
  }
  const gpuTotal = source.gpus.total;
  const hasGpuSignal =
    gpuTotal > 0 || Object.keys(source.gpus.byType).length > 0 || source.cpus !== null || source.memoryMiB !== null || nodes !== null;
  if (hasGpuSignal) {
    parts.push(formatGpuSummary(gpuTotal, source.gpus.byType));
  }
  if (parts.length === 0) {
    return null;
  }
  return `${pending ? 'Requests' : 'Allocated'} ${parts.join(' · ')}`;
}

function JobHeader({ job, snapshotMs, snapshotTaken }: { job: JobDto; snapshotMs: number; snapshotTaken: string }) {
  const title = job.name ?? `Job ${job.id}`;
  const context = [job.user, job.account, job.partition, job.qos].filter(
    (value): value is string => value !== null
  );
  const summary = lifecycleSummary(job, snapshotMs);
  const allocation = allocationSummary(job);
  const isArrayTask = job.arrayJobId !== null && job.arrayTaskId !== null;

  return (
    <div>
      <BackToJobs />
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
        <StateBadge state={job.state} />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-gray-600">
        <span>
          Job <span className="font-mono text-gray-900">{job.id}</span>
        </span>
        <CopyButton value={job.id} label="Copy job ID" />
        {isArrayTask ? (
          <span className="text-gray-500">
            Array <span className="font-mono text-gray-900">{job.arrayJobId}</span>
            {' · '}
            Task <span className="font-mono text-gray-900">{job.arrayTaskId}</span>
          </span>
        ) : null}
      </p>
      {context.length > 0 ? (
        <p className="mt-1 text-sm text-gray-600">{context.join(' · ')}</p>
      ) : null}
      <p className="mt-3 text-sm font-medium text-gray-900">{summary.primary}</p>
      {summary.secondary !== null ? (
        <p className="mt-0.5 text-sm text-gray-600">{summary.secondary}</p>
      ) : null}
      {allocation !== null ? (
        <p className="mt-2 text-sm text-gray-700">{allocation}</p>
      ) : null}
      <p className="mt-2 text-xs text-gray-500">Snapshot taken {snapshotTaken}</p>
    </div>
  );
}

export { BackToJobs, JobHeader, allocationSummary, lifecycleSummary };
