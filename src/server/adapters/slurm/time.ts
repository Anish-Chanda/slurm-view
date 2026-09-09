import { normalizeSlurmNumber } from './schemas/common.js';
import type { TimeLimit } from '../../models/job.js';

// Slurm job time limits arrive in minutes.
function normalizeTimeLimitMinutes(input: unknown): TimeLimit {
  const { value, infinite } = normalizeSlurmNumber(input);
  if (infinite) {
    return { kind: 'infinite' };
  }
  if (value === null || value <= 0) {
    return null;
  }
  return { kind: 'finite', seconds: Math.round(value * 60) };
}

// Slurm epoch timestamps arrive in seconds; unset values become null.
function normalizeEpochSeconds(input: unknown): Date | null {
  const { value } = normalizeSlurmNumber(input);
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(Math.round(value * 1000));
}

export { normalizeEpochSeconds, normalizeTimeLimitMinutes };
