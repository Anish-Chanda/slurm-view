// Association policy fields used to evaluate hierarchy and TRES limits for
// pending jobs.

// Association ancestry follows ID/ParentID, not account names. Identity
// (account/user/partition) only resolves the starting association.
import { parseMemoryToMiB, parseTresString } from '../adapters/slurm/tres.js';
import { UpstreamInvalidError } from '../adapters/slurm/errors.js';

interface AssociationTres {
  cpu: number | null;
  memMiB: number | null;
  node: number | null;
  gres: Record<string, number>;
}

function emptyTres(): AssociationTres {
  return { cpu: null, memMiB: null, node: null, gres: {} };
}

interface AssociationEntry {
  // Own IDs are positive numeric strings; blank, root sentinels, and
  // malformed values are rejected at parse time.
  readonly id: string | null;
  readonly parentId: string | null;
  readonly account: string;
  readonly user: string | null;
  readonly partition: string | null;
  // Parent account name from ParentName, for display; traversal uses parentId.
  readonly parentAccount: string | null;
  // Retained if sacctmgr emits it; unused in single-cluster operation.
  readonly cluster: string | null;
  readonly grpTres: AssociationTres;
  readonly grpTresRunMins: AssociationTres;
  readonly grpJobs: number | null;
  readonly maxJobs: number | null;
}

interface AssociationStore {
  readonly entries: readonly AssociationEntry[];
  readonly byId: ReadonlyMap<string, AssociationEntry>;
  readonly byIdentity: ReadonlyMap<string, AssociationEntry>;
}

// An own ID must be a positive ID; blank, root sentinels, and malformed
// values are rejected. ParentID accepts the root/unset sentinels
// (blank, 0, -1): ParentID=0 is the root association.
function normalizeAssociationId(input: unknown): string {
  if (input === null || input === undefined) {
    throw new UpstreamInvalidError('sacctmgr association row is missing its ID');
  }
  const text = String(input).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw new UpstreamInvalidError(`sacctmgr association ID is malformed: ${JSON.stringify(input)}`);
  }
  return text;
}

function normalizeParentAssociationId(input: unknown): string | null {
  if (input === null || input === undefined) {
    return null;
  }
  const text = String(input).trim();
  if (text.length === 0 || text === '-1' || text === '0' || text.toUpperCase() === 'N/A') {
    return null;
  }
  if (!/^[1-9]\d*$/.test(text)) {
    throw new UpstreamInvalidError(`sacctmgr association ParentID is malformed: ${JSON.stringify(input)}`);
  }
  return text;
}

function normalizePositiveInt(input: unknown): number | null {
  if (input === null || input === undefined) {
    return null;
  }
  const text = String(input).trim();
  if (text.length === 0 || text === '-1' || text.toUpperCase() === 'N/A') {
    return null;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}

function toAssociationTres(parsed: ReturnType<typeof parseTresString>): AssociationTres {
  const gres: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed.gpus.byType)) {
    if (key === 'unknown') {
      gres['gpu'] = (gres['gpu'] ?? 0) + value;
    } else {
      gres[`gpu:${key}`] = (gres[`gpu:${key}`] ?? 0) + value;
    }
  }
  for (const [key, value] of Object.entries(parsed.other)) {
    const count = Number(String(value).trim());
    if (Number.isFinite(count) && count >= 0) {
      gres[key] = Math.floor(count);
    }
  }
  return {
    cpu: parsed.cpus,
    memMiB: parsed.memoryMiB,
    node: parsed.nodes,
    gres,
  };
}

function parseTresLimit(input: unknown): AssociationTres {
  if (input === null || input === undefined) {
    return emptyTres();
  }
  const text = String(input).trim();
  if (text.length === 0 || text.toUpperCase() === 'N/A') {
    return emptyTres();
  }
  return toAssociationTres(parseTresString(text));
}

