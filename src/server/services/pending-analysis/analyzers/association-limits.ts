// Analyze AssocGrp* and AssocMaxJobsLimit policies. Scope usage to the
// limiting association, since account names alone do not identify its users.
import type { AnalyzerContext } from '../types.js';
import type {
  AssociationLimitConstraintDto,
  AssociationLimitStatus,
  AssociationOverviewDto,
  LimitAnalysisDto,
  LimitMetric,
  ResourceKind,
  RuntimeMinuteConstraintDto,
  RuntimeMinuteMetric,
  RuntimeMinuteOverviewDto,
} from '../../../../shared/api/v1/pending-analysis.js';
import type { AssociationEntry, AssociationStore, AssociationTres } from '../../../models/association.js';
import type { GpuRequest } from '../../../models/job.js';
import type { QosStore } from '../../../models/qos.js';
import type { QueueJob } from '../../../models/queue-job.js';
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
  calculateAssociationEntryGroupRunMinutesMany,
  calculateAssociationEntryGroupUsageMany,
  calculateAssociationEntryUserUsage,
  finiteTimeLimitMinutes,
  resolveJobAssociationIds,
  usageFactorFor,
} from '../usage.js';
import type { RunMinutesSum } from '../usage.js';
import {
  TOP_CONSUMERS_CAP,
  aggregateMemoryRequest,
  requestedGpuType,
  requestedGpuTypes,
} from './limit-helpers.js';

type AssocKind =
  | 'AssocGrpMemLimit'
  | 'AssocGrpCpuLimit'
  | 'AssocGrpGRES'
  | 'AssocMaxJobsLimit'
  | 'AssocGrpMemRunMinutes'
  | 'AssocGrpCPURunMinutesLimit'
  | 'AssocGrpGRESRunMinutes';

const ASSOC_REASONS: ReadonlySet<string> = new Set([
  'AssocGrpMemLimit',
  'AssocGrpCpuLimit',
  'AssocGrpGRES',
  'AssocMaxJobsLimit',
  'AssocGrpMemRunMinutes',
  'AssocGrpCPURunMinutesLimit',
  'AssocGrpGRESRunMinutes',
]);

function isAssocReason(reason: string | null): reason is AssocKind {
  return reason !== null && ASSOC_REASONS.has(reason);
}

interface LevelMeasurement {
  entry: AssociationEntry;
  effectiveLimit: number;
  // Exact total, or null if any contributor cannot be quantified. knownUsed
  // holds the quantified lower bound.
  used: number | null;
  knownUsed: number;
  runningJobs: number;
  // GPU only: true when a GPU-type-specific limit matched this level; false
  // when a generic gres/gpu limit (covering every GPU type) did.
  typed?: boolean;
}

interface ResourceMeasurement extends LevelMeasurement {
  resource: ResourceKind;
  // GPU only: the type for gres/gpu:<type>; absent for generic gres/gpu.
  gpuType?: string;
  requested: number | null;
}

interface LevelMeasurements {
  entry: AssociationEntry;
  cpu: ResourceMeasurement | null;
  memory: ResourceMeasurement | null;
  gpus: ResourceMeasurement[];
}

interface AnalysisRequests {
  cpus: number | null;
  memoryMiB: number | null;
  gpus: GpuRequest;
}

interface ConstraintSpec {
  key: string;
  resource: ResourceKind;
  rawLimit: number;
  requested: number | null;
  gpuType?: string;
  pick: (job: QueueJob) => number | null;
}

interface RuntimeProjections {
  cpuMinutes: number | null;
  memoryMiBMinutes: number | null;
  gpuMinutes: number | null;
  typedGpuMinutes: Readonly<Record<string, number | null>>;
}

interface RuntimeConstraintSpec {
  key: string;
  metric: RuntimeMinuteMetric;
  rawLimit: number;
  projected: number | null;
  gpuType?: string;
  pick: (job: QueueJob) => number | null;
}

