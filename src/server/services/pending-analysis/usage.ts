// Running-usage aggregation over the job snapshot. A null pick means the
// allocation is unknown, not zero. Only allocated resources count;
// requested resources are never substituted for unknown allocation.
import type { Job } from '../../models/job.js';
import type { AssociationEntry, AssociationStore } from '../../models/association.js';
import { descendantAssociationIds, resolveAssociation } from '../../models/association.js';
import type { QosStore } from '../../models/qos.js';

export type RunMinuteResource = 'cpu' | 'mem';

interface UsageOptions {
  jobs: readonly Job[];
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

function isRunning(job: Job): boolean {
  return job.state === 'RUNNING';
}

function descendantAccounts(account: string, descendants: ReadonlySet<string> | null): (candidate: string | null) => boolean {
  if (descendants === null) {
    return (candidate) => candidate === account;
  }
  return (candidate) => candidate !== null && (candidate === account || descendants.has(candidate));
}

function accumulate(
  jobs: readonly Job[],
  include: (job: Job) => boolean,
  pick: (job: Job) => number | null,
  unknownWhen?: (job: Job) => boolean
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
  pick: (job: Job) => number | null
): ScopeUsage {
  const matches = descendantAccounts(account, descendants);
  return accumulate(options.jobs, (job) => matches(job.account), pick);
}

function calculateAssociationUserUsage(
  account: string,
  user: string,
  descendants: ReadonlySet<string> | null,
  options: UsageOptions,
  pick: (job: Job) => number | null
): ScopeUsage {
  const matches = descendantAccounts(account, descendants);
  return accumulate(options.jobs, (job) => matches(job.account) && job.user === user, pick);
}

// QOS group: every RUNNING job with this QOS, regardless of account.
function calculateQosGroupUsage(
  qos: string,
  options: UsageOptions,
  pick: (job: Job) => number | null
): ScopeUsage {
  return accumulate(options.jobs, (job) => job.qos === qos, pick);
}

function calculateQosUserUsage(
  qos: string,
  user: string,
  options: UsageOptions,
  pick: (job: Job) => number | null
): ScopeUsage {
  return accumulate(options.jobs, (job) => job.qos === qos && job.user === user, pick);
}

// Entry-scoped usage by association identity. Each contributing job resolves
// to its own association; only IDs at or below the limiting entry count.
// Same-named associations under other scopes never merge, and a job whose
// association cannot be resolved makes usage unknown rather than falling
// back to account-name membership.
function resolveJobAssociationIds(
  store: AssociationStore,
  jobs: readonly Job[]
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
  pick: (job: Job) => number | null
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
  pick: (job: Job) => number | null
): ScopeUsage {
  const subtree = descendantAssociationIds(store, entry.id);
  const accounts = subtreeAccounts(store, subtree);
  const include = (job: Job): boolean =>
    job.user === user && classifyEntryJob(resolved, subtree, accounts, job) === 'in';
  const unknownWhen = (job: Job): boolean =>
    job.user === user && classifyEntryJob(resolved, subtree, accounts, job) === 'unknown';
  return accumulate(options.jobs, include, pick, unknownWhen);
}

// Accounts covered by a subtree. Unresolvable jobs under a covered account
// could belong; elsewhere they are provably out.
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
  job: Job
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

// Remaining committed runtime. Unknown start time means unknown remaining
// commitment.
function remainingSeconds(job: Job, now: Date): number | null {
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

// Per-job QOS UsageFactor, or null when unknown. A job with no Job QOS
// uses the neutral factor 1. Only the job's own QOS counts, never the
// partition QOS. A named QOS absent from the policy snapshot is unknown.
function usageFactorFor(qosStore: QosStore | null | undefined, job: Job): number | null {
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

// Run minutes: amount x remaining time x per-job-QOS UsageFactor.
// Unquantifiable contributors are counted, not folded into the total.
function sumRunMinutes(
  jobs: readonly Job[],
  now: Date,
  qosStore: QosStore | null | undefined,
  include: (job: Job) => boolean,
  amount: (job: Job) => number | null
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
  // Membership-unknown contributors are counted on top so the total is
  // never presented as exact without them.
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

// Allocated-only picks for running usage. Null means unknown allocation.
function allocatedCpus(job: Job): number | null {
  const value = job.allocated.cpus;
  return value === null || !Number.isFinite(value) || value < 0 ? null : value;
}

function allocatedMemoryMiB(job: Job): number | null {
  const value = job.allocated.memoryMiB;
  return value === null || !Number.isFinite(value) || value < 0 ? null : value;
}

function allocatedNodes(job: Job): number | null {
  const value = job.allocated.nodes;
  return value === null || !Number.isFinite(value) || value < 0 ? null : value;
}

function allocatedGpuTotal(job: Job): number | null {
  if (!job.allocated.gpuPresent) {
    return null;
  }
  const value = job.allocated.gpus.total;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function allocatedGpuType(type: string): (job: Job) => number | null {
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
