// Loads Slurm context and dispatches the analyzer for the current pending reason.
import { HttpError } from '../middleware/error-handler.js';
import { ProblemCode } from '../../shared/api/v1/common.js';
import type { PendingAnalysisDto } from '../../shared/api/v1/pending-analysis.js';
import type { SlurmContext } from '../adapters/slurm/context.js';
import { CommandError } from '../adapters/slurm/command-runner.js';
import { SlurmUpstreamError } from '../adapters/slurm/errors.js';
import { isMissingJobSignal } from './pending-analysis/missing-job.js';
import { fetchTargetedJob } from '../adapters/slurm/targeted-job.js';
import type { TargetedJob } from '../adapters/slurm/targeted-job.js';
import { fetchPartitionDetail, fetchPartitionTable } from '../adapters/slurm/partition-detail.js';
import type { JobsCache } from '../cache/jobs-cache.js';
import type { NodesCache } from '../cache/nodes-cache.js';
import type { AssocCache } from '../cache/assoc-cache.js';
import type { QosCache } from '../cache/qos-cache.js';
import type { SprioWeightsCache } from '../cache/sprio-weights-cache.js';
import type { AnalyzerContext } from './pending-analysis/types.js';
import { selectAnalyzer } from './pending-analysis/registry.js';
import {
  contradictionRefreshAllowed,
  markContradictionRefresh,
} from './pending-analysis/contradiction-cooldown.js';

interface PendingAnalysisDeps {
  slurmContext: SlurmContext;
  jobsCache: JobsCache;
  nodesCache?: NodesCache;
  assocCache?: AssocCache;
  qosCache?: QosCache;
  sprioWeightsCache?: SprioWeightsCache;
}

interface PendingAnalysisResult {
  stateReason: string | null;
  analysis: PendingAnalysisDto | null;
  updatedAt: Date;
}

const ASSOC_REASON_PREFIX = 'Assoc';
const QOS_REASON_PREFIX = 'QOS';
const PARTITION_REASON_PREFIX = 'Partition';

// Only Slurm's explicit missing-job messages are treated as not found.
function isNotFoundCommandError(error: unknown, jobId: string): boolean {
  if (!(error instanceof CommandError)) {
    return false;
  }
  const snippet = `${error.stderrSnippet ?? ''}\n${error.message ?? ''}`;
  return isMissingJobSignal(snippet, jobId);
}

function isMissingJobUpstreamError(error: unknown, jobId: string): boolean {
  if (!(error instanceof SlurmUpstreamError)) {
    return false;
  }
  return isMissingJobSignal(error.message, jobId);
}

function needsAssoc(reason: string | null): boolean {
  return reason !== null && reason.startsWith(ASSOC_REASON_PREFIX);
}

function needsQos(reason: string | null): boolean {
  return reason !== null && (reason.startsWith(QOS_REASON_PREFIX) || reason === 'QOSMaxMemoryPerUser');
}

function needsPartitionDetail(reason: string | null): boolean {
  return reason !== null && reason.startsWith(PARTITION_REASON_PREFIX);
}

function needsPartitionTable(reason: string | null): boolean {
  return needsQos(reason);
}

async function loadAssoc(deps: PendingAnalysisDeps, signal?: AbortSignal) {
  if (deps.assocCache === undefined) {
    return null;
  }
  return deps.assocCache.getOrLoad({ signal });
}

async function loadQos(deps: PendingAnalysisDeps, signal?: AbortSignal) {
  if (deps.qosCache === undefined) {
    return null;
  }
  return deps.qosCache.getOrLoad({ signal });
}

async function buildContext(
  deps: PendingAnalysisDeps,
  jobId: string,
  targeted: TargetedJob,
  signal?: AbortSignal
): Promise<AnalyzerContext> {
  const reason = targeted.job.stateReason;
  const [jobsSnapshot, nodesSnapshot, assoc, qos, sprioWeights] = await Promise.all([
    deps.jobsCache.getOrLoad({ signal }),
    (async () => {
      if (deps.nodesCache === undefined) {
        return null;
      }
      if (reason !== 'Resources' && reason !== 'ReqNodeNotAvail') {
        return null;
      }
      return deps.nodesCache.getOrLoad({ signal });
    })(),
    needsAssoc(reason) ? loadAssoc(deps, signal) : Promise.resolve(null),
    // Assoc reasons also need the QOS snapshot for LimitFactor and UsageFactor.
    needsQos(reason) || needsAssoc(reason) ? loadQos(deps, signal) : Promise.resolve(null),
    (async () => {
      if (reason !== 'Priority' || deps.sprioWeightsCache === undefined) {
        return null;
      }
      return deps.sprioWeightsCache.getOrLoad({ signal });
    })(),
  ]);
  let partitionDetail = null;
  let partitionQosName: string | null = null;
  if (needsPartitionDetail(reason) && targeted.job.partition !== null) {
    partitionDetail = await fetchPartitionDetail(deps.slurmContext, targeted.job.partition, { signal });
    partitionQosName = partitionDetail?.qos ?? null;
  }
  // QOS analysis needs the partition table to resolve partition-QOS precedence.
  let partitionTable = null;
  if (needsPartitionTable(reason)) {
    partitionTable = await fetchPartitionTable(deps.slurmContext, { signal });
    if (partitionDetail === null && targeted.job.partition !== null) {
      partitionDetail = partitionTable.find((entry) => entry.name === targeted.job.partition) ?? null;
      partitionQosName = partitionDetail?.qos ?? null;
    }
  }
  return {
    jobId,
    slurmContext: deps.slurmContext,
    targeted,
    job: targeted.job,
    jobsSnapshot,
    nodesSnapshot,
    assoc,
    qos,
    sprioWeights,
    partitionDetail,
    partitionQosName,
    partitionTable,
    signal,
  };
}

