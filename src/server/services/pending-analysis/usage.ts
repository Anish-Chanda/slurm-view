// Aggregate running usage from the job snapshot. A null resource value means
// the allocation is unknown. Count allocated resources only; requests do not
// replace missing allocation data.
import type { QueueJob } from '../../models/queue-job.js';
import type { AssociationEntry, AssociationStore } from '../../models/association.js';
import { descendantAssociationIds, resolveAssociation } from '../../models/association.js';
import type { QosStore } from '../../models/qos.js';

export type RunMinuteResource = 'cpu' | 'mem';

interface UsageOptions {
  jobs: readonly QueueJob[];
  now?: Date;
}

interface ScopeUsage {
  total: number;
  runningJobs: number;
  // In-scope contributors whose share could not be quantified.
  unknown: number;
}

interface RunMinutesOptions extends UsageOptions {
  qosStore?: QosStore | null;
}

interface RunMinutesSum {
  total: number;
  unknown: number;
  runningJobs: number;
  topConsumers: Array<{ jobId: string; user: string | null; account: string | null; value: number }>;
}

function isRunning(job: QueueJob): boolean {
  return job.state === 'RUNNING';
}

function descendantAccounts(account: string, descendants: ReadonlySet<string> | null): (candidate: string | null) => boolean {
  if (descendants === null) {
    return (candidate) => candidate === account;
  }
  return (candidate) => candidate !== null && (candidate === account || descendants.has(candidate));
}

function accumulate(
  jobs: readonly QueueJob[],
  include: (job: QueueJob) => boolean,
  pick: (job: QueueJob) => number | null,
  unknownWhen?: (job: QueueJob) => boolean
): ScopeUsage {
  let total = 0;
  let runningJobs = 0;
  let unknown = 0;
  for (const job of jobs) {
    if (!isRunning(job)) {
      continue;
    }
    if (unknownWhen !== undefined && unknownWhen(job)) {
      runningJobs += 1;
      unknown += 1;
      continue;
    }
    if (!include(job)) {
      continue;
    }
    runningJobs += 1;
    const value = pick(job);
    if (value === null || !Number.isFinite(value)) {
      unknown += 1;
    } else {
      total += value;
    }
  }
  return { total, runningJobs, unknown };
}

function calculateAssociationGroupUsage(
  account: string,
  descendants: ReadonlySet<string> | null,
  options: UsageOptions,
  pick: (job: QueueJob) => number | null
): ScopeUsage {
  const matches = descendantAccounts(account, descendants);
  return accumulate(options.jobs, (job) => matches(job.account), pick);
}

function calculateAssociationUserUsage(
  account: string,
  user: string,
  descendants: ReadonlySet<string> | null,
  options: UsageOptions,
  pick: (job: QueueJob) => number | null
): ScopeUsage {
  const matches = descendantAccounts(account, descendants);
  return accumulate(options.jobs, (job) => matches(job.account) && job.user === user, pick);
}

// A QOS group includes every RUNNING job with that QOS, regardless of account.
function calculateQosGroupUsage(
  qos: string,
  options: UsageOptions,
  pick: (job: QueueJob) => number | null
): ScopeUsage {
  return accumulate(options.jobs, (job) => job.qos === qos, pick);
}

function calculateQosUserUsage(
  qos: string,
  user: string,
  options: UsageOptions,
  pick: (job: QueueJob) => number | null
): ScopeUsage {
  return accumulate(options.jobs, (job) => job.qos === qos && job.user === user, pick);
}

// Attribute each job to its resolved association and count entries in the
// limiting scope. If resolution fails, usage is unknown; account names do
// not provide a fallback.
function resolveJobAssociationIds(
  store: AssociationStore,
  jobs: readonly QueueJob[]
): Map<string, string | null> {
  const resolved = new Map<string, string | null>();
  for (const job of jobs) {
    if (job.account === null) {
      resolved.set(job.id, null);
      continue;
    }
    const entry = resolveAssociation(store, {
      account: job.account,
      user: job.user,
      partition: job.partition,
    });
    resolved.set(job.id, entry?.id ?? null);
  }
  return resolved;
}

