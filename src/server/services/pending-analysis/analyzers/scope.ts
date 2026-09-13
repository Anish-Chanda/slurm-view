// Required-node state, partition facts, and reservation facts.
import { expandSlurmHostlist } from '../../../adapters/slurm/hostlist.js';
import { fetchPartitionDetail } from '../../../adapters/slurm/partition-detail.js';
import { fetchReservationDetail } from '../../../adapters/slurm/reservation.js';
import type { AnalyzerContext } from '../types.js';
import type {
  PartitionAnalysisDto,
  RequiredNodesAnalysisDto,
  ReservationAnalysisDto,
} from '../../../../shared/api/v1/pending-analysis.js';

function toIso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

// Beyond the cap a partial node list would look complete.
const REQUIRED_NODES_CAP = 100;

async function analyzeRequiredNodes(ctx: AnalyzerContext): Promise<RequiredNodesAnalysisDto | null> {
  const expression = ctx.targeted.reqNodeList;
  if (expression === null) {
    return null;
  }
  const names = expandSlurmHostlist(expression);
  if (names.length === 0) {
    return { kind: 'requiredNodes', expression, nodes: [] };
  }
  if (names.length > REQUIRED_NODES_CAP) {
    return null;
  }
  // Snapshot only; names absent from it are reported unknown.
  const byName = new Map((ctx.nodesSnapshot?.nodes ?? []).map((node) => [node.name, node]));
  return {
    kind: 'requiredNodes',
    expression,
    nodes: names.map((name) => {
      const node = byName.get(name) ?? null;
      if (node === null) {
        return { name, state: null, reason: null };
      }
      const state =
        node.stateFlags.length > 0 ? `${node.state}+${node.stateFlags.join(',')}` : node.state;
      return { name, state, reason: node.reason };
    }),
  };
}

async function analyzePartition(ctx: AnalyzerContext): Promise<PartitionAnalysisDto | null> {
  const job = ctx.targeted.job;
  if (job.partition === null) {
    return null;
  }
  // Prefer the service-resolved detail; fetch directly only when the
  // service skipped it. Upstream failures propagate.
  let detail = ctx.partitionDetail;
  if (detail === null || detail.name !== job.partition) {
    detail = await fetchPartitionDetail(ctx.slurmContext, job.partition, { signal: ctx.signal });
  }
  return {
    kind: 'partition',
    partition: job.partition,
    state: detail?.state ?? null,
    maxTimeSeconds: detail?.maxTimeSeconds ?? null,
    maxNodes: detail?.maxNodes ?? null,
    totalNodes: detail?.totalNodes ?? null,
  };
}

async function analyzeReservation(ctx: AnalyzerContext): Promise<ReservationAnalysisDto | null> {
  const job = ctx.targeted.job;
  // Reservation name "Unknown"/null means Slurm gave no usable reference.
  // Lookup failures propagate; only a clean miss yields name-only evidence.
  const raw = job.reservation;
  if (raw === null) {
    return { kind: 'reservation', name: null, state: null, startTime: null, endTime: null };
  }
  const detail: { name: string; state: string | null; startTime: Date | null; endTime: Date | null } | null =
    await fetchReservationDetail(ctx.slurmContext, raw, { signal: ctx.signal });
  if (detail === null) {
    return { kind: 'reservation', name: raw, state: null, startTime: null, endTime: null };
  }
  return {
    kind: 'reservation',
    name: detail.name,
    state: detail.state,
    startTime: toIso(detail.startTime),
    endTime: toIso(detail.endTime),
  };
}

export { REQUIRED_NODES_CAP, analyzePartition, analyzeRequiredNodes, analyzeReservation };