// Policy TRES parsing is strict so malformed limits are not silently
// dropped. Supported keys: cpu, mem (K/M/G/T/P suffix), node, gres/gpu,
// gres/gpu:<type>, billing. Blank, -1, N/A, (null), UNLIMITED, INFINITE,
// and NONE mean no limit.
function parsePolicyTresLimit(input: unknown, label: string): AssociationTres {
  if (input === null || input === undefined) {
    return emptyTres();
  }
  const text = String(input).trim();
  if (text === '' || /^(-1|N\/A|\(null\)|UNLIMITED|INFINITE|NONE)$/i.test(text)) {
    return emptyTres();
  }
  const result = emptyTres();
  for (const part of text.split(',')) {
    const pair = part.trim();
    if (pair === '') {
      continue;
    }
    const separator = pair.indexOf('=');
    if (separator === -1) {
      throw new UpstreamInvalidError(`sacctmgr ${label} is malformed: ${JSON.stringify(input)}`);
    }
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key === 'cpu' || key === 'node') {
      if (!/^\d+$/.test(value)) {
        throw new UpstreamInvalidError(`sacctmgr ${label} is malformed: ${JSON.stringify(input)}`);
      }
      const count = Math.floor(Number(value));
      if (key === 'cpu') {
        result.cpu = count;
      } else {
        result.node = count;
      }
    } else if (key === 'mem') {
      if (!/^\d+(\.\d+)?\s*[KMGTP]?$/i.test(value)) {
        throw new UpstreamInvalidError(`sacctmgr ${label} is malformed: ${JSON.stringify(input)}`);
      }
      const memMiB = parseMemoryToMiB(value);
      if (memMiB === null) {
        throw new UpstreamInvalidError(`sacctmgr ${label} is malformed: ${JSON.stringify(input)}`);
      }
      result.memMiB = memMiB;
    } else if (key === 'billing') {
      // Validated but not stored: no analyzer evaluates billing.
      if (!/^\d+$/.test(value)) {
        throw new UpstreamInvalidError(`sacctmgr ${label} is malformed: ${JSON.stringify(input)}`);
      }
    } else if (key === 'gres/gpu' || key.startsWith('gres/gpu:')) {
      if (!/^\d+$/.test(value)) {
        throw new UpstreamInvalidError(`sacctmgr ${label} is malformed: ${JSON.stringify(input)}`);
      }
      const type = key === 'gres/gpu' ? 'gpu' : key.slice('gres/'.length);
      result.gres[type] = Math.floor(Number(value));
    } else if (/^[A-Za-z0-9_][A-Za-z0-9_/:.-]*$/.test(key) && /^\d+$/.test(value)) {
      // Site-defined TRES: validated, not stored.
    } else {
      throw new UpstreamInvalidError(`sacctmgr ${label} is malformed: ${JSON.stringify(input)}`);
    }
  }
  return result;
}

// The identity key contains account, user, and partition. JSON encoding keeps
// null distinct from every string value.
function identityKey(account: string, user: string | null, partition: string | null): string {
  return JSON.stringify([account, user, partition]);
}

function buildAssociationStore(entries: AssociationEntry[]): AssociationStore {
  const byId = new Map<string, AssociationEntry>();
  const byIdentity = new Map<string, AssociationEntry>();
  for (const entry of entries) {
    if (entry.id !== null) {
      if (byId.has(entry.id)) {
        throw new UpstreamInvalidError(
          `sacctmgr returned duplicate association ID: ${entry.id}`
        );
      }
      byId.set(entry.id, entry);
    }
    // Duplicate association identities make policy resolution ambiguous.
    const key = identityKey(entry.account, entry.user, entry.partition);
    if (byIdentity.has(key)) {
      throw new UpstreamInvalidError(
        `sacctmgr returned duplicate association identity: ${key}`
      );
    }
    byIdentity.set(key, entry);
  }
  return { entries: [...entries], byId, byIdentity };
}

