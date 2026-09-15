// Targeted current-job lookup for pending analysis: one fresh
// `scontrol --json show job <id>` for state, stateReason, and fields the
// shared squeue snapshot does not carry (node lists, array throttle,
// MinMemory flavors).
import { z } from 'zod';
import { runCommand } from './command-runner.js';
import type { SlurmContext, SlurmRunFn } from './context.js';
import { describeNotice, normalizeSlurmNumber, slurmNumericSchema, slurmNoticeSchema } from './schemas/common.js';
import { rawJobSchema } from './schemas/jobs.js';
import type { RawJob } from './schemas/jobs.js';
import type { SupportedDataParser } from './parser-version.js';
import { normalizeJob } from './jobs.js';
import type { Job } from '../../models/job.js';
import { SlurmUpstreamError, UpstreamInvalidError, summarizeZodIssues } from './errors.js';
import { parseMemoryToMiB } from './tres.js';
import { canonicalJobIdSchema } from '../../validation/job-id.js';

const TARGETED_JOB_COMMAND_TIMEOUT_MS = 15_000;
const TARGETED_JOB_COMMAND_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

// Extra pending-relevant keys. scontrol JSON spellings vary by parser
// generation, so common aliases are accepted; absent keys stay null.
const rawTargetedJobSchema = rawJobSchema.extend({
  sched_nodes: z.union([z.string(), z.array(z.union([z.string(), z.number()]))]).nullish(),
  sched_nodelist: z.union([z.string(), z.array(z.union([z.string(), z.number()]))]).nullish(),
  req_nodes: z.union([z.string(), z.array(z.union([z.string(), z.number()]))]).nullish(),
  req_nodelist: z.union([z.string(), z.array(z.union([z.string(), z.number()]))]).nullish(),
  array_throttle: slurmNumericSchema.nullish(),
  min_memory_node: slurmNumericSchema.nullish(),
  min_memory_cpu: slurmNumericSchema.nullish(),
  min_memory_per_cpu: slurmNumericSchema.nullish(),
  min_memory_per_gpu: slurmNumericSchema.nullish(),
  num_nodes: slurmNumericSchema.nullish(),
  user_id: slurmNumericSchema.nullish(),
  begin_time: slurmNumericSchema.nullish(),
});

type RawTargetedJob = z.infer<typeof rawTargetedJobSchema>;

const targetedJobResponseEnvelopeSchema = z.object({
  jobs: z.array(rawTargetedJobSchema),
  meta: z.unknown().optional(),
  errors: z.array(slurmNoticeSchema).nullish(),
  warnings: z.array(slurmNoticeSchema).nullish(),
  last_update: z.unknown().optional(),
});

interface TargetedJob {
  readonly job: Job;
  readonly schedNodeList: string | null;
  readonly reqNodeList: string | null;
  readonly arrayThrottle: number | null;
  // Collapsed memory value used by limit analyzers.
  readonly minMemoryMiB: number | null;
  readonly memory: MemoryRequirement;
  readonly requestedNodes: number | null;
  readonly capturedAt: Date;
}

// Slurm memory constraints are modal (--mem vs --mem-per-cpu vs
// --mem-per-gpu); fit analysis consumes this instead of minMemoryMiB.
type MemoryRequirement =
  | { kind: 'perNode'; memoryMiB: number }
  | { kind: 'perCpu'; memoryMiB: number }
  | { kind: 'perGpu'; memoryMiB: number }
  | { kind: 'unknown'; memoryMiB: number | null };

function cleanText(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 && trimmed !== '(null)' ? trimmed : null;
}

function joinNodeList(input: RawTargetedJob[keyof RawTargetedJob]): string | null {
  if (typeof input === 'string') {
    return cleanText(input);
  }
  if (Array.isArray(input)) {
    const parts = input
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0 && entry !== '(null)');
    return parts.length > 0 ? parts.join(',') : null;
  }
  return null;
}