interface RuntimeConstraintMeasurement {
  entry: AssociationEntry;
  metric: RuntimeMinuteMetric;
  gpuType?: string;
  effectiveLimit: number;
  // Exact estimate, or null when any in-scope contributor is unknown.
  // knownCommitted holds the quantified lower bound.
  committed: number | null;
  knownCommitted: number;
  projected: number | null;
  runningJobs: number;
  topConsumers: RunMinutesSum['topConsumers'];
}

interface RuntimeLevelMeasurements {
  entry: AssociationEntry;
  constraints: RuntimeConstraintMeasurement[];
}

function projectRuntimeMinutes(
  amount: number | null,
  minutes: number | null,
  factor: number | null
): number | null {
  if (amount === 0 || factor === 0) {
    return 0;
  }
  if (amount === null || minutes === null || factor === null) {
    return null;
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }
  const value = amount * minutes * factor;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function runtimeProjections(ctx: AnalyzerContext): RuntimeProjections {
  const job = ctx.targeted.job;
  const minutes = finiteTimeLimitMinutes(job);
  const factor = usageFactorFor(ctx.qos?.store ?? null, job);
  const gpus = job.requested.gpus;
  const typedGpuMinutes: Record<string, number | null> = {};
  for (const { type, count } of requestedGpuTypes(gpus)) {
    typedGpuMinutes[type] = projectRuntimeMinutes(count, minutes, factor);
  }
  return {
    cpuMinutes: projectRuntimeMinutes(job.requested.cpus, minutes, factor),
    memoryMiBMinutes: projectRuntimeMinutes(
      aggregateMemoryRequest(ctx),
      minutes,
      factor
    ),
    gpuMinutes:
      gpus.total > 0
        ? projectRuntimeMinutes(gpus.total, minutes, factor)
        : null,
    typedGpuMinutes,
  };
}

function gpuRuntimeConstraintSpecs(
  gres: AssociationTres['gres'],
  requestedGpus: GpuRequest,
  projections: RuntimeProjections
): RuntimeConstraintSpec[] {
  // Only explicitly requested GPU types have applicable typed limits.
  if (requestedGpus.total <= 0) {
    return [];
  }
  const specs: RuntimeConstraintSpec[] = [];
  for (const { type } of requestedGpuTypes(requestedGpus)) {
    const rawLimit = gres[`gpu:${type}`];
    if (rawLimit === undefined) {
      continue;
    }
    specs.push({
      key: `gpu:${type}`,
      metric: 'gpuMinutes',
      gpuType: type,
      rawLimit,
      projected: projections.typedGpuMinutes[type] ?? null,
      pick: allocatedGpuType(type),
    });
  }
  // Prefer typed GPU limits when selecting the primary constraint.
  const generic = gres.gpu ?? null;
  if (generic !== null) {
    specs.push({
      key: 'gpu',
      metric: 'gpuMinutes',
      rawLimit: generic,
      projected: projections.gpuMinutes,
      pick: allocatedGpuTotal,
    });
  }
  return specs;
}

function runtimeConstraintSpecs(
  entry: AssociationEntry,
  requestedGpus: GpuRequest,
  projections: RuntimeProjections
): RuntimeConstraintSpec[] {
  const specs: RuntimeConstraintSpec[] = [];
  // GrpTRESRunMins is not scaled by QOS LimitFactor.
  if (entry.grpTresRunMins.cpu !== null) {
    specs.push({
      key: 'cpuMinutes',
      metric: 'cpuMinutes',
      rawLimit: entry.grpTresRunMins.cpu,
      projected: projections.cpuMinutes,
      pick: allocatedCpus,
    });
  }
  if (entry.grpTresRunMins.memMiB !== null) {
    specs.push({
      key: 'memoryMiBMinutes',
      metric: 'memoryMiBMinutes',
      rawLimit: entry.grpTresRunMins.memMiB,
      projected: projections.memoryMiBMinutes,
      pick: allocatedMemoryMiB,
    });
  }
  specs.push(
    ...gpuRuntimeConstraintSpecs(
      entry.grpTresRunMins.gres,
      requestedGpus,
      projections
    )
  );
  return specs;
}

function buildRuntimeLevelMeasurements(
  chain: readonly AssociationEntry[],
  assocStore: AssociationStore,
  resolved: Map<string, string | null>,
  jobs: readonly QueueJob[],
  qosStore: QosStore | null | undefined,
  requestedGpus: GpuRequest,
  projections: RuntimeProjections
): RuntimeLevelMeasurements[] {
  return chain.map((entry) => {
    const specs = runtimeConstraintSpecs(entry, requestedGpus, projections);
    if (specs.length === 0) {
      return { entry, constraints: [] };
    }
    const picks: Record<string, (job: QueueJob) => number | null> = {};
    for (const spec of specs) {
      picks[spec.key] = spec.pick;
    }
    const usage = calculateAssociationEntryGroupRunMinutesMany(
      entry,
      assocStore,
      resolved,
      { jobs, qosStore },
      picks
    );
    return {
      entry,
      constraints: specs.map((spec): RuntimeConstraintMeasurement => {
        const sum = usage[spec.key] as RunMinutesSum;
        return {
          entry,
          metric: spec.metric,
          ...(spec.gpuType !== undefined ? { gpuType: spec.gpuType } : {}),
          effectiveLimit: spec.rawLimit,
          committed: sum.unknown > 0 ? null : sum.total,
          knownCommitted: sum.total,
          projected: spec.projected,
          runningJobs: sum.runningJobs,
          topConsumers: sum.topConsumers,
        };
      }),
    };
  });
}

function assessRuntimeConstraint(
  measurement: RuntimeConstraintMeasurement
): AssociationLimitStatus {
  const { effectiveLimit, committed, knownCommitted, projected } = measurement;
  if (projected !== null && projected > effectiveLimit) {
    return 'exceedsRequest';
  }
  // Known usage can prove a violation, but not headroom.
  if (knownCommitted > effectiveLimit) {
    return 'usageExceeded';
  }
  if (projected === null) {
    return 'unknown';
  }
  if (knownCommitted + projected > effectiveLimit) {
    return 'usageExceeded';
  }
  return committed === null ? 'unknown' : 'withinLimit';
}

function toRuntimeConstraint(
  measurement: RuntimeConstraintMeasurement
): RuntimeMinuteConstraintDto {
  return {
    metric: measurement.metric,
    ...(measurement.gpuType !== undefined
      ? { gpuType: measurement.gpuType }
      : {}),
    limit: measurement.effectiveLimit,
    committed: measurement.committed,
    projected: measurement.projected,
    status: assessRuntimeConstraint(measurement),
  };
}

function buildRuntimeOverview(
  chain: readonly AssociationEntry[],
  levels: readonly RuntimeLevelMeasurements[]
): RuntimeMinuteOverviewDto {
  return {
    hierarchy: chain.map((entry, index) => {
      const level = levels[index] as RuntimeLevelMeasurements;
      const parentEntry = chain[index + 1] ?? null;
      return {
        account: entry.account,
        ...(entry.user !== null ? { user: entry.user } : {}),
        ...(entry.partition !== null ? { partition: entry.partition } : {}),
        parent: parentEntry?.account ?? null,
        constraints: level.constraints.map(toRuntimeConstraint),
      };
    }),
  };
}

function runtimeProven(measurement: RuntimeConstraintMeasurement): boolean {
  return (
    (measurement.projected !== null &&
      measurement.projected > measurement.effectiveLimit) ||
    measurement.knownCommitted > measurement.effectiveLimit ||
    (measurement.projected !== null &&
      measurement.knownCommitted + measurement.projected >
        measurement.effectiveLimit)
  );
}

function runtimeHeadroom(
  measurement: RuntimeConstraintMeasurement
): number | null {
  if (measurement.projected === null) {
    return null;
  }
  return (
    measurement.effectiveLimit -
    (measurement.knownCommitted + measurement.projected)
  );
}

function tightestRuntime(
  candidates: readonly RuntimeConstraintMeasurement[]
): RuntimeConstraintMeasurement {
  let best = candidates[0] as RuntimeConstraintMeasurement;
  let bestHeadroom = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const headroom = runtimeHeadroom(candidate);
    if (headroom === null) {
      continue;
    }
    if (headroom < bestHeadroom) {
      bestHeadroom = headroom;
      best = candidate;
    }
  }
  return best;
}

