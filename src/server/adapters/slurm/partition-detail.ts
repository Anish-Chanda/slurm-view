// Single-partition detail adapter: state, time/node caps, configured
// partition QOS. Unknown keys stay null.
import { z } from 'zod';
import { runCommand } from './command-runner.js';
import type { SlurmContext, SlurmRunFn } from './context.js';
import { describeNotice, slurmNumericSchema, slurmNoticeSchema } from './schemas/common.js';
import { SlurmUpstreamError, UpstreamInvalidError, summarizeZodIssues } from './errors.js';
import type { PartitionDetail } from '../../models/partition.js';

const PARTITION_DETAIL_COMMAND_TIMEOUT_MS = 15_000;
const PARTITION_DETAIL_COMMAND_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

const PARTITION_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Only the name is guaranteed; every fact field is optional and may
// arrive as a number, numeric string, {number,set,infinite} wrapper, or
// time string.
const rawPartitionDetailSchema = z
  .object({
    name: z.string(),
    state: z.union([z.string(), z.array(z.string())]).nullish(),
    qos: z.union([z.string(), z.array(z.string())]).nullish(),
    max_time: z.union([z.string(), z.number(), slurmNumericSchema]).nullish(),
    maximum_time: z.union([z.string(), z.number(), slurmNumericSchema]).nullish(),
    max_nodes: z.union([z.string(), z.number(), slurmNumericSchema]).nullish(),
    maximum_nodes: z.union([z.string(), z.number(), slurmNumericSchema]).nullish(),
    total_nodes: z.union([z.string(), z.number(), slurmNumericSchema]).nullish(),
  })
  .passthrough();

type RawPartitionDetail = z.infer<typeof rawPartitionDetailSchema>;

const partitionDetailEnvelopeSchema = z.object({
  partitions: z.array(rawPartitionDetailSchema),
  meta: z.unknown().optional(),
  errors: z.array(slurmNoticeSchema).nullish(),
  warnings: z.array(slurmNoticeSchema).nullish(),
  last_update: z.unknown().optional(),
});

function cleanText(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 && trimmed !== '(null)' ? trimmed : null;
}

function normalizeState(input: RawPartitionDetail['state']): string | null {
  if (typeof input === 'string') {
    return cleanText(input);
  }
  if (Array.isArray(input)) {
    const parts = input.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
    return parts.length > 0 ? parts.join(',') : null;
  }
  return null;
}

// Partition MaxTime arrives as minutes (number/wrapper) or a Slurm time
// string. UNLIMITED/INFINITE/None means null.
function parseSlurmDurationToSeconds(input: unknown): number | null {
  if (input === null || input === undefined) {
    return null;
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) {
      return null;
    }
    // Numeric scontrol JSON times are minutes.
    return Math.round(input * 60);
  }
  if (typeof input === 'object') {
    const wrapper = input as { number?: unknown; infinite?: unknown; set?: unknown };
    if (wrapper.infinite === true) {
      return null;
    }
    if (wrapper.set === false) {
      return null;
    }
    return parseSlurmDurationToSeconds(wrapper.number ?? null);
  }
  const text = String(input).trim();
  if (text.length === 0) {
    return null;
  }
  const upper = text.toUpperCase();
  if (upper === 'UNLIMITED' || upper === 'INFINITE' || upper === 'NONE' || upper === 'N/A') {
    return null;
  }
  if (/^\d+(\.\d+)?$/.test(text)) {
    const minutes = Number(text);
    return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : null;
  }
  // D-HH:MM:SS, HH:MM:SS, MM:SS
  const daySplit = text.split('-');
  let days = 0;
  let clock = text;
  if (daySplit.length === 2) {
    days = Number(daySplit[0]);
    clock = daySplit[1] ?? '';
    if (!Number.isFinite(days) || days < 0) {
      return null;
    }
  } else if (daySplit.length > 2) {
    return null;
  }
  const parts = clock.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }
  let seconds = days * 86400;
  if (parts.length === 3) {
    seconds += (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  } else if (parts.length === 2) {
    seconds += (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  } else {
    return null;
  }
  return seconds > 0 ? Math.round(seconds) : null;
}

function normalizeCount(input: unknown): number | null {
  if (input === null || input === undefined) {
    return null;
  }
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0 ? Math.floor(input) : null;
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length === 0 || trimmed.toUpperCase() === 'UNLIMITED' || trimmed.toUpperCase() === 'N/A') {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
  }
  if (typeof input === 'object') {
    const wrapper = input as { number?: unknown; infinite?: unknown; set?: unknown };
    if (wrapper.infinite === true || wrapper.set === false) {
      return null;
    }
    return normalizeCount(wrapper.number ?? null);
  }
  return null;
}

