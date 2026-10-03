import { normalizeSlurmNumber } from './schemas/common.js';
import type { RawJob } from './schemas/jobs.js';
import { UpstreamInvalidError } from './errors.js';
import { splitJobState } from './states.js';
import { normalizeEpochSeconds, normalizeTimeLimitMinutes } from './time.js';
import { parseGresDetailEntries, parseTresString } from './tres.js';
import { mergeGpuRequest } from './gres.js';
import type { GpuRequest, Job } from '../../models/job.js';

function cleanString(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed.length > 0 && trimmed !== '(null)' ? trimmed : null;
}

// Array identifiers arrive as Slurm numeric wrappers. A zero array job id is
// Slurm's "not an array" sentinel; unusable present values invalidate data.
function normalizeArrayId(input: unknown, field: string, jobId: string): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'object' && (input as { set?: unknown }).set === false) return null;
  const { value, infinite } = normalizeSlurmNumber(input);
  if (!infinite && value !== null && Number.isInteger(value) && value >= 0) {
    if (value === 0 && field === 'array_job_id') return null;
    return String(value);
  }
  throw new UpstreamInvalidError(`scontrol job "${jobId}" has malformed field: ${field}`);
}

function normalizeCount(input: unknown): number | null {
  const { value } = normalizeSlurmNumber(input);
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function normalizeExitCode(input: RawJob['exit_code']): string | null {
  if (input === null || input === undefined) return null;
  const { value } = normalizeSlurmNumber(input.return_code ?? null);
  return value === null ? null : String(Math.trunc(value));
}

function enrichGpuTypes(tres: GpuRequest, detail: GpuRequest): void {
  const tresTypes = Object.keys(tres.byType);
  const detailTypes = Object.keys(detail.byType).filter((type) => type !== 'unknown');
  if (detailTypes.length === 0) return;
  if (tresTypes.length > 0 && tresTypes.some((type) => type !== 'unknown')) return;
  tres.byType = { ...detail.byType };
}

function normalizeNodeExpression(input: RawJob['nodes']): string | null {
  if (typeof input === 'string') return cleanString(input);
  if (Array.isArray(input)) {
    const parts = input.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
    return parts.length > 0 ? parts.join(',') : null;
  }
  return null;
}

function mentionsCompleteTresRecord(input: unknown): boolean {
  if (typeof input !== 'string') return false;
  return /(^|,)cpu=|(^|,)mem=|(^|,)node=|(^|,)billing=/i.test(input.trim());
}

function normalizeJob(raw: RawJob): Job {
  const jobId = String(raw.job_id).trim();
  const arrayJobId = normalizeArrayId(raw.array_job_id ?? null, 'array_job_id', jobId);
  const arrayTaskId = normalizeArrayId(raw.array_task_id ?? null, 'array_task_id', jobId);
  const id = arrayJobId !== null && arrayTaskId !== null && !jobId.includes('_')
    ? `${arrayJobId}_${arrayTaskId}`
    : jobId;

  const { base, flags } = splitJobState(raw.job_state);
  const requested = parseTresString(raw.tres_req_str ?? null);
  const allocated = parseTresString(raw.tres_alloc_str ?? null);
  const hasGresDetail = Array.isArray(raw.gres_detail) && raw.gres_detail.length > 0;
  if (Array.isArray(raw.gres_detail)) {
    const detail = parseGresDetailEntries(raw.gres_detail);
    if (allocated.gpus.total === 0) mergeGpuRequest(allocated.gpus, detail);
    else enrichGpuTypes(allocated.gpus, detail);
  }
  const nodeCountValue = normalizeSlurmNumber(raw.node_count ?? null).value;

  return {
    id,
    jobId,
    arrayJobId,
    arrayTaskId,
    partition: cleanString(raw.partition),
    name: cleanString(raw.name),
    user: cleanString(raw.user_name),
    account: cleanString(raw.account),
    qos: cleanString(raw.qos),
    state: base,
    stateFlags: flags,
    stateReason: normalizeStateReason(raw.state_reason),
    timeLimit: normalizeTimeLimitMinutes(raw.time_limit ?? null),
    submitTime: normalizeEpochSeconds(raw.submit_time ?? null),
    eligibleTime: normalizeEpochSeconds(raw.eligible_time ?? null),
    startTime: normalizeEpochSeconds(raw.start_time ?? null),
    endTime: normalizeEpochSeconds(raw.end_time ?? null),
    priority: normalizeCount(raw.priority ?? null),
    taskCount: normalizeCount(raw.tasks ?? null),
    cpusPerTask: normalizeCount(raw.cpus_per_task ?? null),
    constraints: cleanString(raw.features ?? null),
    reservation: normalizeReservation(raw.resv_name ?? null),
    nodeCount: nodeCountValue === null ? null : Math.max(0, Math.floor(nodeCountValue)),
    nodeExpression: normalizeNodeExpression(raw.nodes ?? null),
    requested: {
      cpus: requested.cpus,
      memoryMiB: requested.memoryMiB,
      nodes: requested.nodes,
      gpus: requested.gpus,
    },
    allocated: {
      cpus: allocated.cpus,
      memoryMiB: allocated.memoryMiB,
      nodes: allocated.nodes,
      gpus: allocated.gpus,
      gpuPresent: hasGresDetail || mentionsCompleteTresRecord(raw.tres_alloc_str ?? null),
    },
    workdir: cleanString(raw.current_working_directory),
    command: cleanString(raw.command),
    stdoutPath: cleanString(raw.standard_output),
    stderrPath: cleanString(raw.standard_error ?? null),
    dependency: cleanString(raw.dependency),
    exitCode: normalizeExitCode(raw.exit_code ?? null),
    derivedExitCode: normalizeExitCode(raw.derived_exit_code ?? null),
    wckey: cleanString(raw.wckey ?? null),
    batchHost: cleanString(raw.batch_host ?? null),
    flags: Array.isArray(raw.flags)
      ? raw.flags.filter((flag) => flag.trim().length > 0)
      : typeof raw.flags === 'string' && raw.flags.trim().length > 0
        ? [raw.flags.trim()]
        : [],
  };
}

function normalizeReservation(input: unknown): string | null {
  const cleaned = cleanString(input);
  return cleaned === null || cleaned.toUpperCase() === 'NONE' ? null : cleaned;
}

function normalizeStateReason(input: unknown): string | null {
  const cleaned = cleanString(input);
  return cleaned === null || cleaned.toUpperCase() === 'NONE' ? null : cleaned;
}

export { normalizeJob, normalizeStateReason };
