import type { JobDto } from '../../../shared/api/v1/jobs.ts';
import { formatDateTime, formatDuration, formatTimeLimit } from '../jobs/formatting.ts';
import { queueWaitSeconds, remainingSeconds, runtimeSeconds } from './lifecycle.ts';
import { DetailList, DetailRow, DetailSection } from './DetailList.tsx';

function Timing({ job, nowMs }: { job: JobDto; nowMs: number }) {
  const isLive = job.state === 'RUNNING' || job.state === 'SUSPENDED';
  const isPending = job.state === 'PENDING';
  const isTerminal = !isLive && !isPending;
  // Pending start/end times are backfill estimates, never actuals, so they
  // must not feed queue-wait or runtime durations.
  const queueWait = isPending ? null : queueWaitSeconds(job);
  const runtime = isPending
    ? null
    : runtimeSeconds({ startTime: job.startTime, endTime: isLive ? null : job.endTime }, nowMs);
  const remaining =
    job.state === 'RUNNING' && !job.stateFlags.includes('COMPLETING')
      ? remainingSeconds(job, nowMs)
      : null;

  return (
    <DetailSection id="timing" title="Timing">
      <DetailList>
        {job.submitTime !== null ? (
          <DetailRow label="Submitted">{formatDateTime(job.submitTime)}</DetailRow>
        ) : null}
        {job.eligibleTime !== null ? (
          <DetailRow label="Eligible">{formatDateTime(job.eligibleTime)}</DetailRow>
        ) : null}
        {job.startTime !== null && !isPending ? (
          <DetailRow label="Started">{formatDateTime(job.startTime)}</DetailRow>
        ) : null}
        {job.startTime !== null && isPending ? (
          <DetailRow label="Expected start">{formatDateTime(job.startTime)}</DetailRow>
        ) : null}
        {job.endTime !== null && isTerminal ? (
          <DetailRow label="Finished">{formatDateTime(job.endTime)}</DetailRow>
        ) : null}
        {job.endTime !== null && !isTerminal ? (
          <DetailRow label="Expected end">{formatDateTime(job.endTime)}</DetailRow>
        ) : null}
        {queueWait !== null ? (
          <DetailRow label={queueWait.fromEligible ? 'Queue wait' : 'Submit to start'}>
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
    </DetailSection>
  );
}

function Scheduling({ job }: { job: JobDto }) {
  return (
    <DetailSection id="scheduling" title="Scheduling">
      <DetailList>
        {job.partition !== null ? <DetailRow label="Partition">{job.partition}</DetailRow> : null}
        {job.qos !== null ? <DetailRow label="QoS">{job.qos}</DetailRow> : null}
        {job.account !== null ? <DetailRow label="Account">{job.account}</DetailRow> : null}
        {job.priority !== null ? <DetailRow label="Priority">{String(job.priority)}</DetailRow> : null}
        {job.stateReason !== null ? <DetailRow label="State reason">{job.stateReason}</DetailRow> : null}
        {job.dependency !== null ? (
          <DetailRow label="Dependency" mono>
            {job.dependency}
          </DetailRow>
        ) : null}
        {job.constraints !== null ? <DetailRow label="Constraints">{job.constraints}</DetailRow> : null}
        {job.reservation !== null ? <DetailRow label="Reservation">{job.reservation}</DetailRow> : null}
      </DetailList>
    </DetailSection>
  );
}

function TimingScheduling({ job, nowMs }: { job: JobDto; nowMs: number }) {
  const hasScheduling =
    job.partition !== null ||
    job.qos !== null ||
    job.account !== null ||
    job.priority !== null ||
    job.stateReason !== null ||
    job.dependency !== null ||
    job.constraints !== null ||
    job.reservation !== null;
  return (
    <div className="grid gap-x-8 md:grid-cols-2">
      <Timing job={job} nowMs={nowMs} />
      {hasScheduling ? <Scheduling job={job} /> : null}
    </div>
  );
}

export { TimingScheduling };
