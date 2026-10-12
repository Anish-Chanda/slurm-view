import { JOB_BASE_STATES } from '../../models/job.js';
import type { JobBaseState, AllocatedJobResources } from '../../models/job.js';
import type { QueueJob } from '../../models/queue-job.js';
import type { SlurmContext, SlurmRunFn } from './context.js';
import { runCommand } from './command-runner.js';
import { UpstreamInvalidError } from './errors.js';
import { parseTresString } from './tres.js';

const JOBS_COMMAND_TIMEOUT_MS = 20_000;
const JOBS_COMMAND_MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const FIELD_SEPARATOR = '\x1f';
const RECORD_SEPARATOR = '\x1e';
const RECORD_TERMINATOR = `${RECORD_SEPARATOR}\n`;

const JOB_FIELDS = [
  { name: 'JobID', key: 'jobId' },
  { name: 'ArrayJobID', key: 'arrayJobId' },
  { name: 'ArrayTaskID', key: 'arrayTaskId' },
  { name: 'Partition', key: 'partition' },
  { name: 'Name', key: 'name' },
  { name: 'UserName', key: 'user' },
  { name: 'Account', key: 'account' },
  { name: 'QOS', key: 'qos' },
  { name: 'State', key: 'state' },
  { name: 'Reason', key: 'reason' },
  { name: 'TimeLimit', key: 'timeLimit' },
  { name: 'SubmitTime', key: 'submitTime' },
  { name: 'StartTime', key: 'startTime' },
  { name: 'EndTime', key: 'endTime' },
  { name: 'PriorityLong', key: 'priority' },
  { name: 'NumNodes', key: 'nodeCount' },
  { name: 'NodeList', key: 'nodeExpression' },
  { name: 'tres-alloc', key: 'allocatedTres' },
  { name: 'exit_code', key: 'exitCode' },
] as const;

// Width 0 prevents truncation. Control separators keep spaces and ordinary
// punctuation unambiguous in field values.
const SQUEUE_FORMAT = JOB_FIELDS
  .map((field, index) => `${field.name}:0${index === JOB_FIELDS.length - 1 ? RECORD_SEPARATOR : FIELD_SEPARATOR}`)
  .join(',');

const JOB_BASE_STATE_SET: ReadonlySet<string> = new Set(JOB_BASE_STATES);
type JobFieldKey = (typeof JOB_FIELDS)[number]['key'];
const JOB_ID_PATTERN = /^[1-9]\d*$/;
const ARRAY_ID_PATTERN = /^[1-9]\d*$/;
const INTEGER_PATTERN = /^\d+$/;
const EMPTY_FIELD = [''] as const;
const IDENTIFIER_UNSET = ['', 'N/A', '(NULL)'] as const;
const SLURM_UNSET = ['', 'N/A', '(NULL)', 'NONE'] as const;

function invalid(message: string): never {
  throw new UpstreamInvalidError(`squeue formatted output ${message}`);
}

function parseField(
  value: string,
  name: string,
  sentinels: readonly string[] = EMPTY_FIELD
): string | null {
  if (value.includes('\n') || value.includes('\r')) invalid(`contains a line break in ${name}`);
  if (sentinels.includes(value.toUpperCase())) return null;
  return value;
}

function parseInteger(value: string, field: string, nullable = true): number | null {
  const cleaned = parseField(value, field, SLURM_UNSET);
  if (cleaned === null) {
    if (nullable) return null;
    return invalid(`has an unset ${field}`);
  }
  if (!INTEGER_PATTERN.test(cleaned)) invalid(`has an invalid ${field}`);
  const number = Number(cleaned);
  if (!Number.isSafeInteger(number)) invalid(`has an out-of-range ${field}`);
  return number;
}

function parseEpoch(value: string, field: string): Date | null {
  const seconds = parseInteger(value, field);
  if (seconds === null || seconds === 0) return null;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) invalid(`has an out-of-range ${field}`);
  return date;
}