function normalizeThrottleText(input: unknown): number | null {
  if (input === null || input === undefined) {
    return null;
  }
  const text = String(input).trim();
  if (text.length === 0 || text.toUpperCase() === 'N/A' || text.toUpperCase() === 'UNKNOWN') {
    return null;
  }
  // scontrol reports throttle inside ArrayTaskId as "1-10%2".
  const percentMatch = text.match(/%\s*(\d+)\s*$/);
  const candidate = percentMatch?.[1] ?? text;
  const parsed = Number(candidate);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}

function normalizeThrottleNumeric(input: unknown, arrayTaskId: string | null): number | null {
  if (input !== null && input !== undefined) {
    const text = String(
      typeof input === 'object'
        ? (input as { number?: unknown }).number ?? ''
        : input
    ).trim();
    if (text.length > 0 && text !== '-1' && text.toUpperCase() !== 'N/A') {
      const parsed = Number(text);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
      if (Number.isFinite(parsed) && parsed === 0) {
        return null; // 0 = no throttle limit.
      }
    }
  }
  return normalizeThrottleText(arrayTaskId);
}

function normalizeMinMemoryValue(candidate: unknown): number | null {
  if (candidate === null || candidate === undefined) {
    return null;
  }
  if (typeof candidate === 'number') {
    return Number.isFinite(candidate) && candidate > 0 ? Math.round(candidate) : null;
  }
  if (typeof candidate === 'string') {
    const parsed = parseMemoryToMiB(candidate);
    return parsed !== null && parsed > 0 ? parsed : null;
  }
  if (typeof candidate === 'object') {
    const inner = (candidate as { number?: unknown }).number;
    if (typeof inner === 'number') {
      return Number.isFinite(inner) && inner > 0 ? Math.round(inner) : null;
    }
    if (typeof inner === 'string') {
      const parsed = parseMemoryToMiB(inner);
      return parsed !== null && parsed > 0 ? parsed : null;
    }
  }
  return null;
}

function normalizeMemoryRequirement(
  raw: RawTargetedJob,
  requestedMemoryMiB: number | null
): MemoryRequirement {
  // Exactly one memory mode is in effect per Slurm submission.
  const perNode = normalizeMinMemoryValue(raw.min_memory_node ?? null);
  if (perNode !== null) {
    return { kind: 'perNode', memoryMiB: perNode };
  }
  const perCpu = normalizeMinMemoryValue(raw.min_memory_cpu ?? null)
    ?? normalizeMinMemoryValue(raw.min_memory_per_cpu ?? null);
  if (perCpu !== null) {
    return { kind: 'perCpu', memoryMiB: perCpu };
  }
  const perGpu = normalizeMinMemoryValue(raw.min_memory_per_gpu ?? null);
  if (perGpu !== null) {
    return { kind: 'perGpu', memoryMiB: perGpu };
  }
  return { kind: 'unknown', memoryMiB: requestedMemoryMiB };
}

function normalizeMinMemoryMiB(raw: RawTargetedJob, requestedMemoryMiB: number | null): number | null {
  // Collapsed form kept for limit analyzers, which need a single amount;
  // resource-fit analysis uses the modal `memory` field instead.
  for (const candidate of [raw.min_memory_node, raw.min_memory_cpu, raw.min_memory_per_cpu]) {
    const parsed = normalizeMinMemoryValue(candidate ?? null);
    if (parsed !== null) {
      return parsed;
    }
  }
  return requestedMemoryMiB;
}

