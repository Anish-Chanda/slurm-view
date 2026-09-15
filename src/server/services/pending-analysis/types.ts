// Internal types for pending analysis. Public DTOs live in
// src/shared/api/v1/pending-analysis.ts.
import type { Job } from '../../models/job.js';
import type { JobSnapshot } from '../../cache/jobs-cache.js';
import type { NodeSnapshot } from '../../cache/nodes-cache.js';
import type { TargetedJob } from '../../adapters/slurm/targeted-job.js';
import type { AssocSnapshot } from '../../adapters/slurm/sacctmgr-assoc.js';
import type { QosSnapshot } from '../../adapters/slurm/sacctmgr-qos.js';
import type { SprioWeightsSnapshot } from '../../cache/sprio-weights-cache.js';
import type { PartitionDetail } from '../../models/partition.js';
import type { PendingAnalysisDto } from '../../../shared/api/v1/pending-analysis.js';

import type { SlurmContext } from '../../adapters/slurm/context.js';
interface AnalyzerContext {
  readonly jobId: string;
  readonly slurmContext: SlurmContext;
  readonly targeted: TargetedJob;
  readonly job: Job;
  readonly jobsSnapshot: JobSnapshot;
  readonly nodesSnapshot: NodeSnapshot | null;
  readonly assoc: AssocSnapshot | null;
  readonly qos: QosSnapshot | null;
  readonly sprioWeights: SprioWeightsSnapshot | null;
  readonly partitionDetail: PartitionDetail | null;
  readonly partitionQosName: string | null;
  // Partition table for partition-QOS resolution. Null when not needed.
  readonly partitionTable: readonly PartitionDetail[] | null;
  readonly signal?: AbortSignal;
}

type PendingAnalyzer = (ctx: AnalyzerContext) => Promise<PendingAnalysisDto | null>;

export type { AnalyzerContext, PendingAnalyzer };
