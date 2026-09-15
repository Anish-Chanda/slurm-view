// Maps Slurm pending reasons to analyzers. Absent reasons yield
// analysis:null, never an error.
import type { AnalyzerContext, PendingAnalyzer } from './types.js';
import { analyzeResources } from './analyzers/resources.js';
import { analyzePriority } from './analyzers/priority.js';
import { analyzeDependency } from './analyzers/dependency.js';
import { analyzeAssocLimits } from './analyzers/association-limits.js';
import { analyzeQosLimits } from './analyzers/qos-limits.js';
import { analyzePartition, analyzeRequiredNodes, analyzeReservation } from './analyzers/scope.js';
import { analyzeArrayThrottle } from './analyzers/array.js';

const analyzers: Record<string, PendingAnalyzer> = {
  Resources: analyzeResources,
  Priority: analyzePriority,
  Dependency: analyzeDependency,
  DependencyNeverSatisfied: analyzeDependency,
  AssocGrpMemLimit: analyzeAssocLimits,
  AssocGrpCpuLimit: analyzeAssocLimits,
  AssocGrpGRES: analyzeAssocLimits,
  AssocMaxJobsLimit: analyzeAssocLimits,
  AssocGrpMemRunMinutes: analyzeAssocLimits,
  AssocGrpCPURunMinutesLimit: analyzeAssocLimits,
  QOSGrpCpuLimit: analyzeQosLimits,
  QOSGrpJobsLimit: analyzeQosLimits,
  QOSGrpMemLimit: analyzeQosLimits,
  QOSGrpNodeLimit: analyzeQosLimits,
  QOSMaxCpuPerUserLimit: analyzeQosLimits,
  QOSMaxJobsPerUserLimit: analyzeQosLimits,
  QOSMaxNodePerUserLimit: analyzeQosLimits,
  QOSMaxMemoryPerUser: analyzeQosLimits,
  ReqNodeNotAvail: analyzeRequiredNodes,
  PartitionDown: analyzePartition,
  PartitionInactive: analyzePartition,
  PartitionTimeLimit: analyzePartition,
  PartitionNodeLimit: analyzePartition,
  Reservation: analyzeReservation,
  JobArrayTaskLimit: analyzeArrayThrottle,
  // No rich analysis: BeginTime, JobHeldUser, JobHeldAdmin, InvalidQOS,
  // and any unknown/future Slurm reason.
};

function selectAnalyzer(reason: string | null): PendingAnalyzer | null {
  if (reason === null) {
    return null;
  }
  return analyzers[reason] ?? null;
}

export { analyzers, selectAnalyzer };