function normalizeRequestedNodes(raw: RawTargetedJob, fallback: number | null): number | null {
  const { value } = normalizeSlurmNumber(raw.num_nodes ?? null);
  if (value !== null && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

function toTargetedJob(raw: RawTargetedJob, capturedAt: Date): TargetedJob {
  const job = normalizeJob(raw as RawJob);
  const schedNodeList =
    joinNodeList(raw.sched_nodes ?? null) ?? joinNodeList(raw.sched_nodelist ?? null);
  const reqNodeList =
    joinNodeList(raw.req_nodes ?? null) ?? joinNodeList(raw.req_nodelist ?? null);
  // A dedicated array_throttle key is preferred when present.
  const arrayTaskRaw =
    typeof raw.array_task_id === 'string' ? raw.array_task_id : null;
  const fromTaskId = normalizeThrottleText(arrayTaskRaw);
  const fromNumeric = normalizeThrottleNumeric(raw.array_throttle ?? null, null);
  return {
    job,
    schedNodeList,
    reqNodeList,
    arrayThrottle: fromNumeric ?? fromTaskId,
    minMemoryMiB: normalizeMinMemoryMiB(raw, job.requested.memoryMiB),
    memory: normalizeMemoryRequirement(raw, job.requested.memoryMiB),
    requestedNodes: normalizeRequestedNodes(raw, job.requested.nodes),
    capturedAt,
  };
}

function rawCanonicalId(raw: RawTargetedJob): string | null {
  const jobId = String(raw.job_id).trim();
  const arrayJob = normalizeSlurmNumber(raw.array_job_id ?? null).value;
  const arrayTask = normalizeSlurmNumber(raw.array_task_id ?? null).value;
  if (
    arrayJob !== null && Number.isInteger(arrayJob) && arrayJob > 0 &&
    arrayTask !== null && Number.isInteger(arrayTask) && arrayTask >= 0 &&
    !jobId.includes('_')
  ) {
    return `${Math.trunc(arrayJob)}_${Math.trunc(arrayTask)}`;
  }
  // ArrayTaskId may be a range ("1-10%2"); only a single numeric task id
  // composes an exact identity.
  if (typeof raw.array_task_id === 'string' && /^\d+$/.test(raw.array_task_id.trim()) && /^\d+$/.test(jobId)) {
    return `${jobId}_${raw.array_task_id.trim()}`;
  }
  return jobId.length > 0 ? jobId : null;
}

function parseTargetedJobStdout(
  parser: SupportedDataParser,
  stdout: string,
  jobId: string
): TargetedJob | null {
  void parser;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new UpstreamInvalidError(
      `scontrol returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  // Pending-specific fields are optional, so one parse covers all parser
  // generations.
  const envelope = targetedJobResponseEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    throw new UpstreamInvalidError(
      `scontrol response failed validation: ${summarizeZodIssues(envelope.error.issues)}`
    );
  }
  if (envelope.data.errors && envelope.data.errors.length > 0) {
    throw new SlurmUpstreamError(envelope.data.errors.map(describeNotice));
  }
  if (envelope.data.warnings && envelope.data.warnings.length > 0) {
    console.warn(
      `[Slurm] scontrol warnings: ${envelope.data.warnings.map(describeNotice).join('; ')}`
    );
  }
  // The requested canonical id must match; never the array master.
  const match = envelope.data.jobs.find((entry) => rawCanonicalId(entry) === jobId) ?? null;
  if (match === null) {
    return null;
  }
  return toTargetedJob(match, new Date());
}

// Null means Slurm reports no such job (the service maps it to 404).
async function fetchTargetedJob(
  context: SlurmContext,
  jobId: string,
  options: { signal?: AbortSignal } = {}
): Promise<TargetedJob | null> {
  const parsed = canonicalJobIdSchema.safeParse(jobId);
  if (!parsed.success) {
    throw new UpstreamInvalidError(`Invalid job ID: ${jobId}`);
  }
  const run: SlurmRunFn = context.run ?? runCommand;
  const { stdout } = await run('scontrol', [`--json=${context.parser}`, 'show', 'job', parsed.data], {
    timeoutMs: TARGETED_JOB_COMMAND_TIMEOUT_MS,
    maxBufferBytes: TARGETED_JOB_COMMAND_MAX_BUFFER_BYTES,
    signal: options.signal,
  });
  return parseTargetedJobStdout(context.parser, stdout, parsed.data);
}

export {
  TARGETED_JOB_COMMAND_MAX_BUFFER_BYTES,
  TARGETED_JOB_COMMAND_TIMEOUT_MS,
  fetchTargetedJob,
  parseTargetedJobStdout,
};
export type { MemoryRequirement, RawTargetedJob, TargetedJob };
