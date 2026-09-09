import { normalizeSlurmNumber, describeNotice } from './schemas/common.js';
import type { RawNode } from './schemas/nodes.js';
import { nodeResponseSchemaFor } from './schemas/nodes.js';
import type { SupportedDataParser } from './parser-version.js';
import { runCommand } from './command-runner.js';
import { SlurmUpstreamError, UpstreamInvalidError, summarizeZodIssues } from './errors.js';
import { normalizeCpuLoad } from './cpu-load.js';
import { parseNodeGres } from './gres.js';
import { splitNodeState } from './states.js';
import type { SlurmContext, SlurmRunFn } from './context.js';
import type { ClusterNode } from '../../models/node.js';

const NODES_COMMAND_TIMEOUT_MS = 25_000;
const NODES_COMMAND_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

// Capacity and allocation without which stats would be silently wrong.
// Explicit zero is valid; absent data rejects the payload.
function requiredSlurmNumber(
  input: unknown,
  field: string,
  nodeName: string,
  round: (value: number) => number
): number {
  const { value } = normalizeSlurmNumber(input);
  if (value === null || !Number.isFinite(value) || value < 0) {
    throw new UpstreamInvalidError(
      `scontrol node "${nodeName}" is missing required field: ${field}`
    );
  }
  return round(value);
}

function normalizeCount(input: unknown): number {
  const { value } = normalizeSlurmNumber(input);
  if (value === null || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

// free_mem is informational only; absence stays null instead of zero.
function normalizeFreeMemory(input: unknown): number | null {
  const { value } = normalizeSlurmNumber(input);
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

function normalizeNode(raw: RawNode): ClusterNode {
  const gres = typeof raw.gres === 'string' && raw.gres.trim().length > 0 ? raw.gres.trim() : null;
  const gresUsed =
    typeof raw.gres_used === 'string' && raw.gres_used.trim().length > 0
      ? raw.gres_used.trim()
      : null;
  const { base, flags } = splitNodeState(raw.state ?? null);

  return {
    name: raw.name,
    partitions: Array.isArray(raw.partitions) ? [...raw.partitions] : [],
    state: base,
    stateFlags: flags,
    cpus: requiredSlurmNumber(raw.cpus ?? null, 'cpus', raw.name, Math.floor),
    effectiveCpus: requiredSlurmNumber(raw.effective_cpus ?? null, 'effective_cpus', raw.name, Math.floor),
    allocCpus: requiredSlurmNumber(raw.alloc_cpus ?? null, 'alloc_cpus', raw.name, Math.floor),
    allocIdleCpus: normalizeCount(raw.alloc_idle_cpus ?? null),
    cpuLoad: normalizeCpuLoad(raw.cpu_load ?? null),
    totalMemoryMiB: requiredSlurmNumber(raw.real_memory ?? null, 'real_memory', raw.name, Math.round),
    allocMemoryMiB: requiredSlurmNumber(raw.alloc_memory ?? null, 'alloc_memory', raw.name, Math.round),
    freeMemoryMiB: normalizeFreeMemory(raw.free_mem ?? null),
    gresRaw: gres,
    gresUsedRaw: gresUsed,
    gpu: parseNodeGres(gres, gresUsed),
  };
}

// Throws on invalid JSON, schema mismatch, or a non-empty Slurm errors[].
function parseNodesStdout(parser: SupportedDataParser, stdout: string): ClusterNode[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new UpstreamInvalidError(
      `scontrol returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const result = nodeResponseSchemaFor(parser).safeParse(parsed);
  if (!result.success) {
    throw new UpstreamInvalidError(
      `scontrol response failed validation: ${summarizeZodIssues(result.error.issues)}`
    );
  }

  if (result.data.errors && result.data.errors.length > 0) {
    throw new SlurmUpstreamError(result.data.errors.map(describeNotice));
  }
  if (result.data.warnings && result.data.warnings.length > 0) {
    console.warn(
      `[Slurm] scontrol warnings: ${result.data.warnings.map(describeNotice).join('; ')}`
    );
  }

  return result.data.nodes.map(normalizeNode);
}

async function fetchNodes(
  context: SlurmContext,
  options: { signal?: AbortSignal } = {}
): Promise<ClusterNode[]> {
  const run: SlurmRunFn = context.run ?? runCommand;
  const { stdout } = await run('scontrol', [`--json=${context.parser}`, 'show', 'node'], {
    timeoutMs: NODES_COMMAND_TIMEOUT_MS,
    maxBufferBytes: NODES_COMMAND_MAX_BUFFER_BYTES,
    signal: options.signal,
  });
  return parseNodesStdout(context.parser, stdout);
}

export {
  NODES_COMMAND_MAX_BUFFER_BYTES,
  NODES_COMMAND_TIMEOUT_MS,
  fetchNodes,
  normalizeNode,
  parseNodesStdout,
};
