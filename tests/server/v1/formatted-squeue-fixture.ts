type RawJobFixture = Record<string, unknown>;

const FIELD_SEPARATOR = '\x1f';
const RECORD_SEPARATOR = '\x1e\n';

function numeric(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input === 'string' && /^\d+$/.test(input.trim())) return Number(input);
  if (input !== null && typeof input === 'object') {
    const wrapper = input as { number?: unknown; set?: unknown; infinite?: unknown };
    if (wrapper.set === false || wrapper.infinite === true) return null;
    return numeric(wrapper.number);
  }
  return null;
}

function isInfinite(input: unknown): boolean {
  return input !== null && typeof input === 'object' &&
    (input as { infinite?: unknown }).infinite === true;
}

function text(input: unknown, fallback = ''): string {
  if (Array.isArray(input)) return input.map(String).join(',');
  return input === null || input === undefined ? fallback : String(input);
}

function timeLimit(input: unknown): string {
  if (isInfinite(input)) return 'UNLIMITED';
  const minutes = numeric(input);
  if (minutes === null) return 'NOT_SET';
  const total = Math.trunc(minutes * 60);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}-${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${hours}:${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function state(input: unknown): string {
  if (Array.isArray(input)) return text(input[0], 'UNKNOWN');
  return text(input, 'UNKNOWN');
}

function exitCode(input: unknown): string {
  if (input === null || typeof input !== 'object') return 'N/A';
  const value = numeric((input as { return_code?: unknown }).return_code);
  return value === null ? 'N/A' : `${Math.trunc(value)}:0`;
}

function formattedSqueue(jobs: readonly RawJobFixture[]): string {
  return jobs.map((job) => {
    const rawJobId = text(job.job_id);
    const arrayJobId = numeric(job.array_job_id);
    const arrayTaskId = numeric(job.array_task_id);
    const fields = [
      rawJobId,
      arrayJobId !== null && arrayJobId > 0 ? String(Math.trunc(arrayJobId)) : rawJobId,
      arrayJobId !== null && arrayJobId > 0 && arrayTaskId !== null ? String(Math.trunc(arrayTaskId)) : 'N/A',
      text(job.partition),
      text(job.name),
      text(job.user_name),
      text(job.account),
      text(job.qos),
      state(job.job_state),
      text(job.state_reason, 'None'),
      timeLimit(job.time_limit),
      String(numeric(job.submit_time) ?? 0),
      String(numeric(job.start_time) ?? 0),
      String(numeric(job.end_time) ?? 0),
      String(numeric(job.priority) ?? 0),
      String(numeric(job.node_count) ?? 0),
      text(job.nodes),
      text(job.tres_alloc_str),
      exitCode(job.exit_code),
    ];
    return fields.join(FIELD_SEPARATOR) + RECORD_SEPARATOR;
  }).join('');
}

export { FIELD_SEPARATOR, RECORD_SEPARATOR, formattedSqueue };
export type { RawJobFixture };