function calculateAssociationEntryGroupUsage(
  entry: AssociationEntry,
  store: AssociationStore,
  resolved: Map<string, string | null>,
  options: UsageOptions,
  pick: (job: QueueJob) => number | null
): ScopeUsage {
  const subtree = descendantAssociationIds(store, entry.id);
  const accounts = subtreeAccounts(store, subtree);
  return accumulate(
    options.jobs,
    (job) => classifyEntryJob(resolved, subtree, accounts, job) === 'in',
    pick,
    (job) => classifyEntryJob(resolved, subtree, accounts, job) === 'unknown'
  );
}

function calculateAssociationEntryUserUsage(
  entry: AssociationEntry,
  store: AssociationStore,
  user: string,
  resolved: Map<string, string | null>,
  options: UsageOptions,
  pick: (job: QueueJob) => number | null
): ScopeUsage {
  const subtree = descendantAssociationIds(store, entry.id);
  const accounts = subtreeAccounts(store, subtree);
  const include = (job: QueueJob): boolean =>
    job.user === user && classifyEntryJob(resolved, subtree, accounts, job) === 'in';
  const unknownWhen = (job: QueueJob): boolean =>
    job.user === user && classifyEntryJob(resolved, subtree, accounts, job) === 'unknown';
  return accumulate(options.jobs, include, pick, unknownWhen);
}

// Find accounts covered by a subtree. An unresolvable job under a covered
// account may belong to it; jobs elsewhere are outside the subtree.
function subtreeAccounts(store: AssociationStore, subtree: Set<string> | null): Set<string> | null {
  if (subtree === null) {
    return null;
  }
  const accounts = new Set<string>();
  for (const id of subtree) {
    const entry = store.byId.get(id);
    if (entry !== undefined) {
      accounts.add(entry.account);
    }
  }
  return accounts;
}

function classifyEntryJob(
  resolved: Map<string, string | null>,
  subtree: Set<string> | null,
  accounts: Set<string> | null,
  job: QueueJob
): 'in' | 'out' | 'unknown' {
  const id = resolved.get(job.id) ?? null;
  if (id !== null) {
    if (subtree === null) {
      return 'unknown';
    }
    return subtree.has(id) ? 'in' : 'out';
  }
  // Unresolvable jobs count as possibly in scope only under a covered
  // account; otherwise they are provably out.
  if (accounts === null || job.account === null) {
    return accounts === null ? 'unknown' : 'out';
  }
  return accounts.has(job.account) ? 'unknown' : 'out';
}

// Return the remaining committed runtime. Without a start time, the
// remaining commitment is unknown.
function remainingSeconds(job: QueueJob, now: Date): number | null {
  if (job.timeLimit === null || job.timeLimit.kind === 'infinite') {
    return null;
  }
  const limitSeconds = job.timeLimit.seconds;
  if (!Number.isFinite(limitSeconds) || limitSeconds <= 0) {
    return null;
  }
  if (job.startTime === null || Number.isNaN(job.startTime.getTime())) {
    return null;
  }
  const elapsed = Math.floor((now.getTime() - job.startTime.getTime()) / 1000);
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return null;
  }
  return Math.max(0, limitSeconds - elapsed);
}

// Return the job's QOS UsageFactor, or null when it is unknown. Jobs without
// a Job QOS use the neutral factor 1. The partition QOS does not apply here;
// a named QOS missing from the policy snapshot is unknown.
function usageFactorFor(qosStore: QosStore | null | undefined, job: QueueJob): number | null {
  if (job.qos === null) {
    return 1;
  }
  if (qosStore === undefined || qosStore === null) {
    return null;
  }
  const entry = qosStore.byName.get(job.qos);
  if (entry === undefined) {
    return null;
  }
  const factor = entry.usageFactor;
  if (!Number.isFinite(factor) || factor < 0) {
    return null;
  }
  return factor;
}

// Run minutes equal amount times remaining time times the job's QOS
// UsageFactor. Count contributors with unknown amounts separately.
function sumRunMinutes(
  jobs: readonly QueueJob[],
  now: Date,
  qosStore: QosStore | null | undefined,
  include: (job: QueueJob) => boolean,
  amount: (job: QueueJob) => number | null
): RunMinutesSum {
  let total = 0;
  let unknown = 0;
  let runningJobs = 0;
  const consumers: Array<{ jobId: string; user: string | null; account: string | null; value: number }> = [];
  for (const job of jobs) {
    if (!isRunning(job) || !include(job)) {
      continue;
    }
    runningJobs += 1;
    const each = amount(job);
    const remaining = remainingSeconds(job, now);
    const factor = usageFactorFor(qosStore, job);
    if (each === null || remaining === null || factor === null) {
      unknown += 1;
      continue;
    }
    const contribution = each * (remaining / 60) * factor;
    if (!Number.isFinite(contribution) || contribution < 0) {
      unknown += 1;
      continue;
    }
    total += contribution;
    if (contribution > 0) {
      consumers.push({ jobId: job.id, user: job.user, account: job.account, value: contribution });
    }
  }
  consumers.sort((a, b) => b.value - a.value);
  return { total, unknown, runningJobs, topConsumers: consumers.slice(0, 10) };
}

