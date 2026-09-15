// Association/QOS policy helpers: effective TRES limits with QOS
// LimitFactor, job-vs-partition QOS resolution, Relative-QOS guard.
import type { AssociationStore } from '../../models/association.js';
import { ancestorChainById, applyLimitFactor, resolveAssociation } from '../../models/association.js';
import type { EffectiveQos, QosStore } from '../../models/qos.js';
import { isRelativeQos } from '../../models/qos.js';
import type { PartitionDetail } from '../../models/partition.js';

interface EffectiveTresEvaluation {
  readonly rawLimit: number | null;
  readonly effectiveLimit: number | null;
  readonly factored: boolean;
}

// LimitFactor scales association [Grp|Max]TRES counts. QOS-own limits,
// job counts, wall time, and TRES-minutes pass through unscaled.
function effectiveAssocTresLimit(
  rawLimit: number | null,
  limitFactor: number | null
): EffectiveTresEvaluation {
  if (rawLimit === null) {
    return { rawLimit: null, effectiveLimit: null, factored: false };
  }
  if (limitFactor === null || !Number.isFinite(limitFactor) || limitFactor <= 0) {
    return { rawLimit, effectiveLimit: rawLimit, factored: false };
  }
  return { rawLimit, effectiveLimit: applyLimitFactor(rawLimit, limitFactor), factored: true };
}

interface JobQosResolution {
  readonly job: EffectiveQos | null;
  readonly partition: EffectiveQos | null;
}

function resolveJobAndPartitionQos(
  store: QosStore | null,
  jobQos: string | null,
  partitionDetail: PartitionDetail | null
): JobQosResolution {
  const partitionQosName = partitionDetail?.qos ?? null;
  if (store === null) {
    return {
      job: jobQos !== null ? { name: jobQos, source: 'job', entry: null } : null,
      partition:
        partitionQosName !== null
          ? { name: partitionQosName, source: 'partition', entry: null }
          : null,
    };
  }
  return {
    job:
      jobQos !== null
        ? { name: jobQos, source: 'job', entry: store.byName.get(jobQos) ?? null }
        : null,
    partition:
      partitionQosName !== null
        ? {
            name: partitionQosName,
            source: 'partition',
            entry: store.byName.get(partitionQosName) ?? null,
          }
        : null,
  };
}

// Relative QOS limits are percentages of capacity, not absolute counts.
function blocksNumericAnalysis(entry: EffectiveQos['entry']): boolean {
  return isRelativeQos(entry ?? null);
}

export {
  blocksNumericAnalysis,
  effectiveAssocTresLimit,
  resolveJobAndPartitionQos,
};
export { ancestorChainById, resolveAssociation };
export type { EffectiveTresEvaluation, JobQosResolution };
