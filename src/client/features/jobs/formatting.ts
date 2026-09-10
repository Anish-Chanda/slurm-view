import type { JobDto, TimeLimitDto } from '../../../shared/api/v1/jobs.ts';

const MISSING = '—';

function formatDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  return parts.length > 0 ? parts.join(' ') : '0s';
}

function formatTimeLimit(limit: TimeLimitDto): string {
  if (limit === null) return MISSING;
  if (limit.kind === 'infinite') return 'UNLIMITED';
  return formatDuration(limit.seconds);
}

function formatTimeLeft(job: Pick<JobDto, 'state' | 'startTime' | 'endTime' | 'timeLimit'>, nowMs: number = Date.now()): string {
  if (job.state === 'PENDING') return 'Not started';
  if (job.state !== 'RUNNING') return MISSING;
  let endMs: number | null = null;
  if (job.endTime !== null) {
    endMs = Date.parse(job.endTime);
  } else if (job.startTime !== null && job.timeLimit !== null && job.timeLimit.kind === 'finite') {
    endMs = Date.parse(job.startTime) + job.timeLimit.seconds * 1000;
  }
  if (endMs === null || Number.isNaN(endMs)) return MISSING;
  const remainingSeconds = Math.ceil((endMs - nowMs) / 1000);
  if (remainingSeconds <= 0) return 'Exceeded';
  return formatDuration(remainingSeconds);
}

function formatDateTime(iso: string | null): string {
  if (iso === null) return MISSING;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return MISSING;
  return new Date(ms).toLocaleString();
}

function formatMemoryMiB(mib: number | null): string {
  if (mib === null) return MISSING;
  if (mib >= 1024) {
    const gib = mib / 1024;
    return `${gib >= 100 ? Math.round(gib) : Math.round(gib * 10) / 10} GiB`;
  }
  return `${mib} MiB`;
}

function formatCount(value: number | null): string {
  return value === null ? MISSING : String(value);
}

export { MISSING, formatCount, formatDateTime, formatDuration, formatMemoryMiB, formatTimeLeft, formatTimeLimit };