function isContradiction(analysis: PendingAnalysisDto | null): boolean {
  if (analysis === null || analysis.kind !== 'limit') {
    return false;
  }
  if (analysis.used === null || analysis.requested === null) {
    return false;
  }
  // Slurm blames this limit but cached policy and usage show headroom.
  return analysis.used + analysis.requested <= analysis.limit;
}

// Refresh the evidence behind a contradiction. A failed refresh keeps the
// original measurement.
interface RefreshOutcome {
  jobsOk: boolean;
  assocOk: boolean;
  qosOk: boolean;
}

async function refreshEvidenceForContradiction(
  deps: PendingAnalysisDeps,
  analysis: PendingAnalysisDto,
  signal?: AbortSignal
): Promise<RefreshOutcome> {
  // Aborts propagate instead of returning stale analysis.
  const track = async (work: Promise<unknown>): Promise<boolean> => {
    try {
      await work;
      return true;
    } catch (error) {
      if (signal?.aborted === true) {
        throw error;
      }
      if (error instanceof CommandError && error.kind === 'aborted') {
        throw error;
      }
      return false;
    }
  };
  const jobs = track(deps.jobsCache.refresh({ signal }));
  const assoc =
    analysis.kind === 'limit' && analysis.domain === 'association' && deps.assocCache !== undefined
      ? track(deps.assocCache.refresh({ signal }))
      : Promise.resolve(true);
  // Association limits also scale by QOS LimitFactor/UsageFactor.
  const qos =
    analysis.kind === 'limit' && deps.qosCache !== undefined
      ? track(deps.qosCache.refresh({ signal }))
      : Promise.resolve(true);
  const [jobsOk, assocOk, qosOk] = await Promise.all([jobs, assoc, qos]);
  return { jobsOk, assocOk, qosOk };
}

function refreshSucceededFor(outcome: RefreshOutcome, analysis: PendingAnalysisDto): boolean {
  if (!outcome.jobsOk || !outcome.qosOk) {
    return false;
  }
  if (analysis.kind === 'limit' && analysis.domain === 'association' && !outcome.assocOk) {
    return false;
  }
  return true;
}

class PendingAnalysisService {
  constructor(private readonly deps: PendingAnalysisDeps) {}

  async analyze(
    jobId: string,
    options: { signal?: AbortSignal; nowMs?: number } = {}
  ): Promise<PendingAnalysisResult> {
    const { signal, nowMs } = options;
    let targeted: TargetedJob | null;
    try {
      targeted = await fetchTargetedJob(this.deps.slurmContext, jobId, { signal });
    } catch (error) {
      if (isNotFoundCommandError(error, jobId) || isMissingJobUpstreamError(error, jobId)) {
        throw new HttpError(
          ProblemCode.NotFound,
          `Job ${jobId} is no longer available in the live scheduler data. Historical accounting is not queried.`
        );
      }
      throw error;
    }
    if (targeted === null) {
      throw new HttpError(
        ProblemCode.NotFound,
        `Job ${jobId} is no longer available in the live scheduler data. Historical accounting is not queried.`
      );
    }
    if (targeted.job.state !== 'PENDING') {
      throw new HttpError(
        ProblemCode.JobNotPending,
        `Job ${jobId} is no longer pending (current state: ${targeted.job.state}).`
      );
    }
    const reason = targeted.job.stateReason;
    const analyzer = selectAnalyzer(reason);
    // updatedAt always means final response production time, on every path.
    if (analyzer === null) {
      return { stateReason: reason, analysis: null, updatedAt: new Date() };
    }
    const ctx = await buildContext(this.deps, jobId, targeted, signal);
    const first = await analyzer(ctx);
    if (!isContradiction(first)) {
      return { stateReason: reason, analysis: first, updatedAt: new Date() };
    }
    // Refresh once per cooldown window; a failed refresh keeps the original
    // measurement instead of recomputing from the same stale data.
    const asserted = first as PendingAnalysisDto;
    const key = asserted.kind === 'limit' ? asserted.domain : 'other';
    const now = nowMs ?? Date.now();
    if (!contradictionRefreshAllowed(key, now)) {
      return { stateReason: reason, analysis: first, updatedAt: new Date() };
    }
    markContradictionRefresh(key, now);
    const outcome = await refreshEvidenceForContradiction(this.deps, asserted, signal);
    if (!refreshSucceededFor(outcome, asserted)) {
      return { stateReason: reason, analysis: first, updatedAt: new Date() };
    }
    const retry = await buildContext(this.deps, jobId, targeted, signal);
    const second = await analyzer(retry);
    return { stateReason: reason, analysis: second, updatedAt: new Date() };
  }
}

export { PendingAnalysisService };
export type { PendingAnalysisDeps, PendingAnalysisResult };
