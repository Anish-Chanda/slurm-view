import { describeNotice } from './schemas/common.js';
import type { RawPartition } from './schemas/partitions.js';
import { partitionsResponseSchemaFor } from './schemas/partitions.js';
import type { SupportedDataParser } from './parser-version.js';
import { runCommand } from './command-runner.js';
import { SlurmUpstreamError, UpstreamInvalidError, summarizeZodIssues } from './errors.js';
import type { SlurmContext, SlurmRunFn } from './context.js';

const PARTITIONS_COMMAND_TIMEOUT_MS = 15_000;
const PARTITIONS_COMMAND_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

function normalizePartitionName(raw: RawPartition): string {
  const name = raw.name.trim();
  if (name.length === 0) {
    throw new UpstreamInvalidError('sinfo returned a partition with an empty name');
  }
  return name;
}

// Throws on invalid JSON, schema mismatch, or a non-empty Slurm errors[].
function parsePartitionsStdout(parser: SupportedDataParser, stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new UpstreamInvalidError(
      `sinfo returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const result = partitionsResponseSchemaFor(parser).safeParse(parsed);
  if (!result.success) {
    throw new UpstreamInvalidError(
      `sinfo response failed validation: ${summarizeZodIssues(result.error.issues)}`
    );
  }

  if (result.data.errors && result.data.errors.length > 0) {
    throw new SlurmUpstreamError(result.data.errors.map(describeNotice));
  }
  if (result.data.warnings && result.data.warnings.length > 0) {
    console.warn(
      `[Slurm] sinfo warnings: ${result.data.warnings.map(describeNotice).join('; ')}`
    );
  }

  return result.data.partitions.map(normalizePartitionName);
}

async function fetchPartitions(
  context: SlurmContext,
  options: { signal?: AbortSignal } = {}
): Promise<string[]> {
  const run: SlurmRunFn = context.run ?? runCommand;
  const { stdout } = await run('sinfo', [`--json=${context.parser}`], {
    timeoutMs: PARTITIONS_COMMAND_TIMEOUT_MS,
    maxBufferBytes: PARTITIONS_COMMAND_MAX_BUFFER_BYTES,
    signal: options.signal,
  });
  return parsePartitionsStdout(context.parser, stdout);
}

export {
  PARTITIONS_COMMAND_MAX_BUFFER_BYTES,
  PARTITIONS_COMMAND_TIMEOUT_MS,
  fetchPartitions,
  normalizePartitionName,
  parsePartitionsStdout,
};
