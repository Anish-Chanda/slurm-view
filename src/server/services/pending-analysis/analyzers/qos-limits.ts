// QOS limit analyzers (QOSGrp*/QOSMax*). Job QOS and partition QOS stay
// distinct: partition-QOS cohorts resolve by partition membership, never
// job.qos equality.
import type { AnalyzerContext } from '../types.js';
import type { LimitAnalysisDto, LimitMetric } from '../../../../shared/api/v1/pending-analysis.js';
import type { QosEntry } from '../../../models/qos.js';
import { isRelativeQos } from '../../../models/qos.js';
import {
  aggregateMemoryRequest,
  pickEffectiveQosEntry,
} from './limit-helpers.js';
import {
  allocatedCpus,
  allocatedMemoryMiB,
  calculateQosGroupUsage,
  calculateQosUserUsage,
} from '../usage.js';

type QosKind =
  | 'QOSGrpCpuLimit'
  | 'QOSGrpJobsLimit'
  | 'QOSGrpMemLimit'
  | 'QOSGrpNodeLimit'
  | 'QOSMaxCpuPerUserLimit'
  | 'QOSMaxJobsPerUserLimit'
  | 'QOSMaxNodePerUserLimit'
  | 'QOSMaxMemoryPerUser';

const QOS_REASONS: ReadonlySet<string> = new Set([
  'QOSGrpCpuLimit',
  'QOSGrpJobsLimit',
  'QOSGrpMemLimit',
  'QOSGrpNodeLimit',
  'QOSMaxCpuPerUserLimit',
  'QOSMaxJobsPerUserLimit',
  'QOSMaxNodePerUserLimit',
  'QOSMaxMemoryPerUser',
]);

function isQosReason(reason: string | null): reason is QosKind {
  return reason !== null && QOS_REASONS.has(reason);
}

// Partitions carrying a given partition QOS, from the cluster table.
function partitionsForQos(
  ctx: AnalyzerContext,
  qosName: string
): ReadonlySet<string> | null {
  if (ctx.partitionTable === null) {
    return null;
  }
  const partitions = new Set<string>();
  for (const entry of ctx.partitionTable) {
    if (entry.qos === qosName) {
      partitions.add(entry.name);
    }
  }
  return partitions;
}