function pickRuntimeBindingCandidate(
  candidates: readonly RuntimeConstraintMeasurement[]
): RuntimeConstraintMeasurement {
  const proven = candidates.find(runtimeProven);
  if (proven !== undefined) {
    return proven;
  }
  return tightestRuntime(candidates);
}

// Select the first proven level from the user association toward the root,
// matching Slurm's bottom-up enforcement order. Without proof, keep the
// tightest known budget as useful evidence.
function selectRuntimeLimiting(
  levels: readonly RuntimeConstraintMeasurement[]
): { selected: RuntimeConstraintMeasurement; proven: boolean } {
  for (const level of levels) {
    if (runtimeProven(level)) {
      return { selected: level, proven: true };
    }
  }
  return { selected: tightestRuntime(levels), proven: false };
}

function buildRuntimePrimaryHierarchy(
  chain: readonly AssociationEntry[],
  levels: readonly RuntimeConstraintMeasurement[],
  limiting: RuntimeConstraintMeasurement | null
): LimitAnalysisDto['hierarchy'] {
  const measurements = new Map<string, RuntimeConstraintMeasurement>();
  for (const level of levels) {
    if (level.entry.id !== null) {
      measurements.set(level.entry.id, level);
    }
  }
  return chain.map((entry, index) => {
    const measurement =
      entry.id !== null ? measurements.get(entry.id) ?? null : null;
    const parentEntry = chain[index + 1] ?? null;
    return {
      account: entry.account,
      ...(entry.user !== null ? { user: entry.user } : {}),
      ...(entry.partition !== null ? { partition: entry.partition } : {}),
      ...(measurement?.gpuType !== undefined
        ? { gpuType: measurement.gpuType }
        : {}),
      parent: parentEntry?.account ?? null,
      limit: measurement?.effectiveLimit ?? null,
      used: measurement?.committed ?? null,
      limiting:
        limiting !== null &&
        (entry === limiting.entry ||
          (entry.id !== null && entry.id === limiting.entry.id)),
    };
  });
}

