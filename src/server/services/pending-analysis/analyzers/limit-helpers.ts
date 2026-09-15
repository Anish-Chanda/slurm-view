// Shared helpers for the association/QOS limit analyzers.
import type { AnalyzerContext } from '../types.js';
import type { EffectiveQos, QosEntry } from '../../../models/qos.js';
import { resolveJobAndPartitionQos } from '../policy.js';

const TOP_CONSUMERS_CAP = 10;

function requestedGpuType(ctx: AnalyzerContext): { key: string; display: string; count: number } | null {
  const byType = ctx.targeted.job.requested.gpus;
  const typed = Object.entries(byType.byType).filter(([type, count]) => type !== 'unknown' && count > 0);
  // Several typed requests do not fit the single-gpuType contract.
  if (typed.length > 1) {
    return null;
  }
  if (typed.length === 1) {
    const [type, count] = typed[0] as [string, number];
    return { key: `gpu:${type}`, display: type, count };
  }
  if (byType.total > 0) {
    return { key: 'gpu', display: 'gpu', count: byType.total };
  }
  return null;
}

// Memory total for TRES memory limits. ReqTRES already carries the total;
// MinMemory flavors need their multiplier (node count, total CPUs, or
// total GPUs) or the result is null.
function aggregateMemoryRequest(ctx: AnalyzerContext): number | null {
  const job = ctx.targeted.job;
  if (job.requested.memoryMiB !== null) {
    return job.requested.memoryMiB;
  }
  const memory = ctx.targeted.memory;
  switch (memory.kind) {
    case 'perNode': {
      const nodes = job.requested.nodes ?? ctx.targeted.requestedNodes;
      if (nodes !== null && nodes > 0) {
        return memory.memoryMiB * nodes;
      }
      return null;
    }
    case 'perCpu':
      if (job.requested.cpus !== null && job.requested.cpus > 0) {
        return memory.memoryMiB * job.requested.cpus;
      }
      return null;
    case 'perGpu': {
      const gpus = job.requested.gpus.total > 0 ? job.requested.gpus.total : null;
      if (gpus !== null) {
        return memory.memoryMiB * gpus;
      }
      return null;
    }
    case 'unknown':
      return null;
  }
}

// Effective-QOS selection: partition QOS first, then job QOS, reversed by
// OverPartQOS. The partition QOS name comes from the single detail first,
// then the cluster table.
function pickEffectiveQosEntry(
  ctx: AnalyzerContext,
  metricDefined: (entry: QosEntry) => boolean
): EffectiveQos | null {
  const tableQos =
    ctx.partitionDetail?.qos
    ?? ctx.partitionTable?.find((entry) => entry.name === ctx.targeted.job.partition)?.qos
    ?? null;
  const detailForResolution =
    ctx.partitionDetail
    ?? (tableQos !== null && ctx.targeted.job.partition !== null
      ? { name: ctx.targeted.job.partition, state: null, maxTimeSeconds: null, maxNodes: null, totalNodes: null, qos: tableQos }
      : null);
  const { job, partition } = resolveJobAndPartitionQos(
    ctx.qos?.store ?? null,
    ctx.targeted.job.qos,
    detailForResolution
  );
  const candidates = [partition, job].filter(
    (candidate): candidate is EffectiveQos => candidate !== null
  );
  const overPart = job?.entry?.flags.has('OverPartQOS') === true;
  const ordered = overPart ? [...candidates].reverse() : candidates;
  for (const candidate of ordered) {
    if (candidate.entry !== null && metricDefined(candidate.entry)) {
      return candidate;
    }
  }
  return null;
}

export {
  TOP_CONSUMERS_CAP,
  aggregateMemoryRequest,
  pickEffectiveQosEntry,
  requestedGpuType,
};
