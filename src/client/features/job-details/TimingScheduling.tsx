import type { JobDto } from '../../../shared/api/v1/jobs.ts';
import { formatDateTime, formatDuration, formatTimeLimit } from '../jobs/formatting.ts';
import { isTerminalState, queueWaitSeconds, remainingSeconds, runtimeSeconds } from './lifecycle.ts';
import { DetailList, DetailRow } from './DetailList.tsx';

function Timing({ job, snapshotMs }: { job: JobDto; snapshotMs: number }) {
  const isLive = job.state === 'RUNNING' || job.state === 'SUSPENDED';
  const isPending = job.state === 'PENDING';
  const isUnknown = job.state === 'UNKNOWN';
  const isTerminal = isTerminalState(job.state);
  // Pending start/end times are backfill estimates, never actuals, so they
  // must not feed queue-wait or runtime durations. UNKNOWN timestamps get
  // no lifecycle reading at all: no Started, no queue-wait arithmetic, no
  // Finished label, no Runtime — only neutral timestamp rows below.
  const queueWait = isPending || isUnknown ? null : queueWaitSeconds(job);
  const runtime = isPending || isUnknown
    ? null
    : runtimeSeconds({ startTime: job.startTime, endTime: isLive ? null : job.endTime }, snapshotMs);
  const remaining =
    job.state === 'RUNNING' && !job.stateFlags.includes('COMPLETING')
      ? remainingSeconds(job, snapshotMs)
      : null;

  return (
    <section id="timing" aria-label="Timing">
      <h2 className="text-base font-semibold tracking-tight text-gray-900">Timing</h2>
      <div className="mt-3">
        <DetailList>
          {job.submitTime !== null ? (
            <DetailRow label="Submitted">{formatDateTime(job.submitTime)}</DetailRow>
          ) : null}
          {job.eligibleTime !== null ? (
            <DetailRow label="Eligible">{formatDateTime(job.eligibleTime)}</DetailRow>
          ) : null}
          {job.startTime !== null && !isPending && !isUnknown ? (
            <DetailRow label="Started">{formatDateTime(job.startTime)}</DetailRow>
          ) : null}
          {job.startTime !== null && isUnknown ? (
            <DetailRow label="Start time">{formatDateTime(job.startTime)}</DetailRow>
          ) : null}
          {job.startTime !== null && isPending ? (
            <DetailRow label="Expected start">{formatDateTime(job.startTime)}</DetailRow>
          ) : null}
          {job.endTime !== null && isTerminal ? (
            <DetailRow label="Finished">{formatDateTime(job.endTime)}</DetailRow>
          ) : null}
          {job.endTime !== null && isUnknown ? (
            <DetailRow label="End time">{formatDateTime(job.endTime)}</DetailRow>
          ) : null}
          {job.endTime !== null && !isTerminal && !isUnknown ? (
            <DetailRow label="Expected end">{formatDateTime(job.endTime)}</DetailRow>
          ) : null}
          {queueWait !== null ? (
            <DetailRow label={queueWait.fromEligible ? 'Eligible to start' : 'Submit to start'}>
              {formatDuration(queueWait.seconds)}
            </DetailRow>
          ) : null}
          {runtime !== null ? (
            <DetailRow label={job.state === 'SUSPENDED' ? 'Elapsed' : isTerminal ? 'Runtime' : 'Running'}>
              {formatDuration(runtime)}
            </DetailRow>
          ) : null}
          {job.timeLimit !== null ? (
            <DetailRow label="Time limit">{formatTimeLimit(job.timeLimit)}</DetailRow>
          ) : null}
          {remaining !== null ? <DetailRow label="Remaining">{formatDuration(remaining)}</DetailRow> : null}
        </DetailList>
      </div>
    </section>
  );
}

function Scheduling({ job }: { job: JobDto }) {
  // The pending lead owns the state reason for waiting jobs; other states
  // keep the raw reason here as scheduler context.
  const showStateReason = job.state !== 'PENDING' && job.stateReason !== null;
  const hasScheduling =
    job.partition !== null ||
    job.qos !== null ||
    job.account !== null ||
    job.priority !== null ||
    showStateReason ||
    job.dependency !== null ||
    job.constraints !== null ||
    job.reservation !== null ||
    job.wckey !== null;
  if (!hasScheduling) {
    return null;
  }
  return (
    <section id="scheduling" aria-label="Scheduling">
      <h2 className="text-base font-semibold tracking-tight text-gray-900">Scheduling</h2>
      <div className="mt-3">
        <DetailList>
          {job.partition !== null ? <DetailRow label="Partition">{job.partition}</DetailRow> : null}
          {job.qos !== null ? <DetailRow label="QoS">{job.qos}</DetailRow> : null}
          {job.account !== null ? <DetailRow label="Account">{job.account}</DetailRow> : null}
          {job.priority !== null ? <DetailRow label="Priority">{String(job.priority)}</DetailRow> : null}
          {showStateReason ? <DetailRow label="State reason">{job.stateReason}</DetailRow> : null}
          {job.dependency !== null ? (
            <DetailRow label="Dependency" mono>
              {job.dependency}
            </DetailRow>
          ) : null}
          {job.constraints !== null ? <DetailRow label="Constraints">{job.constraints}</DetailRow> : null}
          {job.reservation !== null ? <DetailRow label="Reservation">{job.reservation}</DetailRow> : null}
          {job.wckey !== null ? <DetailRow label="WCKey">{job.wckey}</DetailRow> : null}
        </DetailList>
      </div>
    </section>
  );
}

function TimingScheduling({ job, snapshotMs }: { job: JobDto; snapshotMs: number }) {
  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-1">
      <Timing job={job} snapshotMs={snapshotMs} />
      <Scheduling job={job} />
    </div>
  );
}

export { TimingScheduling };
