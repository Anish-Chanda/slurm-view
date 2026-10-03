import type { JobDto, JobState } from '../../../shared/api/v1/jobs.ts';

function parseTimeMs(iso: string | null): number | null {
  if (iso === null) {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// Queue wait starts at eligibility when available; callers label the fallback
// submit-to-start interval explicitly.
function queueWaitSeconds(job: Pick<JobDto, 'submitTime' | 'eligibleTime' | 'startTime'>): {
  seconds: number;
  fromEligible: boolean;
} | null {
  const start = parseTimeMs(job.startTime);
  if (start === null) {
    return null;
  }
  const eligible = parseTimeMs(job.eligibleTime);
  if (eligible !== null && start >= eligible) {
    return { seconds: (start - eligible) / 1000, fromEligible: true };
  }
  const submit = parseTimeMs(job.submitTime);
  if (submit !== null && start >= submit) {
    return { seconds: (start - submit) / 1000, fromEligible: false };
  }
  return null;
}

// Pending wait duration starts at eligibility, falling back to submit time.
function waitingSeconds(
  job: Pick<JobDto, 'submitTime' | 'eligibleTime'>,
  nowMs: number
): number | null {
  const base = parseTimeMs(job.eligibleTime) ?? parseTimeMs(job.submitTime);
  if (base === null || nowMs < base) {
    return null;
  }
  return (nowMs - base) / 1000;
}

function runtimeSeconds(
  job: Pick<JobDto, 'startTime' | 'endTime'>,
  nowMs: number
): number | null {
  const start = parseTimeMs(job.startTime);
  if (start === null) {
    return null;
  }
  const end = parseTimeMs(job.endTime) ?? nowMs;
  if (end < start) {
    return null;
  }
  return (end - start) / 1000;
}

function remainingSeconds(
  job: Pick<JobDto, 'endTime'>,
  nowMs: number
): number | null {
  const end = parseTimeMs(job.endTime);
  if (end === null) {
    return null;
  }
  return Math.max(0, (end - nowMs) / 1000);
}

// Zero-valued exit fields can appear on active jobs. Require a terminal state
// before treating exit or usage data as meaningful; UNKNOWN is not terminal.
const TERMINAL_STATES: ReadonlySet<JobState> = new Set([
  'BOOT_FAIL',
  'CANCELLED',
  'COMPLETED',
  'DEADLINE',
  'FAILED',
  'NODE_FAIL',
  'OUT_OF_MEMORY',
  'PREEMPTED',
  'TIMEOUT',
]);

function isTerminalState(state: JobState): boolean {
  return TERMINAL_STATES.has(state);
}

export { isTerminalState, parseTimeMs, queueWaitSeconds, remainingSeconds, runtimeSeconds, waitingSeconds };
