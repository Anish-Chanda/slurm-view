// sacctmgr association adapter for pending analysis: ID/ParentID hierarchy
// plus TRES/job-count limits. Pipe-delimited output; no JSON. The Cluster
// column is retained but unused.
import { runCommand } from './command-runner.js';
import type { SlurmContext, SlurmRunFn } from './context.js';
import { UpstreamInvalidError } from './errors.js';
import { fetchLocalClusterName } from './cluster-name.js';
import type { AssociationEntry, AssociationStore, AssociationTres } from '../../models/association.js';
import {
  buildAssociationStore,
  normalizeAssociationId,
  normalizeParentAssociationId,
  parsePolicyTresLimit,
} from '../../models/association.js';

const ASSOC_COMMAND_TIMEOUT_MS = 30_000;
const ASSOC_COMMAND_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

const ASSOC_FORMAT =
  'ID,ParentID,Cluster,Account,User,Partition,ParentName,GrpTRES,GrpTRESRunMins,GrpJobs,MaxJobs';

function cleanField(input: string | null | undefined): string | null {
  if (input === undefined || input === null) {
    return null;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUnsetToken(text: string): boolean {
  return text === '' || text === '-1' || /^(N\/A|\(null\)|UNLIMITED|INFINITE|NONE)$/i.test(text);
}

// Malformed policy rows fail the snapshot; a skipped row could be the
// limiting policy. Blank and header rows are ignored.
function strictCount(raw: string | undefined, label: string): number | null {
  const text = (raw ?? '').trim();
  if (isUnsetToken(text)) {
    return null;
  }
  if (!/^\d+$/.test(text)) {
    throw new UpstreamInvalidError(`sacctmgr association ${label} is malformed: ${JSON.stringify(raw)}`);
  }
  return Math.floor(Number(text));
}

function strictTres(raw: string | undefined, label: string): AssociationTres {
  return parsePolicyTresLimit(raw ?? null, label);
}

function parseAssocLine(line: string): AssociationEntry | null {
  // ID|ParentID|Cluster|Account|User|Partition|ParentName|GrpTRES|GrpTRESRunMins|GrpJobs|MaxJobs
  const parts = line.split('|');
  if (parts.length < 11) {
    throw new UpstreamInvalidError(
      `sacctmgr association row has ${parts.length} columns, expected at least 11`
    );
  }
  const [idRaw, parentIdRaw, clusterRaw, accountRaw, userRaw, partitionRaw, parentNameRaw, grpTresRaw, grpRunMinsRaw, grpJobsRaw, maxJobsRaw] = parts;
  const account = cleanField(accountRaw);
  if (account === null) {
    throw new UpstreamInvalidError('sacctmgr association row is missing its account');
  }
  const user = cleanField(userRaw);
  const partition = cleanField(partitionRaw);
  const parentAccount = cleanField(parentNameRaw);
  const cluster = cleanField(clusterRaw);
  return {
    id: normalizeAssociationId(idRaw),
    parentId: normalizeParentAssociationId(parentIdRaw),
    account,
    user,
    partition,
    parentAccount,
    cluster,
    grpTres: strictTres(grpTresRaw, 'GrpTRES'),
    grpTresRunMins: strictTres(grpRunMinsRaw, 'GrpTRESRunMins'),
    grpJobs: strictCount(grpJobsRaw, 'GrpJobs'),
    maxJobs: strictCount(maxJobsRaw, 'MaxJobs'),
  };
}

function parseAssocStdout(stdout: string): AssociationEntry[] {
  const entries: AssociationEntry[] = [];
  const lines = stdout.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    // sacctmgr -p emits a header line starting with ID| or Cluster|.
    const upper = line.toUpperCase();
    if (upper.startsWith('ID|') || upper.startsWith('CLUSTER|')) {
      continue;
    }
    const entry = parseAssocLine(line);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

interface AssocSnapshot {
  readonly store: AssociationStore;
  readonly capturedAt: Date;
}

async function fetchAssocSnapshot(
  context: SlurmContext,
  options: { signal?: AbortSignal } = {}
): Promise<AssocSnapshot> {
  const run: SlurmRunFn = context.run ?? runCommand;
  // Rows are always scoped to the local cluster; a failed ClusterName
  // lookup propagates instead of querying all clusters.
  const cluster = await fetchLocalClusterName(context, { signal: options.signal });
  const { stdout } = await run(
    'sacctmgr',
    ['list', 'assoc', `Cluster=${cluster}`, `format=${ASSOC_FORMAT}`, '-p'],
    {
      timeoutMs: ASSOC_COMMAND_TIMEOUT_MS,
      maxBufferBytes: ASSOC_COMMAND_MAX_BUFFER_BYTES,
      signal: options.signal,
    }
  );
  return { store: buildAssociationStore(parseAssocStdout(stdout)), capturedAt: new Date() };
}

export {
  ASSOC_COMMAND_MAX_BUFFER_BYTES,
  ASSOC_COMMAND_TIMEOUT_MS,
  ASSOC_FORMAT,
  fetchAssocSnapshot,
  parseAssocLine,
  parseAssocStdout,
};
export type { AssocSnapshot };