function parseTimeLimit(value: string): QueueJob['timeLimit'] {
  const cleaned = parseField(value, 'TimeLimit', SLURM_UNSET);
  if (cleaned === null || cleaned === 'NOT_SET') return null;
  if (cleaned === 'UNLIMITED') return { kind: 'infinite' };

  const dayMatch = cleaned.match(/^(\d+)-(\d{1,2}):([0-5]\d):([0-5]\d)$/);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    const hours = Number(dayMatch[2]);
    if (!Number.isSafeInteger(days) || hours > 23) invalid('has an invalid TimeLimit');
    const seconds = days * 86_400 + hours * 3_600 + Number(dayMatch[3]) * 60 + Number(dayMatch[4]);
    if (!Number.isSafeInteger(seconds)) invalid('has an out-of-range TimeLimit');
    return { kind: 'finite', seconds };
  }

  const hourMatch = cleaned.match(/^(\d+):([0-5]\d):([0-5]\d)$/);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    if (!Number.isSafeInteger(hours) || hours > 23) invalid('has an invalid TimeLimit');
    const seconds = hours * 3_600 + Number(hourMatch[2]) * 60 + Number(hourMatch[3]);
    if (!Number.isSafeInteger(seconds)) invalid('has an out-of-range TimeLimit');
    return { kind: 'finite', seconds };
  }

  const minuteMatch = cleaned.match(/^(\d+):([0-5]\d)$/);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (!Number.isSafeInteger(minutes)) invalid('has an invalid TimeLimit');
    const seconds = minutes * 60 + Number(minuteMatch[2]);
    if (!Number.isSafeInteger(seconds)) invalid('has an out-of-range TimeLimit');
    return { kind: 'finite', seconds };
  }
  return invalid('has an invalid TimeLimit');
}

function parseState(value: string): { state: JobBaseState; stateFlags: string[] } {
  if (['', 'N/A', '(NULL)', 'NONE'].includes(value.toUpperCase())) {
    return invalid('has an unset State');
  }
  const state = value.toUpperCase();
  if (JOB_BASE_STATE_SET.has(state)) return { state: state as JobBaseState, stateFlags: [] };
  const cleaned = parseField(value, 'State', []);
  if (cleaned === null || cleaned.trim().length === 0) return invalid('has an empty State');
  return { state: 'UNKNOWN', stateFlags: [cleaned] };
}

function parseExitCode(value: string): string | null {
  const cleaned = parseField(value, 'exit_code', SLURM_UNSET);
  if (cleaned === null) return null;
  const match = cleaned.match(/^(\d+):\d+$/);
  if (!match) return invalid('has an invalid exit_code');
  const code = Number(match[1]);
  if (!Number.isSafeInteger(code)) return invalid('has an out-of-range exit_code');
  return String(code);
}

