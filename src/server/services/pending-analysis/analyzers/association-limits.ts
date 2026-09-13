// Association limit analyzers (AssocGrp*/AssocMaxJobsLimit). Usage is
// scoped by the limiting association, never by bare account name.
import type { AnalyzerContext } from '../types.js';
import type { LimitAnalysisDto, LimitMetric } from '../../../../shared/api/v1/pending-analysis.js';
import type { AssociationEntry } from '../../../models/association.js';
import { ancestorChainById, descendantAssociationIds, resolveAssociation } from '../../../models/association.js';
import {
  effectiveAssocTresLimit,
  resolveJobAndPartitionQos,
} from '../policy.js';
import {
  allocatedCpus,
  allocatedGpuTotal,
  allocatedGpuType,
  allocatedMemoryMiB,
  calculateAssociationEntryGroupRunMinutes,
  calculateAssociationEntryGroupUsage,
  calculateAssociationEntryUserUsage,
  resolveJobAssociationIds,
} from '../usage.js';
import {
  TOP_CONSUMERS_CAP,
  aggregateMemoryRequest,
  requestedGpuType,
} from './limit-helpers.js';

type AssocKind =
  | 'AssocGrpMemLimit'
  | 'AssocGrpCpuLimit'
  | 'AssocGrpGRES'
  | 'AssocMaxJobsLimit'
  | 'AssocGrpMemRunMinutes'
  | 'AssocGrpCPURunMinutesLimit';

const ASSOC_REASONS: ReadonlySet<string> = new Set([
  'AssocGrpMemLimit',
  'AssocGrpCpuLimit',
  'AssocGrpGRES',
  'AssocMaxJobsLimit',
  'AssocGrpMemRunMinutes',
  'AssocGrpCPURunMinutesLimit',
]);

function isAssocReason(reason: string | null): reason is AssocKind {
  return reason !== null && ASSOC_REASONS.has(reason);
}

interface LevelMeasurement {
  entry: AssociationEntry;
  effectiveLimit: number | null;
  // Exact total, or null when a contributor is unquantifiable. knownUsed
  // is the quantified lower bound.
  used: number | null;
  knownUsed: number;
  runningJobs: number;
}

function buildHierarchy(levels: LevelMeasurement[], limiting: AssociationEntry | null): LimitAnalysisDto['hierarchy'] {
  return levels.map((level) => ({
    account: level.entry.account,
    parent: level.entry.parentAccount,
    limit: level.effectiveLimit,
    used: level.used,
    limiting: limiting !== null && level.entry === limiting,
  }));
}

// The winner is the first proven level from the user association toward
// the root, matching Slurm's bottom-up enforcement order.
function selectProvenLimiting(
  levels: LevelMeasurement[],
  requested: number
): { limiting: AssociationEntry | null; fellShort: boolean } {
  for (const level of levels) {
    if (level.knownUsed + requested > (level.effectiveLimit ?? 0)) {
      return { limiting: level.entry, fellShort: false };
    }
  }
  const unknown = levels.some((level) => level.used === null);
  return { limiting: null, fellShort: unknown };
}

function tightestKnownLevel(levels: LevelMeasurement[], requested: number): LevelMeasurement {
  let best = levels[0]!;
  let bestHeadroom = Number.POSITIVE_INFINITY;
  for (const level of levels) {
    if (level.used === null) {
      continue;
    }
    const headroom = (level.effectiveLimit ?? 0) - (level.used + requested);
    if (headroom < bestHeadroom) {
      bestHeadroom = headroom;
      best = level;
    }
  }
  return best;
}

