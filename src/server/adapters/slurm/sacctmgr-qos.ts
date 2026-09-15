// sacctmgr QOS adapter for pending analysis: group/max limits, factors,
// flags, and Relative marking. Pipe-delimited output; no JSON.
import { runCommand } from './command-runner.js';
import type { SlurmContext, SlurmRunFn } from './context.js';
import { UpstreamInvalidError } from './errors.js';
import type { QosEntry, QosStore } from '../../models/qos.js';
import { buildQosStore } from '../../models/qos.js';
import { emptyTres, parsePolicyTresLimit } from '../../models/association.js';
import type { AssociationTres } from '../../models/association.js';

const QOS_COMMAND_TIMEOUT_MS = 30_000;
const QOS_COMMAND_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

// Legacy GrpCPUs/GrpMem/GrpNodes columns are requested for older
// accounting databases; canonical GrpTRES wins on conflict.
const QOS_FORMAT =
  'Name,Priority,GrpCPUs,GrpMem,GrpNodes,GrpJobs,GrpTRES,GrpTRESRunMins,MaxTRESPU,MaxJobsPU,LimitFactor,UsageFactor,Flags';

function cleanField(input: string | null | undefined): string | null {
  if (input === undefined || input === null) {
    return null;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseFlags(input: string | null): Set<string> {
  if (input === null) {
    return new Set();
  }
  return new Set(
    input
      .split(',')
      .map((flag) => flag.trim())
      .filter((flag) => flag.length > 0)
  );
}

function isUnsetToken(text: string): boolean {
  return text === '' || text === '-1' || /^(N\/A|\(null\)|UNLIMITED|INFINITE|NONE)$/i.test(text);
}

function strictCount(raw: string | undefined, label: string): number | null {
  const text = (raw ?? '').trim();
  if (isUnsetToken(text)) {
    return null;
  }
  if (!/^\d+$/.test(text)) {
    throw new UpstreamInvalidError(`sacctmgr QOS ${label} is malformed: ${JSON.stringify(raw)}`);
  }
  return Math.floor(Number(text));
}

function strictTres(raw: string | undefined, label: string): AssociationTres {
  return parsePolicyTresLimit(raw ?? null, label);
}

// LimitFactor scales association TRES limits. Blank and the -1 clear value
// mean no factoring; other non-numeric values are malformed policy. Zero is
// preserved as configured and ignored when scaling, as in Slurm.
function strictLimitFactor(raw: string | undefined): number | null {
  const text = (raw ?? '').trim();
  if (text === '' || text === '-1' || /^(N\/A|\(null\)|NONE)$/i.test(text)) {
    return null;
  }
  if (!/^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) {
    throw new UpstreamInvalidError(`sacctmgr QOS LimitFactor is malformed: ${JSON.stringify(raw)}`);
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new UpstreamInvalidError(`sacctmgr QOS LimitFactor is malformed: ${JSON.stringify(raw)}`);
  }
  return parsed;
}

// UsageFactor scales TRES-minutes usage. Unset (blank, -1, N/A, (null),
// NONE) means Slurm's default of 1; other non-numeric values are malformed
// policy. Zero is a valid configured value.
function strictUsageFactor(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  if (text === '' || text === '-1' || /^(N\/A|\(null\)|NONE)$/i.test(text)) {
    return 1;
  }
  if (!/^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) {
    throw new UpstreamInvalidError(`sacctmgr QOS UsageFactor is malformed: ${JSON.stringify(raw)}`);
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new UpstreamInvalidError(`sacctmgr QOS UsageFactor is malformed: ${JSON.stringify(raw)}`);
  }
  return parsed;
}

// Prefer GrpTRES. Legacy GrpCPU/GrpMem/GrpNodes fill missing values only.
function mergeLegacyTres(
  canonical: AssociationTres,
  legacyCpu: string | null,
  legacyMem: string | null,
  legacyNodes: string | null
): AssociationTres {
  const merged: AssociationTres = {
    cpu: canonical.cpu,
    memMiB: canonical.memMiB,
    node: canonical.node,
    gres: { ...canonical.gres },
  };
  if (merged.cpu === null) {
    merged.cpu = strictCount(legacyCpu ?? undefined, 'GrpCPUs');
  }
  if (merged.node === null) {
    merged.node = strictCount(legacyNodes ?? undefined, 'GrpNodes');
  }
  if (merged.memMiB === null && legacyMem !== null && legacyMem.trim() !== '') {
    const wrapped = strictTres(`mem=${legacyMem}`, 'GrpMem');
    if (wrapped.memMiB !== null) {
      merged.memMiB = wrapped.memMiB;
    }
  }
  return merged;
}

function parseQosLine(line: string): QosEntry | null {
  // Name|Priority|GrpCPUs|GrpMem|GrpNodes|GrpJobs|GrpTRES|GrpTRESRunMins|MaxTRESPU|MaxJobsPU|LimitFactor|UsageFactor|Flags
  const parts = line.split('|');
  if (parts.length < 13) {
    throw new UpstreamInvalidError(
      `sacctmgr QOS row has ${parts.length} columns, expected at least 13`
    );
  }
  const [
    nameRaw,
    priorityRaw,
    grpCpusRaw,
    grpMemRaw,
    grpNodesRaw,
    grpJobsRaw,
    grpTresRaw,
    grpRunMinsRaw,
    maxTresPuRaw,
    maxJobsPuRaw,
    limitFactorRaw,
    usageFactorRaw,
    flagsRaw,
  ] = parts;
  const name = cleanField(nameRaw);
  if (name === null) {
    throw new UpstreamInvalidError('sacctmgr QOS row is missing its name');
  }
  const flags = parseFlags(cleanField(flagsRaw ?? null));
  const relative = flags.has('Relative');
  const grpTres = mergeLegacyTres(
    strictTres(grpTresRaw, 'GrpTRES'),
    grpCpusRaw?.trim() ?? null,
    grpMemRaw?.trim() ?? null,
    grpNodesRaw?.trim() ?? null
  );
  const maxTresPerUser = strictTres(maxTresPuRaw, 'MaxTRESPU');
  return {
    name,
    priority: strictCount(priorityRaw, 'Priority') ?? 0,
    flags,
    relative,
    grpTres,
    grpTresRunMins: strictTres(grpRunMinsRaw, 'GrpTRESRunMins'),
    grpJobs: strictCount(grpJobsRaw, 'GrpJobs'),
    grpNodes: grpTres.node,
    maxTresPerUser: {
      cpu: maxTresPerUser.cpu,
      memMiB: maxTresPerUser.memMiB,
      node: maxTresPerUser.node,
      gres: { ...maxTresPerUser.gres },
    },
    maxJobsPerUser: strictCount(maxJobsPuRaw, 'MaxJobsPU'),
    limitFactor: strictLimitFactor(limitFactorRaw),
    usageFactor: strictUsageFactor(usageFactorRaw),
    usageFactorSafe: flags.has('UsageFactorSafe'),
  };
}

function parseQosStdout(stdout: string): QosEntry[] {
  const entries: QosEntry[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    if (line.toUpperCase().startsWith('NAME|')) {
      continue;
    }
    const entry = parseQosLine(line);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

function emptyTresForFallback(): AssociationTres {
  return emptyTres();
}

interface QosSnapshot {
  readonly store: QosStore;
  readonly capturedAt: Date;
}

async function fetchQosSnapshot(
  context: SlurmContext,
  options: { signal?: AbortSignal } = {}
): Promise<QosSnapshot> {
  const run: SlurmRunFn = context.run ?? runCommand;
  const { stdout } = await run(
    'sacctmgr',
    ['-n', '-P', 'show', 'qos', `format=${QOS_FORMAT}`],
    {
      timeoutMs: QOS_COMMAND_TIMEOUT_MS,
      maxBufferBytes: QOS_COMMAND_MAX_BUFFER_BYTES,
      signal: options.signal,
    }
  );
  return { store: buildQosStore(parseQosStdout(stdout)), capturedAt: new Date() };
}

export {
  QOS_COMMAND_MAX_BUFFER_BYTES,
  QOS_COMMAND_TIMEOUT_MS,
  QOS_FORMAT,
  emptyTresForFallback,
  fetchQosSnapshot,
  parseQosLine,
  parseQosStdout,
};
export type { QosSnapshot };
