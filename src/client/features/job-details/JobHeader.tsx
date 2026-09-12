import { Link, useLocation, useRouter } from '@tanstack/react-router';
import type { MouseEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { JobDto } from '../../../shared/api/v1/jobs.ts';
import { StateBadge } from '../../components/StateBadge.tsx';
import { hasJobsQueueOrigin } from '../../queue-origin.ts';
import { EMPTY_DASHBOARD_SEARCH } from '../jobs/jobs-search.ts';
import { formatDateTime, formatDuration } from '../jobs/formatting.ts';
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

function lifecycleSummary(job: JobDto, nowMs: number): { primary: string; secondary: string | null } {
  switch (job.state) {
    case 'PENDING': {
      const waiting = waitingSeconds(job, nowMs);
      const primary = waiting !== null ? `Waiting ${formatDuration(waiting)}` : 'Waiting to start';
      const submitted = job.submitTime !== null ? `Submitted ${formatDateTime(job.submitTime)}` : null;
      const eligible = job.eligibleTime !== null ? `Eligible since ${formatDateTime(job.eligibleTime)}` : null;
      const secondary = [submitted, eligible].filter((part): part is string => part !== null).join(' · ');
      return { primary, secondary: secondary === '' ? null : secondary };
    }
    case 'RUNNING':
    case 'SUSPENDED': {
      const completing = job.stateFlags.includes('COMPLETING');
      const runtime = runtimeSeconds({ startTime: job.startTime, endTime: null }, nowMs);
      const verb = job.state === 'RUNNING' ? (completing ? 'Completing' : 'Running') : 'Suspended';
      const primary = runtime !== null && job.state === 'RUNNING' ? `${verb} ${formatDuration(runtime)}` : verb;
      const elapsed =
        job.state === 'SUSPENDED' && runtime !== null ? `Elapsed ${formatDuration(runtime)}` : null;
      const started = job.startTime !== null ? `Started ${formatDateTime(job.startTime)}` : null;
      const remaining =
        job.state === 'RUNNING' && !completing
          ? remainingSeconds(job, nowMs)
          : null;
      const remainingPart = remaining !== null ? `${formatDuration(remaining)} remaining` : null;
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
    case 'DEADLINE':
    case 'UNKNOWN': {
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
        UNKNOWN: 'Unknown state',
      };
      const primary = headings[job.state] ?? job.state;
      const runtime = runtimeSeconds(job, nowMs);
      if (runtime === null) {
        const submitted = job.submitTime !== null ? `Submitted ${formatDateTime(job.submitTime)}` : null;
        const ended = job.endTime !== null ? `Ended ${formatDateTime(job.endTime)}` : null;
        const secondary = [submitted, ended].filter((part): part is string => part !== null).join(' · ');
        return { primary, secondary: secondary === '' ? null : secondary };
      }
      const ran = job.state === 'TIMEOUT' ? `Ran ${formatDuration(runtime)} · Reached its time limit` : `Ran ${formatDuration(runtime)}`;
      const finished =
        job.endTime !== null
          ? `Finished ${formatDuration(Math.max(0, (nowMs - Date.parse(job.endTime)) / 1000))} ago`
          : null;
      const secondary = [ran, finished].filter((part): part is string => part !== null).join(' · ');
      return { primary, secondary };
    }
  }
}

function JobHeader({ job, nowMs }: { job: JobDto; nowMs: number }) {
  const title = job.name ?? `Job ${job.id}`;
  const context = [job.user, job.account, job.partition, job.qos].filter(
    (value): value is string => value !== null
  );
  const summary = lifecycleSummary(job, nowMs);

  return (
    <div>
      <BackToJobs />
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
          {job.name !== null ? (
            <p className="mt-1 font-mono text-sm text-gray-600">Job {job.id}</p>
          ) : null}
          {context.length > 0 ? (
            <p className="mt-1 text-sm text-gray-600">{context.join(' · ')}</p>
          ) : null}
        </div>
        <StateBadge state={job.state} />
      </div>
      <p className="mt-3 text-sm font-medium text-gray-900">{summary.primary}</p>
      {summary.secondary !== null ? (
        <p className="mt-0.5 text-sm text-gray-600">{summary.secondary}</p>
      ) : null}
    </div>
  );
}

export { BackToJobs, JobHeader, lifecycleSummary };