async function analyzeAssocLimits(ctx: AnalyzerContext): Promise<LimitAnalysisDto | null> {
  const reason = ctx.targeted.job.stateReason;
  if (!isAssocReason(reason) || ctx.assoc === null) {
    return null;
  }
  const job = ctx.targeted.job;
  if (job.account === null) {
    return null;
  }
  const assocStore = ctx.assoc.store;
  const start = resolveAssociation(assocStore, {
    account: job.account,
    user: job.user,
    partition: job.partition,
  });
  if (start === null) {
    return null;
  }
  const chain = ancestorChainById(assocStore, start);
  const jobQosEntry = resolveJobAndPartitionQos(
    ctx.qos?.store ?? null,
    job.qos,
    ctx.partitionDetail
  ).job?.entry ?? null;
  const limitFactor = jobQosEntry?.limitFactor ?? null;
  const jobs = ctx.jobsSnapshot.jobs;
  const account = job.account;
  const resolved = resolveJobAssociationIds(assocStore, jobs);

  switch (reason) {
    case 'AssocGrpMemLimit':
    case 'AssocGrpCpuLimit': {
      const isMem = reason === 'AssocGrpMemLimit';
      const metric: LimitMetric = isMem ? 'memoryMiB' : 'cpus';
      const requested = isMem ? aggregateMemoryRequest(ctx) : job.requested.cpus;
      if (requested === null) {
        return null;
      }
      const levels: LevelMeasurement[] = [];
      for (const entry of chain) {
        const raw = isMem ? entry.grpTres.memMiB : entry.grpTres.cpu;
        if (raw === null) {
          continue;
        }
        const { effectiveLimit } = effectiveAssocTresLimit(raw, limitFactor);
        if (effectiveLimit === null) {
          continue;
        }
        const usage = calculateAssociationEntryGroupUsage(
          entry,
          assocStore,
          resolved,
          { jobs },
          isMem ? allocatedMemoryMiB : allocatedCpus
        );
        levels.push({
          entry,
          effectiveLimit,
          used: usage.unknown > 0 ? null : usage.total,
          knownUsed: usage.total,
          runningJobs: usage.runningJobs,
        });
      }
      if (levels.length === 0) {
        return null;
      }
      const { limiting, fellShort } = selectProvenLimiting(levels, requested);
      if (limiting === null) {
        if (fellShort) {
          return null;
        }
        const tightest = tightestKnownLevel(levels, requested);
        return {
          kind: 'limit',
          domain: 'association',
          metric,
          limit: tightest.effectiveLimit as number,
          used: tightest.used,
          requested,
          account,
          user: job.user ?? undefined,
          runningJobs: tightest.runningJobs,
          hierarchy: buildHierarchy(levels, null),
        };
      }
      const limitingLevel = levels.find((level) => level.entry === limiting) as LevelMeasurement;
      return {
        kind: 'limit',
        domain: 'association',
        metric,
        limit: limitingLevel.effectiveLimit as number,
        used: limitingLevel.used,
        requested,
        account,
        limitingAccount: limiting.account,
        user: job.user ?? undefined,
        runningJobs: limitingLevel.runningJobs,
        hierarchy: buildHierarchy(levels, limiting),
      };
    }
    case 'AssocGrpGRES': {
      const gpu = requestedGpuType(ctx);
      if (gpu === null) {
        return null;
      }
      const levels: LevelMeasurement[] = [];
      for (const entry of chain) {
        const raw = entry.grpTres.gres[gpu.key] ?? entry.grpTres.gres['gpu'] ?? null;
        if (raw === null) {
          continue;
        }
        const { effectiveLimit } = effectiveAssocTresLimit(raw, limitFactor);
        if (effectiveLimit === null) {
          continue;
        }
        const pick = gpu.key === 'gpu' ? allocatedGpuTotal : allocatedGpuType(gpu.display);
        const usage = calculateAssociationEntryGroupUsage(entry, assocStore, resolved, { jobs }, pick);
        levels.push({
          entry,
          effectiveLimit,
          used: usage.unknown > 0 ? null : usage.total,
          knownUsed: usage.total,
          runningJobs: usage.runningJobs,
        });
      }
      if (levels.length === 0) {
        return null;
      }
      const { limiting, fellShort } = selectProvenLimiting(levels, gpu.count);
      if (limiting === null) {
        if (fellShort) {
          return null;
        }
        const tightest = tightestKnownLevel(levels, gpu.count);
        return {
          kind: 'limit',
          domain: 'association',
          metric: 'gpus',
          gpuType: gpu.display === 'gpu' ? undefined : gpu.display,
          limit: tightest.effectiveLimit as number,
          used: tightest.used,
          requested: gpu.count,
          account,
          user: job.user ?? undefined,
          runningJobs: tightest.runningJobs,
          hierarchy: buildHierarchy(levels, null),
        };
      }
      const limitingLevel = levels.find((level) => level.entry === limiting) as LevelMeasurement;
      return {
        kind: 'limit',
        domain: 'association',
        metric: 'gpus',
        gpuType: gpu.display === 'gpu' ? undefined : gpu.display,
        limit: limitingLevel.effectiveLimit as number,
        used: limitingLevel.used,
        requested: gpu.count,
        account,
        limitingAccount: limiting?.account ?? undefined,
        user: job.user ?? undefined,
        runningJobs: limitingLevel.runningJobs,
        hierarchy: buildHierarchy(levels, limiting),
      };
    }
    case 'AssocMaxJobsLimit': {
      if (job.user === null) {
        return null;
      }
      // MaxJobs is per-association: the first-defined entry up the chain
      // wins, and sibling users never count. GrpJobs is a separate limit.
      const winner = chain.find((entry) => entry.maxJobs !== null) ?? null;
      if (winner === null || winner.maxJobs === null) {
        return null;
      }
      const limit = winner.maxJobs;
      const usage = calculateAssociationEntryUserUsage(winner, assocStore, job.user, resolved, { jobs }, () => 1);
      const proven = usage.total + 1 > limit;
      if (!proven && usage.unknown > 0) {
        return null;
      }
      const used = usage.unknown > 0 ? null : usage.total;
      const winnerSubtree = descendantAssociationIds(assocStore, winner.id);
      const topConsumers = jobs
        .filter((entry) => {
          if (entry.state !== 'RUNNING' || entry.user !== job.user) {
            return false;
          }
          const id = resolved.get(entry.id) ?? null;
          return id !== null && winnerSubtree !== null && winnerSubtree.has(id);
        })
        .slice(0, TOP_CONSUMERS_CAP)
        .map((entry) => ({ jobId: entry.id, user: entry.user, account: entry.account, value: 1 }));
      return {
        kind: 'limit',
        domain: 'association',
        metric: 'jobs',
        limit,
        used,
        requested: 1,
        account,
        limitingAccount: winner.account,
        user: job.user,
        runningJobs: usage.runningJobs,
        hierarchy: buildHierarchy(
          chain
            .filter((entry) => entry.maxJobs !== null)
            .map((entry) => {
              const entryUsage = calculateAssociationEntryUserUsage(entry, assocStore, job.user as string, resolved, { jobs }, () => 1);
              return {
                entry,
                effectiveLimit: entry.maxJobs,
                used: entryUsage.unknown > 0 ? null : entryUsage.total,
                knownUsed: entryUsage.total,
                runningJobs: entryUsage.runningJobs,
              };
            }),
          winner
        ),
        topConsumers,
      };
    }
    case 'AssocGrpMemRunMinutes':
    case 'AssocGrpCPURunMinutesLimit': {
      const isMem = reason === 'AssocGrpMemRunMinutes';
      const metric: LimitMetric = isMem ? 'memoryMiBMinutes' : 'cpuMinutes';
      const resource = isMem ? 'mem' : ('cpu' as const);
      const levels: LevelMeasurement[] = [];
      const topByJob = new Map<string, { jobId: string; user: string | null; account: string | null; value: number }>();
      for (const entry of chain) {
        const raw = isMem ? entry.grpTresRunMins.memMiB : entry.grpTresRunMins.cpu;
        if (raw === null) {
          continue;
        }
        const sum = calculateAssociationEntryGroupRunMinutes(entry, assocStore, resolved, resource, {
          jobs,
          qosStore: ctx.qos?.store ?? null,
        });
        for (const consumer of sum.topConsumers) {
          const existing = topByJob.get(consumer.jobId);
          if (existing === undefined || consumer.value > existing.value) {
            topByJob.set(consumer.jobId, consumer);
          }
        }
        levels.push({
          entry,
          effectiveLimit: raw,
          used: sum.unknown > 0 ? null : sum.total,
          knownUsed: sum.total,
          runningJobs: sum.runningJobs,
        });
      }
      if (levels.length === 0) {
        return null;
      }
      // Run-minute `requested` stays null: only limit/used evidence is
      // reported. Usage alone proves the condition only when already over
      // the limit, at the first such level up the chain.
      let limiting: AssociationEntry | null = null;
      for (const level of levels) {
        if (level.knownUsed > (level.effectiveLimit ?? 0)) {
          limiting = level.entry;
          break;
        }
      }
      if (limiting === null) {
        return null;
      }
      const limitingLevel = levels.find((level) => level.entry === limiting) as LevelMeasurement;
      return {
        kind: 'limit',
        domain: 'association',
        metric,
        limit: limitingLevel.effectiveLimit as number,
        used: limitingLevel.used,
        requested: null,
        account,
        limitingAccount: limiting?.account ?? undefined,
        user: job.user ?? undefined,
        runningJobs: limitingLevel.runningJobs,
        hierarchy: buildHierarchy(levels, limiting),
        topConsumers: [...topByJob.values()]
          .sort((a, b) => b.value - a.value)
          .slice(0, TOP_CONSUMERS_CAP)
          .map((consumer) => ({ ...consumer, value: Math.round(consumer.value) })),
      };
    }
    default:
      return null;
  }
}

export { ASSOC_REASONS, analyzeAssocLimits, isAssocReason };
export type { AssocKind };