function parseJobRecord(fields: string[], recordIndex: number): QueueJob {
  if (fields.length !== JOB_FIELDS.length) {
    return invalid(`record ${recordIndex} has ${fields.length} fields; expected ${JOB_FIELDS.length}`);
  }
  const row = Object.fromEntries(
    JOB_FIELDS.map((field, index) => [field.key, fields[index]])
  ) as Record<JobFieldKey, string>;

  const jobId = parseField(row.jobId, 'JobID', []);
  if (jobId === null || !JOB_ID_PATTERN.test(jobId)) invalid(`record ${recordIndex} has an unsupported JobID`);
  const arrayIdField = parseField(row.arrayJobId, 'ArrayJobID', SLURM_UNSET);
  const taskIdText = parseField(row.arrayTaskId, 'ArrayTaskID', SLURM_UNSET);
  const arrayTaskId = taskIdText === null ? null : String(parseInteger(taskIdText, 'ArrayTaskID', false));
  const arrayJobId = arrayIdField === null ? null : arrayIdField;
  let id = jobId;
  // Slurm may repeat JobID in JobArrayID for ordinary jobs. ArrayTaskID
  // identifies array elements.
  if (arrayTaskId !== null) {
    if (arrayJobId === null || !ARRAY_ID_PATTERN.test(arrayJobId)) {
      invalid(`record ${recordIndex} has an invalid ArrayJobID`);
    }
    id = `${arrayJobId}_${arrayTaskId}`;
  } else if (!ARRAY_ID_PATTERN.test(jobId)) {
    invalid(`record ${recordIndex} has an unsupported non-array JobID`);
  }

  const { state, stateFlags } = parseState(row.state);
  const rawTres = row.allocatedTres;
  // For jobs without an allocation, tres-alloc may contain requested TRES.
  const parsedTres = state === 'RUNNING'
    ? parseTresString(parseField(rawTres, 'tres-alloc', SLURM_UNSET))
    : null;
  const allocated: AllocatedJobResources = {
    cpus: parsedTres?.cpus ?? null,
    memoryMiB: parsedTres?.memoryMiB ?? null,
    nodes: parsedTres?.nodes ?? null,
    gpus: parsedTres?.gpus ?? { total: 0, byType: {} },
  // Core allocation fields establish a complete record even without a GPU
  // entry. Without an allocation record, GPU usage is unknown.
    gpuPresent: parsedTres !== null && /(^|,)(?:cpu=|mem=|node=|billing=|gres\/gpu(?:[^=,]*)=)/i.test(rawTres),
  };
  const priority = parseInteger(row.priority, 'PriorityLong');
  const nodeCount = parseInteger(row.nodeCount, 'NumNodes');
  const reason = parseField(row.reason, 'Reason', SLURM_UNSET);

  return {
    id,
    jobId,
    arrayJobId: arrayTaskId === null ? null : arrayJobId,
    arrayTaskId,
    partition: parseField(row.partition, 'Partition', IDENTIFIER_UNSET),
    name: parseField(row.name, 'Name'),
    user: parseField(row.user, 'UserName', IDENTIFIER_UNSET),
    account: parseField(row.account, 'Account', IDENTIFIER_UNSET),
    qos: parseField(row.qos, 'QOS', IDENTIFIER_UNSET),
    state,
    stateFlags,
    stateReason: reason?.toUpperCase() === 'NONE' ? null : reason,
    timeLimit: parseTimeLimit(row.timeLimit),
    submitTime: parseEpoch(row.submitTime, 'SubmitTime'),
    startTime: parseEpoch(row.startTime, 'StartTime'),
    endTime: parseEpoch(row.endTime, 'EndTime'),
    priority,
    nodeCount,
    nodeExpression: parseField(row.nodeExpression, 'NodeList', SLURM_UNSET),
    allocated,
    exitCode: parseExitCode(row.exitCode),
  };
}

function parseJobsStdout(stdout: string): QueueJob[] {
  if (stdout.length === 0) return [];
  if (!stdout.endsWith(RECORD_TERMINATOR)) invalid('is missing a final record terminator');
  const records = stdout.slice(0, -RECORD_TERMINATOR.length).split(RECORD_TERMINATOR);
  return records.map((record, index) => {
    const fields = record.split(FIELD_SEPARATOR);
    return parseJobRecord(fields, index + 1);
  });
}

async function fetchJobs(
  context: SlurmContext,
  options: { signal?: AbortSignal } = {}
): Promise<QueueJob[]> {
  const run: SlurmRunFn = context.run ?? runCommand;
  const { stdout, stderr } = await run(
    'squeue',
    ['--noheader', '--array', '--states=R,PD,CD', `--Format=${SQUEUE_FORMAT}`],
    {
      timeoutMs: JOBS_COMMAND_TIMEOUT_MS,
      maxBufferBytes: JOBS_COMMAND_MAX_BUFFER_BYTES,
      signal: options.signal,
      env: { SLURM_TIME_FORMAT: '%s' },
    }
  );
  if (stderr.trim().length > 0) {
    console.warn(`[Slurm] squeue stderr: ${stderr.trim().slice(0, 500)}`);
  }
  return parseJobsStdout(stdout);
}

export {
  JOBS_COMMAND_MAX_BUFFER_BYTES,
  JOBS_COMMAND_TIMEOUT_MS,
  JOB_FIELDS,
  SQUEUE_FORMAT,
  fetchJobs,
  parseJobsStdout,
};