function calculateAssociationGroupRunMinutes(
  account: string,
  descendants: ReadonlySet<string> | null,
  resource: RunMinuteResource,
  options: RunMinutesOptions
): RunMinutesSum {
  const now = options.now ?? new Date();
  const matches = descendantAccounts(account, descendants);
  return sumRunMinutes(
    options.jobs,
    now,
    options.qosStore ?? null,
    (job) => matches(job.account),
    (job) =>
      resource === 'cpu' ? allocatedCpus(job) : allocatedMemoryMiB(job)
  );
}

function calculateAssociationEntryGroupRunMinutes(
  entry: AssociationEntry,
  store: AssociationStore,
  resolved: Map<string, string | null>,
  resource: RunMinuteResource,
  options: RunMinutesOptions
): RunMinutesSum {
  const now = options.now ?? new Date();
  const subtree = descendantAssociationIds(store, entry.id);
  const accounts = subtreeAccounts(store, subtree);
  const sum = sumRunMinutes(
    options.jobs,
    now,
    options.qosStore ?? null,
    (job) => classifyEntryJob(resolved, subtree, accounts, job) === 'in',
    (job) =>
      resource === 'cpu' ? allocatedCpus(job) : allocatedMemoryMiB(job)
  );
  // Include contributors with unknown membership in the count so the total
  // is not presented as exact.
  let membershipUnknown = 0;
  for (const job of options.jobs) {
    if (isRunning(job) && classifyEntryJob(resolved, subtree, accounts, job) === 'unknown') {
      membershipUnknown += 1;
    }
  }
  return { ...sum, unknown: sum.unknown + membershipUnknown, runningJobs: sum.runningJobs + membershipUnknown };
}

function calculateQosGroupRunMinutes(
  qos: string,
  resource: RunMinuteResource,
  options: RunMinutesOptions
): RunMinutesSum {
  const now = options.now ?? new Date();
  return sumRunMinutes(
    options.jobs,
    now,
    options.qosStore ?? null,
    (job) => job.qos === qos,
    (job) =>
      resource === 'cpu' ? allocatedCpus(job) : allocatedMemoryMiB(job)
  );
}

// These picks use allocated resources only. Null means the allocation is unknown.
function allocatedCpus(job: QueueJob): number | null {
  const value = job.allocated.cpus;
  return value === null || !Number.isFinite(value) || value < 0 ? null : value;
}

function allocatedMemoryMiB(job: QueueJob): number | null {
  const value = job.allocated.memoryMiB;
  return value === null || !Number.isFinite(value) || value < 0 ? null : value;
}

function allocatedNodes(job: QueueJob): number | null {
  const value = job.allocated.nodes;
  return value === null || !Number.isFinite(value) || value < 0 ? null : value;
}

function allocatedGpuTotal(job: QueueJob): number | null {
  if (!job.allocated.gpuPresent) {
    return null;
  }
  const value = job.allocated.gpus.total;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function allocatedGpuType(type: string): (job: QueueJob) => number | null {
  return (job) => {
    if (!job.allocated.gpuPresent) {
      return null;
    }
    const value = job.allocated.gpus.byType[type] ?? 0;
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
}

export {
  allocatedCpus,
  allocatedGpuTotal,
  allocatedGpuType,
  allocatedMemoryMiB,
  allocatedNodes,
  calculateAssociationEntryGroupRunMinutes,
  calculateAssociationEntryGroupUsage,
  calculateAssociationEntryUserUsage,
  calculateAssociationGroupRunMinutes,
  calculateAssociationGroupUsage,
  calculateAssociationUserUsage,
  calculateQosGroupRunMinutes,
  calculateQosGroupUsage,
  calculateQosUserUsage,
  remainingSeconds,
  resolveJobAssociationIds,
  sumRunMinutes,
  usageFactorFor,
};
export type { RunMinutesOptions, RunMinutesSum, ScopeUsage, UsageOptions };
