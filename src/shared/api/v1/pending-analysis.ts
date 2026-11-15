// Pending-analysis API contract.
import type { JobState } from './jobs.js';

export interface PendingAnalysisResponse {
  stateReason: string | null;
  analysis: PendingAnalysisDto | null;
  updatedAt: string;
}

export type PendingAnalysisDto =
  | ResourcesAnalysisDto
  | PriorityAnalysisDto
  | DependencyAnalysisDto
  | LimitAnalysisDto
  | RequiredNodesAnalysisDto
  | PartitionAnalysisDto
  | ReservationAnalysisDto
  | ArrayThrottleAnalysisDto;

export type ResourceKind = 'cpus' | 'memoryMiB' | 'gpus';

export interface ResourceShortageDto {
  resource: ResourceKind;
  gpuType?: string;
  requested: number;
  currentlyUnallocated: number;
}

export interface ResourceNodeAnalysisDto {
  name: string;
  state: string | null;
  status: 'sufficient' | 'insufficient' | 'unknown';
  shortages: ResourceShortageDto[];
}

export interface ResourcesAnalysisDto {
  kind: 'resources';
  scope: 'partition' | 'scheduledNodes' | 'requestedNodes';
  analyzedNodes: number;
  sufficientNodes: number;
  insufficientNodes: number;
  unknownNodes: number;
  bottlenecks: Array<{
    resource: ResourceKind;
    gpuType?: string;
    nodes: number;
  }>;
  nodes: ResourceNodeAnalysisDto[];
}

export interface PriorityFactorDto {
  name: string;
  weighted: number | null;
  normalized: number | null;
  weight: number | null;
}

export interface PriorityAnalysisDto {
  kind: 'priority';
  partition: string;
  priority: number;
  factors: PriorityFactorDto[];
  pendingJobs: number;
  higherPriorityJobs: number;
  runningJobs: number;
  competitors: Array<{
    jobId: string;
    user: string | null;
    priority: number;
  }>;
}

export type DependencyStatus = 'satisfied' | 'unsatisfied' | 'unknown';

export interface DependencyTargetDto {
  jobId: string;
  state: JobState | null;
  exitCode: string | null;
  status: DependencyStatus;
  delayMinutes?: number;
  arrayWildcard?: boolean;
}

export interface DependencyClauseDto {
  type: string;
  status: DependencyStatus;
  jobs: DependencyTargetDto[];
}

export interface DependencyAnalysisDto {
  kind: 'dependency';
  expression: string;
  operator: 'and' | 'or' | 'single';
  status: DependencyStatus;
  dependencies: DependencyClauseDto[];
}

export type LimitMetric =
  | 'cpus'
  | 'memoryMiB'
  | 'nodes'
  | 'jobs'
  | 'gpus'
  | 'cpuMinutes'
  | 'memoryMiBMinutes'
  | 'gpuMinutes';

export type RuntimeMinuteMetric =
  | 'cpuMinutes'
  | 'memoryMiBMinutes'
  | 'gpuMinutes';

export type AssociationLimitStatus =
  // The whole request alone is above the configured limit.
  | 'exceedsRequest'
  // Known usage plus the request is above the configured limit.
  | 'usageExceeded'
  // Known usage plus the request fits.
  | 'withinLimit'
  // Missing usage or request information prevents a reliable assessment.
  | 'unknown';

export interface AssociationLimitConstraintDto {
  resource: ResourceKind;
  // GPU limits only: set for gres/gpu:<type>; absent for generic gres/gpu.
  gpuType?: string;
  limit: number;
  used: number | null;
  requested: number | null;
  status: AssociationLimitStatus;
}

export interface AssociationOverviewLevelDto {
  account: string;
  user?: string;
  partition?: string;
  parent: string | null;
  // CPU and memory have at most one constraint. GPU may carry both a generic
  // gres/gpu limit and one or more typed gres/gpu:<type> limits.
  constraints: AssociationLimitConstraintDto[];
}

export interface AssociationOverviewDto {
  hierarchy: AssociationOverviewLevelDto[];
}

export interface RuntimeMinuteConstraintDto {
  metric: RuntimeMinuteMetric;
  // GPU-minute constraints only: set for gres/gpu:<type>; absent for generic
  // gres/gpu, which counts every allocated GPU.
  gpuType?: string;
  // Configured GrpTRESRunMins budget, in the metric's units.
  limit: number;
  // Estimated resource-minutes committed by visible running jobs. Null when
  // an in-scope contributor cannot be quantified.
  committed: number | null;
  // Estimated resource-minutes the pending job would add. Null when the
  // request, a finite time limit, or the QOS UsageFactor is unavailable, unless
  // a zero resource amount or UsageFactor already proves zero commitment.
  projected: number | null;
  status: AssociationLimitStatus;
}

export interface RuntimeMinuteOverviewLevelDto {
  account: string;
  user?: string;
  partition?: string;
  parent: string | null;
  // CPU and memory have at most one constraint. GPU may carry both a generic
  // gres/gpu limit and one or more typed gres/gpu:<type> limits.
  constraints: RuntimeMinuteConstraintDto[];
}

export interface RuntimeMinuteOverviewDto {
  hierarchy: RuntimeMinuteOverviewLevelDto[];
}

export interface LimitAnalysisDto {
  kind: 'limit';
  domain: 'association' | 'qos';
  metric: LimitMetric;
  gpuType?: string;
  limit: number;
  used: number | null;
  requested: number | null;
  account?: string;
  limitingAccount?: string;
  qos?: string;
  user?: string;
  runningJobs?: number;
  hierarchy?: Array<{
    account: string;
    user?: string;
    partition?: string;
    // GPU limits only: set when this level's limit is scoped to one GPU type.
    // Absent for generic gres/gpu limits, which count every type.
    gpuType?: string;
    parent: string | null;
    limit: number | null;
    used: number | null;
    limiting: boolean;
    // The job's whole request is above this level's limit, so it can never start.
    exceedsLimit?: boolean;
  }>;
  // Present for association CPU, memory, and GPU reasons. The primary fields
  // above continue to describe only the resource Slurm reported.
  associationOverview?: AssociationOverviewDto;
  // Present for association runtime-minute reasons. Separate from
  // associationOverview because these are estimated resource-time commitments,
  // not instantaneous allocations.
  runtimeMinuteOverview?: RuntimeMinuteOverviewDto;
  topConsumers?: Array<{
    jobId: string;
    user: string | null;
    account: string | null;
    value: number;
  }>;
}

export interface RequiredNodesAnalysisDto {
  kind: 'requiredNodes';
  expression: string | null;
  nodes: Array<{
    name: string;
    state: string | null;
    reason: string | null;
  }>;
}

export interface PartitionAnalysisDto {
  kind: 'partition';
  partition: string;
  state: string | null;
  maxTimeSeconds: number | null;
  maxNodes: number | null;
  totalNodes: number | null;
}

export interface ReservationAnalysisDto {
  kind: 'reservation';
  name: string | null;
  state: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface ArrayThrottleAnalysisDto {
  kind: 'arrayThrottle';
  maxRunningTasks: number | null;
  runningTasks: number | null;
}