function analyzeRuntimeReason(
  reason:
    | 'AssocGrpMemRunMinutes'
    | 'AssocGrpCPURunMinutesLimit'
    | 'AssocGrpGRESRunMinutes',
  ctx: AnalyzerContext,
  chain: readonly AssociationEntry[],
  levels: readonly RuntimeLevelMeasurements[],
  overview: RuntimeMinuteOverviewDto,
  account: string
): LimitAnalysisDto | null {
  const candidates: RuntimeConstraintMeasurement[] = [];
  if (reason === 'AssocGrpGRESRunMinutes') {
    for (const level of levels) {
      const gpus = level.constraints.filter(
        (constraint) => constraint.metric === 'gpuMinutes'
      );
      if (gpus.length > 0) {
        candidates.push(pickRuntimeBindingCandidate(gpus));
      }
    }
  } else {
    const metric: RuntimeMinuteMetric =
      reason === 'AssocGrpMemRunMinutes'
        ? 'memoryMiBMinutes'
        : 'cpuMinutes';
    for (const level of levels) {
      const constraint = level.constraints.find(
        (candidate) => candidate.metric === metric
      );
      if (constraint !== undefined) {
        candidates.push(constraint);
      }
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  const { selected, proven } = selectRuntimeLimiting(candidates);
  return {
    kind: 'limit',
    domain: 'association',
    metric: selected.metric,
    ...(selected.gpuType !== undefined ? { gpuType: selected.gpuType } : {}),
    limit: selected.effectiveLimit,
    used: selected.committed,
    requested: selected.projected,
    account,
    ...(proven ? { limitingAccount: selected.entry.account } : {}),
    user: ctx.targeted.job.user ?? undefined,
    runningJobs: selected.runningJobs,
    hierarchy: buildRuntimePrimaryHierarchy(
      chain,
      candidates,
      proven ? selected : null
    ),
    runtimeMinuteOverview: overview,
    topConsumers: selected.topConsumers
      .slice(0, TOP_CONSUMERS_CAP)
      .map((consumer) => ({ ...consumer, value: Math.round(consumer.value) })),
  };
}

function buildHierarchy(
  chain: AssociationEntry[],
  levels: LevelMeasurement[],
  limiting: AssociationEntry | null,
  // GRES only: the requested GPU type, attached to rows whose limit is
  // scoped to that type. Generic gres/gpu rows stay unlabeled.
  typedGpuType?: string
): LimitAnalysisDto['hierarchy'] {
  const measurements = new Map<string, LevelMeasurement>();
  for (const level of levels) {
    if (level.entry.id !== null) {
      measurements.set(level.entry.id, level);
    }
  }
  return chain.map((entry, index) => {
    const level = entry.id !== null ? measurements.get(entry.id) ?? null : null;
    const parentEntry = chain[index + 1] ?? null;
    return {
      account: entry.account,
      ...(entry.user !== null ? { user: entry.user } : {}),
      ...(entry.partition !== null ? { partition: entry.partition } : {}),
      ...(level?.typed && typedGpuType !== undefined ? { gpuType: typedGpuType } : {}),
      parent: parentEntry?.account ?? null,
      limit: level?.effectiveLimit ?? null,
      used: level?.used ?? null,
      limiting: limiting !== null && (entry === limiting || (entry.id !== null && entry.id === limiting.id)),
    };
  });
}

// Select the first proven level from the user association toward the root,
// matching Slurm's bottom-up enforcement order.
function selectProvenLimiting<T extends LevelMeasurement>(
  levels: readonly T[],
  requested: number
): { limiting: AssociationEntry | null; fellShort: boolean } {
  for (const level of levels) {
    if (level.knownUsed + requested > level.effectiveLimit) {
      return { limiting: level.entry, fellShort: false };
    }
  }
  const unknown = levels.some((level) => level.used === null);
  return { limiting: null, fellShort: unknown };
}

function tightestKnownLevel<T extends LevelMeasurement>(
  levels: readonly T[],
  requested: number
): T {
  let best = levels[0]!;
  let bestHeadroom = Number.POSITIVE_INFINITY;
  for (const level of levels) {
    if (level.used === null) {
      continue;
    }
    const headroom = level.effectiveLimit - (level.used + requested);
    if (headroom < bestHeadroom) {
      bestHeadroom = headroom;
      best = level;
    }
  }
  return best;
}

// Pick which of one association's limits binds: a proven-exceeded one (typed
// first, as the more specific), else the least headroom among known usage.
function pickBindingCandidate<T extends LevelMeasurement>(
  candidates: readonly T[],
  requested: number
): T {
  const proven = candidates.find(
    (candidate) => candidate.knownUsed + requested > candidate.effectiveLimit
  );
  if (proven !== undefined) {
    return proven;
  }
  return tightestKnownLevel(candidates, requested);
}

// Only CPU, memory and GPU limits are checked against the request. Job counts and run-minutes are not.
const EXCEEDABLE_METRICS: readonly LimitMetric[] = ['cpus', 'memoryMiB', 'gpus'];

// Mark levels whose limit is below the job's whole request. Usage is irrelevant: such a job cannot start.
function flagExceededLevels(analysis: LimitAnalysisDto | null): LimitAnalysisDto | null {
  if (
    analysis === null ||
    !EXCEEDABLE_METRICS.includes(analysis.metric) ||
    analysis.requested === null ||
    analysis.hierarchy === undefined
  ) {
    return analysis;
  }
  const requested = analysis.requested;
  return {
    ...analysis,
    hierarchy: analysis.hierarchy.map((level) =>
      level.limit !== null && requested > level.limit ? { ...level, exceedsLimit: true } : level
    ),
  };
}

function analysisRequests(ctx: AnalyzerContext): AnalysisRequests {
  return {
    cpus: ctx.targeted.job.requested.cpus,
    memoryMiB: aggregateMemoryRequest(ctx),
    gpus: ctx.targeted.job.requested.gpus,
  };
}

function gpuConstraintSpecs(
  gres: AssociationTres['gres'],
  requestedGpus: GpuRequest
): ConstraintSpec[] {
  // Only explicitly requested GPU types have applicable typed limits.
  const requestedTypes = requestedGpuTypes(requestedGpus);
  const specs: ConstraintSpec[] = requestedTypes.flatMap(({ type, count }) => {
    const rawLimit = gres[`gpu:${type}`];
    return rawLimit === undefined
      ? []
      : [
          {
            key: `gpu:${type}`,
            resource: 'gpus' as const,
            gpuType: type,
            rawLimit,
            requested: count,
            pick: allocatedGpuType(type),
          },
        ];
  });
  // Prefer typed GPU limits when selecting the primary constraint.
  const generic = gres.gpu ?? null;
  if (generic !== null && requestedGpus.total > 0) {
    specs.push({
      key: 'gpu',
      resource: 'gpus',
      rawLimit: generic,
      requested: requestedGpus.total,
      pick: allocatedGpuTotal,
    });
  }
  return specs;
}

function buildLevelMeasurements(
  chain: readonly AssociationEntry[],
  assocStore: AssociationStore,
  resolved: Map<string, string | null>,
  jobs: readonly QueueJob[],
  limitFactor: number | null,
  requests: AnalysisRequests
): LevelMeasurements[] {
  return chain.map((entry) => {
    const specs: ConstraintSpec[] = [];
    if (entry.grpTres.cpu !== null) {
      specs.push({
        key: 'cpus',
        resource: 'cpus',
        rawLimit: entry.grpTres.cpu,
        requested: requests.cpus,
        pick: allocatedCpus,
      });
    }
    if (entry.grpTres.memMiB !== null) {
      specs.push({
        key: 'memoryMiB',
        resource: 'memoryMiB',
        rawLimit: entry.grpTres.memMiB,
        requested: requests.memoryMiB,
        pick: allocatedMemoryMiB,
      });
    }
    specs.push(...gpuConstraintSpecs(entry.grpTres.gres, requests.gpus));
    if (specs.length === 0) {
      return { entry, cpu: null, memory: null, gpus: [] };
    }

    const picks: Record<string, (job: QueueJob) => number | null> = {};
    for (const spec of specs) {
      picks[spec.key] = spec.pick;
    }
    const usage = calculateAssociationEntryGroupUsageMany(
      entry,
      assocStore,
      resolved,
      { jobs },
      picks
    );
    const measured = specs.map((spec): ResourceMeasurement => {
      const { effectiveLimit } = effectiveAssocTresLimit(spec.rawLimit, limitFactor);
      const scope = usage[spec.key]!;
      return {
        entry,
        resource: spec.resource,
        ...(spec.gpuType !== undefined ? { gpuType: spec.gpuType } : {}),
        effectiveLimit: effectiveLimit as number,
        used: scope.unknown > 0 ? null : scope.total,
        knownUsed: scope.total,
        runningJobs: scope.runningJobs,
        requested: spec.requested,
        ...(spec.resource === 'gpus' ? { typed: spec.gpuType !== undefined } : {}),
      };
    });
    return {
      entry,
      cpu: measured.find((measurement) => measurement.resource === 'cpus') ?? null,
      memory: measured.find((measurement) => measurement.resource === 'memoryMiB') ?? null,
      gpus: measured.filter((measurement) => measurement.resource === 'gpus'),
    };
  });
}

function assessConstraint(
  limit: number,
  requested: number | null,
  used: number | null,
  knownUsed: number
): AssociationLimitStatus {
  if (requested !== null && requested > limit) {
    return 'exceedsRequest';
  }
  if (requested === null) {
    return 'unknown';
  }
  // Known usage can prove a violation, but not headroom.
  if (knownUsed + requested > limit) {
    return 'usageExceeded';
  }
  return used === null ? 'unknown' : 'withinLimit';
}

function toConstraint(measurement: ResourceMeasurement): AssociationLimitConstraintDto {
  return {
    resource: measurement.resource,
    ...(measurement.gpuType !== undefined ? { gpuType: measurement.gpuType } : {}),
    limit: measurement.effectiveLimit,
    used: measurement.used,
    requested: measurement.requested,
    status: assessConstraint(
      measurement.effectiveLimit,
      measurement.requested,
      measurement.used,
      measurement.knownUsed
    ),
  };
}

function buildOverview(
  chain: readonly AssociationEntry[],
  levels: readonly LevelMeasurements[]
): AssociationOverviewDto {
  return {
    hierarchy: chain.map((entry, index) => {
      const level = levels[index]!;
      const constraints: AssociationLimitConstraintDto[] = [];
      if (level.cpu !== null) {
        constraints.push(toConstraint(level.cpu));
      }
      if (level.memory !== null) {
        constraints.push(toConstraint(level.memory));
      }
      for (const gpu of level.gpus) {
        constraints.push(toConstraint(gpu));
      }
      const parentEntry = chain[index + 1] ?? null;
      return {
        account: entry.account,
        ...(entry.user !== null ? { user: entry.user } : {}),
        ...(entry.partition !== null ? { partition: entry.partition } : {}),
        parent: parentEntry?.account ?? null,
        constraints,
      };
    }),
  };
}

async function analyzeAssocLimits(ctx: AnalyzerContext): Promise<LimitAnalysisDto | null> {
  return flagExceededLevels(await analyzeAssocReason(ctx));
}

async function analyzeAssocReason(ctx: AnalyzerContext): Promise<LimitAnalysisDto | null> {
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
  const isResourceReason =
    reason === 'AssocGrpMemLimit' || reason === 'AssocGrpCpuLimit' || reason === 'AssocGrpGRES';
  const requests = isResourceReason ? analysisRequests(ctx) : null;
  const levelMeasurements =
    requests === null
      ? null
      : buildLevelMeasurements(
          chain,
          assocStore,
          resolved,
          jobs,
          limitFactor,
          requests
        );
  const overview = levelMeasurements === null ? undefined : buildOverview(chain, levelMeasurements);
  const isRuntimeReason =
    reason === 'AssocGrpMemRunMinutes' ||
    reason === 'AssocGrpCPURunMinutesLimit' ||
    reason === 'AssocGrpGRESRunMinutes';
  const runtimeLevels = isRuntimeReason
    ? buildRuntimeLevelMeasurements(
        chain,
        assocStore,
        resolved,
        jobs,
        ctx.qos?.store ?? null,
        job.requested.gpus,
        runtimeProjections(ctx)
      )
    : null;
  const runtimeOverview =
    runtimeLevels === null ? undefined : buildRuntimeOverview(chain, runtimeLevels);

  switch (reason) {
    case 'AssocGrpMemLimit':
    case 'AssocGrpCpuLimit': {
      const isMem = reason === 'AssocGrpMemLimit';
      const metric: LimitMetric = isMem ? 'memoryMiB' : 'cpus';
      const requested = isMem ? requests!.memoryMiB : job.requested.cpus;
      if (requested === null) {
        return null;
      }
      const levels: ResourceMeasurement[] = [];
      for (const level of levelMeasurements!) {
        const measurement = isMem ? level.memory : level.cpu;
        if (measurement !== null) {
          levels.push(measurement);
        }
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
          limit: tightest.effectiveLimit,
          used: tightest.used,
          requested,
          account,
          user: job.user ?? undefined,
          runningJobs: tightest.runningJobs,
          hierarchy: buildHierarchy(chain, levels, null),
          associationOverview: overview,
        };
      }
      const limitingLevel = levels.find((level) => level.entry === limiting) as ResourceMeasurement;
      return {
        kind: 'limit',
        domain: 'association',
        metric,
        limit: limitingLevel.effectiveLimit,
        used: limitingLevel.used,
        requested,
        account,
        limitingAccount: limiting.account,
        user: job.user ?? undefined,
        runningJobs: limitingLevel.runningJobs,
        hierarchy: buildHierarchy(chain, levels, limiting),
        associationOverview: overview,
      };
    }
    case 'AssocGrpGRES': {
      const gpu = requestedGpuType(ctx);
      if (gpu === null) {
        return null;
      }
      const levels: ResourceMeasurement[] = [];
      for (const level of levelMeasurements!) {
        const candidates = level.gpus.filter(
          (candidate) =>
            candidate.gpuType === undefined ||
            (gpu.key !== 'gpu' && candidate.gpuType === gpu.display)
        );
        if (candidates.length > 0) {
          levels.push(pickBindingCandidate(candidates, gpu.count));
        }
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
          gpuType: tightest.typed ? gpu.display : undefined,
          limit: tightest.effectiveLimit,
          used: tightest.used,
          requested: gpu.count,
          account,
          user: job.user ?? undefined,
          runningJobs: tightest.runningJobs,
          hierarchy: buildHierarchy(chain, levels, null, gpu.display),
          associationOverview: overview,
        };
      }
      const limitingLevel = levels.find((level) => level.entry === limiting) as ResourceMeasurement;
      return {
        kind: 'limit',
        domain: 'association',
        metric: 'gpus',
        gpuType: limitingLevel.typed ? gpu.display : undefined,
        limit: limitingLevel.effectiveLimit,
        used: limitingLevel.used,
        requested: gpu.count,
        account,
        limitingAccount: limiting?.account ?? undefined,
        user: job.user ?? undefined,
        runningJobs: limitingLevel.runningJobs,
        hierarchy: buildHierarchy(chain, levels, limiting, gpu.display),
        associationOverview: overview,
      };
    }
    case 'AssocMaxJobsLimit': {
      if (job.user === null) {
        return null;
      }
      // MaxJobs applies per association, so the first defined entry up the
      // chain wins and sibling users do not count. GrpJobs is a separate limit.
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
      const maxJobsLevels: LevelMeasurement[] = chain
        .filter((entry) => entry.maxJobs !== null)
        .map((entry) => {
          const entryUsage = calculateAssociationEntryUserUsage(entry, assocStore, job.user as string, resolved, { jobs }, () => 1);
          return {
            entry,
            effectiveLimit: entry.maxJobs as number,
            used: entryUsage.unknown > 0 ? null : entryUsage.total,
            knownUsed: entryUsage.total,
            runningJobs: entryUsage.runningJobs,
          };
        });
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
        hierarchy: buildHierarchy(chain, maxJobsLevels, winner),
        topConsumers,
      };
    }
    case 'AssocGrpMemRunMinutes':
    case 'AssocGrpCPURunMinutesLimit':
    case 'AssocGrpGRESRunMinutes':
      return analyzeRuntimeReason(
        reason,
        ctx,
        chain,
        runtimeLevels as RuntimeLevelMeasurements[],
        runtimeOverview as RuntimeMinuteOverviewDto,
        account
      );
    default:
      return null;
  }
}

export { ASSOC_REASONS, analyzeAssocLimits, isAssocReason };
export type { AssocKind };