function toPartitionDetail(raw: RawPartitionDetail): PartitionDetail {
  const qosRaw = Array.isArray(raw.qos) ? (raw.qos[0] ?? null) : (raw.qos ?? null);
  return {
    name: raw.name.trim(),
    state: normalizeState(raw.state ?? null),
    maxTimeSeconds:
      parseSlurmDurationToSeconds(raw.max_time ?? null) ??
      parseSlurmDurationToSeconds(raw.maximum_time ?? null),
    maxNodes:
      normalizeCount(raw.max_nodes ?? null) ?? normalizeCount(raw.maximum_nodes ?? null),
    totalNodes: normalizeCount(raw.total_nodes ?? null),
    qos: cleanText(typeof qosRaw === 'string' ? qosRaw : null),
  };
}

function parsePartitionDetailStdout(stdout: string, name: string): PartitionDetail | null {
  // A missing partition is null, never another partition's record.
  return parsePartitionTableStdout(stdout).find((entry) => entry.name === name) ?? null;
}

// Full-cluster partition table, used for the partition to QOS mapping.
function parsePartitionTableStdout(stdout: string): PartitionDetail[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new UpstreamInvalidError(
      `scontrol returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const result = partitionDetailEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    throw new UpstreamInvalidError(
      `scontrol response failed validation: ${summarizeZodIssues(result.error.issues)}`
    );
  }
  if (result.data.errors && result.data.errors.length > 0) {
    throw new SlurmUpstreamError(result.data.errors.map(describeNotice));
  }
  return result.data.partitions.map(toPartitionDetail);
}

async function fetchPartitionTable(
  context: SlurmContext,
  options: { signal?: AbortSignal } = {}
): Promise<PartitionDetail[]> {
  const run: SlurmRunFn = context.run ?? runCommand;
  const { stdout } = await run('scontrol', [`--json=${context.parser}`, 'show', 'partition'], {
    timeoutMs: PARTITION_DETAIL_COMMAND_TIMEOUT_MS,
    maxBufferBytes: PARTITION_DETAIL_COMMAND_MAX_BUFFER_BYTES,
    signal: options.signal,
  });
  return parsePartitionTableStdout(stdout);
}

async function fetchPartitionDetail(
  context: SlurmContext,
  name: string,
  options: { signal?: AbortSignal } = {}
): Promise<PartitionDetail | null> {
  if (!PARTITION_NAME_PATTERN.test(name)) {
    throw new UpstreamInvalidError(`Invalid partition name: ${name}`);
  }
  const run: SlurmRunFn = context.run ?? runCommand;
  const { stdout } = await run('scontrol', [`--json=${context.parser}`, 'show', 'partition', name], {
    timeoutMs: PARTITION_DETAIL_COMMAND_TIMEOUT_MS,
    maxBufferBytes: PARTITION_DETAIL_COMMAND_MAX_BUFFER_BYTES,
    signal: options.signal,
  });
  return parsePartitionDetailStdout(stdout, name);
}

export {
  PARTITION_DETAIL_COMMAND_MAX_BUFFER_BYTES,
  PARTITION_DETAIL_COMMAND_TIMEOUT_MS,
  fetchPartitionDetail,
  fetchPartitionTable,
  parsePartitionDetailStdout,
  parsePartitionTableStdout,
  parseSlurmDurationToSeconds,
};
export type { RawPartitionDetail };
