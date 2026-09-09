import { normalizeSlurmNumber, describeNotice } from './schemas/common.js';
import type { RawJob } from './schemas/jobs.js';
import { jobResponseSchemaFor } from './schemas/jobs.js';
import type { SupportedDataParser } from './parser-version.js';
import { runCommand } from './command-runner.js';
import { SlurmUpstreamError, UpstreamInvalidError, summarizeZodIssues } from './errors.js';
import { splitJobState } from './states.js';
import { normalizeEpochSeconds, normalizeTimeLimitMinutes } from './time.js';
import { parseGresDetailEntries, parseTresString } from './tres.js';
import { mergeGpuRequest } from './gres.js';
import type { SlurmContext, SlurmRunFn } from './context.js';
import type { GpuRequest } from '../../models/job.js';
import type { Job } from '../../models/job.js';

const JOBS_COMMAND_TIMEOUT_MS = 20_000;
const JOBS_COMMAND_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

function cleanString(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 && trimmed !== '(null)' ? trimmed : null;
}

function cleanIdComponent(input: unknown): string | null {
  if (typeof input === 'number' && Number.isInteger(input) && input >= 0) {
    return String(input);
  }
  if (typeof input === 'string' && /^\d+$/.test(input.trim())) {
    return input.trim();
  }
  return null;
}

function scalarizeExitCode(input: RawJob['exit_code']): string | null {
  if (input === null || input === undefined) {
    return null;
  }
  if (typeof input === 'string') {
    return input.trim().length > 0 ? input.trim() : null;
  }
  if (typeof input === 'number') {
    return Number.isFinite(input) ? String(input) : null;
  }
  const status = input.status;
  if (typeof status === 'string') {
    return status.trim().length > 0 ? status.trim() : null;
  }
  if (typeof status === 'number' && Number.isFinite(status)) {
    return String(status);
  }
  return null;
}

// Adopts gres_detail type info when TRES knows the total but not the
// types. The total never changes, so this cannot double-count.
function enrichGpuTypes(tres: GpuRequest, detail: GpuRequest): void {
  const tresTypes = Object.keys(tres.byType);
  const detailTypes = Object.keys(detail.byType).filter((type) => type !== 'unknown');
  if (detailTypes.length === 0) {
    return;
  }
  if (tresTypes.length > 0 && tresTypes.some((type) => type !== 'unknown')) {
    return;
  }
  tres.byType = { ...detail.byType };
}

function normalizeNodeExpression(input: RawJob['nodes']): string | null {  if (typeof input === 'string') {
    return cleanString(input);
  }
  if (Array.isArray(input)) {
    const parts = input
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);
    return parts.length > 0 ? parts.join(',') : null;
  }
  return null;
}

function normalizeJob(raw: RawJob): Job {
  const jobId = String(raw.job_id).trim();
  const arrayJobId = cleanIdComponent(raw.array_job_id ?? null);
  const arrayTaskId = cleanIdComponent(raw.array_task_id ?? null);
  // Array tasks are addressed as "<arrayJobId>_<arrayTaskId>".
  const id =
    arrayJobId !== null && arrayTaskId !== null && !jobId.includes('_')
      ? `${arrayJobId}_${arrayTaskId}`
      : jobId;

  const { base, flags } = splitJobState(raw.job_state);
  const requested = parseTresString(raw.tres_req_str ?? null);
  const allocated = parseTresString(raw.tres_alloc_str ?? null);
  if (Array.isArray(raw.gres_detail)) {
    const detail = parseGresDetailEntries(raw.gres_detail);
    if (allocated.gpus.total === 0) {
      mergeGpuRequest(allocated.gpus, detail);
    } else {
      enrichGpuTypes(allocated.gpus, detail);
    }
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
    startTime: normalizeEpochSeconds(raw.start_time ?? null),
    endTime: normalizeEpochSeconds(raw.end_time ?? null),
    nodeCount:
      nodeCountValue === null ? null : Math.max(0, Math.floor(nodeCountValue)),
    nodeExpression: normalizeNodeExpression(raw.nodes ?? null),
    requested: {
      cpus: requested.cpus,
      memoryMiB: requested.memoryMiB,
      gpus: requested.gpus,
    },
    allocated: {
      cpus: allocated.cpus,
      memoryMiB: allocated.memoryMiB,
      nodes: allocated.nodes,
      gpus: allocated.gpus,
    },
    workdir: cleanString(raw.current_working_directory),
    command: cleanString(raw.command),
    stdoutPath: cleanString(raw.standard_output),
    dependency: cleanString(raw.dependency),
    exitCode: scalarizeExitCode(raw.exit_code ?? null),
    derivedExitCode: scalarizeExitCode(raw.derived_exit_code ?? null),
    flags: Array.isArray(raw.flags)
      ? raw.flags.filter((flag) => flag.trim().length > 0)
      : typeof raw.flags === 'string' && raw.flags.trim().length > 0
        ? [raw.flags.trim()]
        : [],
  };
}

// Slurm reports "None" when there is no state reason.
function normalizeStateReason(input: unknown): string | null {
  const cleaned = cleanString(input);
  if (cleaned === null || cleaned.toUpperCase() === 'NONE') {
    return null;
  }
  return cleaned;
}

// Throws on invalid JSON, schema mismatch, or a non-empty Slurm errors[].
function parseJobsStdout(parser: SupportedDataParser, stdout: string): Job[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new UpstreamInvalidError(
      `squeue returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const result = jobResponseSchemaFor(parser).safeParse(parsed);
  if (!result.success) {
    throw new UpstreamInvalidError(
      `squeue response failed validation: ${summarizeZodIssues(result.error.issues)}`
    );
  }

  if (result.data.errors && result.data.errors.length > 0) {
    throw new SlurmUpstreamError(result.data.errors.map(describeNotice));
  }
  if (result.data.warnings && result.data.warnings.length > 0) {
    console.warn(
      `[Slurm] squeue warnings: ${result.data.warnings.map(describeNotice).join('; ')}`
    );
  }

  return result.data.jobs.map(normalizeJob);
}

async function fetchJobs(
  context: SlurmContext,
  options: { signal?: AbortSignal } = {}
): Promise<Job[]> {
  const run: SlurmRunFn = context.run ?? runCommand;
  const { stdout } = await run(
    'squeue',
    [`--json=${context.parser}`, '--states=R,PD,CD'],
    {
      timeoutMs: JOBS_COMMAND_TIMEOUT_MS,
      maxBufferBytes: JOBS_COMMAND_MAX_BUFFER_BYTES,
      signal: options.signal,
    }
  );
  return parseJobsStdout(context.parser, stdout);
}

export {
  JOBS_COMMAND_MAX_BUFFER_BYTES,
  JOBS_COMMAND_TIMEOUT_MS,
  fetchJobs,
  normalizeJob,
  normalizeStateReason,
  parseJobsStdout,
};