async function analyzeQosLimits(ctx: AnalyzerContext): Promise<LimitAnalysisDto | null> {
  const reason = ctx.targeted.job.stateReason;
  if (!isQosReason(reason) || ctx.qos === null) {
    return null;
  }
  const job = ctx.targeted.job;
  const jobs = ctx.jobsSnapshot.jobs;

  switch (reason) {
    case 'QOSGrpCpuLimit':
    case 'QOSGrpJobsLimit':
    case 'QOSGrpMemLimit':
    case 'QOSGrpNodeLimit': {
      // Node-count group accounting (unique vs shared nodes) cannot be
      // reproduced from the snapshot.
      if (reason === 'QOSGrpNodeLimit') {
        return null;
      }
      const metric: LimitMetric =
        reason === 'QOSGrpCpuLimit' ? 'cpus' : reason === 'QOSGrpJobsLimit' ? 'jobs' : 'memoryMiB';
      const definesMetric = (entry: QosEntry): boolean => {
        if (metric === 'cpus') {
          return entry.grpTres.cpu !== null;
        }
        if (metric === 'memoryMiB') {
          return entry.grpTres.memMiB !== null;
        }
        return entry.grpJobs !== null;
      };
      const effective = pickEffectiveQosEntry(ctx, definesMetric);
      if (effective === null || effective.entry === null) {
        return null;
      }
      // Relative QOS limits are percents, not absolute counts.
      if (isRelativeQos(effective.entry)) {
        return null;
      }
      const limit =
        metric === 'cpus'
          ? effective.entry.grpTres.cpu
          : metric === 'memoryMiB'
            ? effective.entry.grpTres.memMiB
            : effective.entry.grpJobs;
      if (limit === null) {
        return null;
      }
      const requested =
        metric === 'cpus'
          ? job.requested.cpus
          : metric === 'memoryMiB'
            ? aggregateMemoryRequest(ctx)
            : 1;
      if (requested === null) {
        return null;
      }
      if (effective.source === 'partition') {
        // Partition-QOS cohort: RUNNING jobs on partitions carrying this
        // QOS, regardless of each job's own requested QOS.
        const memberPartitions = partitionsForQos(ctx, effective.name);
        if (memberPartitions === null || memberPartitions.size === 0) {
          return null;
        }
        const cohort = jobs.filter(
          (entry) =>
            entry.partition !== null &&
            memberPartitions.has(entry.partition) &&
            entry.state === 'RUNNING'
        );
        const pick = metric === 'cpus' ? allocatedCpus : metric === 'memoryMiB' ? allocatedMemoryMiB : (): number | null => 1;
        let total = 0;
        let runningJobs = 0;
        let unknown = 0;
        const consumers: Array<{ jobId: string; user: string | null; account: string | null; value: number }> = [];
        for (const entry of cohort) {
          runningJobs += 1;
          const value = pick(entry);
          if (value === null || !Number.isFinite(value)) {
            unknown += 1;
          } else {
            total += value;
            if (value > 0) {
              consumers.push({ jobId: entry.id, user: entry.user, account: entry.account, value });
            }
          }
        }
        consumers.sort((a, b) => b.value - a.value);
        return {
          kind: 'limit',
          domain: 'qos',
          metric,
          limit,
          used: unknown > 0 ? null : total,
          requested,
          qos: effective.name,
          user: job.user ?? undefined,
          account: job.account ?? undefined,
          runningJobs,
          topConsumers: consumers.slice(0, 5).length > 0 ? consumers.slice(0, 5) : undefined,
        };
      }
      // Job-QOS group usage is QOS-global, never account-filtered.
      const pick = metric === 'cpus' ? allocatedCpus : metric === 'memoryMiB' ? allocatedMemoryMiB : (): number | null => 1;
      const groupUsage = calculateQosGroupUsage(effective.name, { jobs }, pick);
      const total = groupUsage.unknown > 0 ? null : groupUsage.total;
      const runningJobs = groupUsage.runningJobs;
      const consumers = jobs
        .filter((entry) => entry.state === 'RUNNING' && entry.qos === effective.name)
        .map((entry) => ({
          jobId: entry.id,
          user: entry.user,
          account: entry.account,
          value: pick(entry) ?? 0,
        }))
        .filter((entry) => entry.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);
      return {
        kind: 'limit',
        domain: 'qos',
        metric,
        limit,
        used: total,
        requested,
        qos: effective.name,
        user: job.user ?? undefined,
        account: job.account ?? undefined,
        runningJobs,
        topConsumers: consumers.length > 0 ? consumers : undefined,
      };
    }
    case 'QOSMaxCpuPerUserLimit':
    case 'QOSMaxJobsPerUserLimit':
    case 'QOSMaxNodePerUserLimit':
    case 'QOSMaxMemoryPerUser': {
      if (job.user === null) {
        return null;
      }
      // Node per-user accounting shares the group ambiguity.
      if (reason === 'QOSMaxNodePerUserLimit') {
        return null;
      }
      const metric: LimitMetric =
        reason === 'QOSMaxCpuPerUserLimit' ? 'cpus' : reason === 'QOSMaxJobsPerUserLimit' ? 'jobs' : 'memoryMiB';
      const definesMetric = (entry: QosEntry): boolean => {
        if (metric === 'cpus') {
          return entry.maxTresPerUser.cpu !== null;
        }
        if (metric === 'memoryMiB') {
          return entry.maxTresPerUser.memMiB !== null;
        }
        return entry.maxJobsPerUser !== null;
      };
      // Partition-sourced per-user cohorts are unreliable.
      const effective = pickEffectiveQosEntry(ctx, definesMetric);
      if (effective === null || effective.entry === null) {
        return null;
      }
      if (isRelativeQos(effective.entry)) {
        return null;
      }
      if (effective.source === 'partition') {
        return null;
      }
      const limit =
        metric === 'cpus'
          ? effective.entry.maxTresPerUser.cpu
          : metric === 'memoryMiB'
            ? effective.entry.maxTresPerUser.memMiB
            : effective.entry.maxJobsPerUser;
      if (limit === null) {
        return null;
      }
      const requested =
        metric === 'cpus'
          ? job.requested.cpus
          : metric === 'memoryMiB'
            ? aggregateMemoryRequest(ctx)
            : 1;
      if (requested === null) {
        return null;
      }
      const pick = metric === 'cpus' ? allocatedCpus : metric === 'memoryMiB' ? allocatedMemoryMiB : (): number | null => 1;
      const userUsage = calculateQosUserUsage(effective.name, job.user, { jobs }, pick);
      const total = userUsage.unknown > 0 ? null : userUsage.total;
      const runningJobs = userUsage.runningJobs;
      return {
        kind: 'limit',
        domain: 'qos',
        metric,
        limit,
        used: total,
        requested,
        qos: effective.name,
        user: job.user,
        account: job.account ?? undefined,
        runningJobs,
      };
    }
    default:
      return null;
  }
}

export { QOS_REASONS, analyzeQosLimits, isQosReason };
export type { QosKind };
