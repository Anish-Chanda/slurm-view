// Public v1 pending-analysis contract.
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
  | 'memoryMiBMinutes';

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
    parent: string | null;
    limit: number | null;
    used: number | null;
    limiting: boolean;
  }>;
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
