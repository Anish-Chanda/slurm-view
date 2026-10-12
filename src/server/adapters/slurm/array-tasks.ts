// On-demand accounting for one array job.
import { JOB_BASE_STATES } from '../../models/job.js';
import type { JobBaseState } from '../../models/job.js';
import type { SlurmContext, SlurmRunFn } from './context.js';
import { runCommand } from './command-runner.js';
import { SlurmUpstreamError, UpstreamInvalidError } from './errors.js';

const ARRAY_TASKS_COMMAND_TIMEOUT_MS = 20_000;
const ARRAY_TASKS_COMMAND_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const ARRAY_JOB_ID_PATTERN = /^[1-9]\d*$/;
const ARRAY_ELEMENT_PATTERN = /^([1-9]\d*)_(\d+)$/;
const INTEGER_PATTERN = /^\d+$/;

const ARRAY_TASKS_FORMAT = 'JobID,State,ExitCode,ElapsedRaw,NodeList';

interface ArrayTaskRecord {
  readonly taskId: number;
  readonly state: JobBaseState;
  readonly elapsedSeconds: number | null;
  readonly nodeExpression: string | null;
  readonly exitCode: string | null;
}

const JOB_BASE_STATE_SET: ReadonlySet<string> = new Set(JOB_BASE_STATES);

// Reject malformed rows for the requested array.
function assertExactTargetRowWellFormed(fields: string[], arrayJobId: string): void {
  const first = fields[0].trim();
  if (first.includes('.')) {
    return;
  }
  const element = first.match(ARRAY_ELEMENT_PATTERN);
  if (element && element[1] === arrayJobId) {
    throw new UpstreamInvalidError(
      `sacct record for task ${element[2]} of array job ${arrayJobId} has ${fields.length} fields; expected 5`
    );
  }
}

function normalizeState(value: string): JobBaseState {
  // Strip common sacct state decorations.
  const token = (value.trim().toUpperCase().split(/\s+/)[0] ?? '').replace(/\++$/, '');
  if (JOB_BASE_STATE_SET.has(token)) {
    return token as JobBaseState;
  }
  return 'UNKNOWN';
}

function normalizeExitCode(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const prefixed = trimmed.match(/^(\d+)\s*:/);
  if (prefixed) {
    return prefixed[1];
  }
  if (INTEGER_PATTERN.test(trimmed)) {
    const code = Number(trimmed);
    return Number.isSafeInteger(code) ? String(code) : null;
  }
  return null;
}

function normalizeElapsed(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.toUpperCase() === 'UNKNOWN') {
    return null;
  }
  if (!INTEGER_PATTERN.test(trimmed)) {
    return null;
  }
  const seconds = Number(trimmed);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function normalizeNodeExpression(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Ignore non-task rows and reject malformed target rows.
function parseArrayTasksStdout(stdout: string, arrayJobId: string): ArrayTaskRecord[] {
  const byTaskId = new Map<number, ArrayTaskRecord>();
  let sawContent = false;
  for (const line of stdout.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    sawContent = true;
    const fields = line.split('|');
    if (fields.length !== 5) {
      assertExactTargetRowWellFormed(fields, arrayJobId);
      continue;
    }
    const [rawJobId, rawState, rawExitCode, rawElapsed, rawNodes] = fields;
    if (rawJobId.includes('.')) {
      continue;
    }
    const element = rawJobId.trim().match(ARRAY_ELEMENT_PATTERN);
    if (!element || element[1] !== arrayJobId) {
      continue;
    }
    const taskId = Number(element[2]);
    if (!Number.isSafeInteger(taskId)) {
      continue;
    }
    byTaskId.set(taskId, {
      taskId,
      state: normalizeState(rawState),
      elapsedSeconds: normalizeElapsed(rawElapsed),
      nodeExpression: normalizeNodeExpression(rawNodes),
      exitCode: normalizeExitCode(rawExitCode),
    });
  }
  if (byTaskId.size === 0 && sawContent) {
    throw new UpstreamInvalidError(`sacct returned no valid records for array job ${arrayJobId}`);
  }
  return [...byTaskId.values()].sort((a, b) => a.taskId - b.taskId);
}

async function fetchArrayTasks(
  context: SlurmContext,
  arrayJobId: string,
  options: { signal?: AbortSignal } = {}
): Promise<ArrayTaskRecord[]> {
  if (!ARRAY_JOB_ID_PATTERN.test(arrayJobId)) {
    throw new UpstreamInvalidError(`Invalid array job ID: ${arrayJobId}`);
  }
  const run: SlurmRunFn = context.run ?? runCommand;
  const { stdout, stderr } = await run(
    'sacct',
    [
      `--jobs=${arrayJobId}`,
      '--array',
      '--allocations',
      '--allusers',
      '--local',
      '--noheader',
      '--parsable2',
      `--format=${ARRAY_TASKS_FORMAT}`,
    ],
    {
      timeoutMs: ARRAY_TASKS_COMMAND_TIMEOUT_MS,
      maxBufferBytes: ARRAY_TASKS_COMMAND_MAX_BUFFER_BYTES,
      signal: options.signal,
    }
  );
  if (stderr.trim().length > 0) {
    console.warn(`[Slurm] sacct stderr: ${stderr.trim().slice(0, 500)}`);
  }
  const records = parseArrayTasksStdout(stdout, arrayJobId);
  // Empty output cannot produce a complete map.
  if (records.length === 0) {
    throw new SlurmUpstreamError([`sacct returned no accounting records for array job ${arrayJobId}`]);
  }
  return records;
}

export {
  ARRAY_TASKS_COMMAND_MAX_BUFFER_BYTES,
  ARRAY_TASKS_COMMAND_TIMEOUT_MS,
  ARRAY_TASKS_FORMAT,
  fetchArrayTasks,
  parseArrayTasksStdout,
};
export type { ArrayTaskRecord };