// Resolve by identity, checking a partition-specific user entry before the
// generic user entry. A known user does not fall back to an account entry;
// account entries apply only when the user is unknown.
function resolveAssociation(
  store: AssociationStore,
  selector: { account: string; user: string | null; partition: string | null }
): AssociationEntry | null {
  const account = selector.account;
  const user = selector.user;
  const partition = selector.partition;
  const lookup = (u: string | null, p: string | null): AssociationEntry | null =>
    store.byIdentity.get(identityKey(account, u, p)) ?? null;
  if (user !== null) {
    return lookup(user, partition) ?? lookup(user, null);
  }
  if (partition !== null) {
    return lookup(null, partition) ?? lookup(null, null);
  }
  return lookup(null, null);
}

// Return this entry and its descendants by following ParentID links.
function descendantAssociationIds(store: AssociationStore, rootId: string | null): Set<string> | null {
  if (rootId === null) {
    return null;
  }
  const childrenByParent = new Map<string, AssociationEntry[]>();
  for (const entry of store.entries) {
    if (entry.parentId === null || entry.id === null) {
      continue;
    }
    const list = childrenByParent.get(entry.parentId) ?? [];
    list.push(entry);
    childrenByParent.set(entry.parentId, list);
  }
  const ids = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  const visited = new Set<string>([rootId]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const child of childrenByParent.get(current) ?? []) {
      const childId = child.id as string;
      ids.add(childId);
      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push(childId);
      }
    }
  }
  return ids;
}

// Follow ParentID links from the starting entry to the root. A missing
// parent, cycle, or depth overflow is an error rather than a partial chain.
function ancestorChainById(
  store: AssociationStore,
  start: AssociationEntry,
  maxDepth = 20
): AssociationEntry[] {
  const chain: AssociationEntry[] = [start];
  const seen = new Set<string>();
  if (start.id !== null) {
    seen.add(start.id);
  }
  let current: AssociationEntry | null = start;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const currentEntry: AssociationEntry | null = current;
    const parentId: string | null = currentEntry === null ? null : currentEntry.parentId;
    if (parentId === null) {
      return chain;
    }
    if (seen.has(parentId)) {
      throw new UpstreamInvalidError(
        `sacctmgr association hierarchy contains a cycle at ID: ${parentId}`
      );
    }
    const parent: AssociationEntry | null = store.byId.get(parentId) ?? null;
    if (parent === null) {
      throw new UpstreamInvalidError(
        `sacctmgr association hierarchy is missing parent ID: ${parentId}`
      );
    }
    chain.push(parent);
    seen.add(parentId);
    current = parent;
  }
  throw new UpstreamInvalidError(
    'sacctmgr association hierarchy exceeds the supported depth'
  );
}

// LimitFactor scales association [Grp|Max]TRES counts (cpu, mem, node,
// gres/*). QOS-own limits, job counts, wall time, and TRES-minutes pass
// through unscaled.
function appliesLimitFactor(metric: 'tres' | 'other'): boolean {
  return metric === 'tres';
}

function applyLimitFactor(rawLimit: number | null, limitFactor: number | null): number | null {
  if (rawLimit === null || limitFactor === null) {
    return rawLimit;
  }
  if (!Number.isFinite(rawLimit) || !Number.isFinite(limitFactor)) {
    return rawLimit;
  }
  if (rawLimit < 0 || limitFactor <= 0) {
    return rawLimit;
  }
  return rawLimit * limitFactor;
}

export {
  ancestorChainById,
  appliesLimitFactor,
  applyLimitFactor,
  buildAssociationStore,
  descendantAssociationIds,
  emptyTres,
  normalizeAssociationId,
  normalizeParentAssociationId,
  normalizePositiveInt,
  parsePolicyTresLimit,
  parseTresLimit,
  resolveAssociation,
  toAssociationTres,
};
export type { AssociationEntry, AssociationStore, AssociationTres };
