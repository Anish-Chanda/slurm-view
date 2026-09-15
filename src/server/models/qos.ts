// QOS policy fields for pending analysis (group/max limits, factors,
// Relative handling, job vs partition QOS).
import type { AssociationTres } from './association.js';
import { emptyTres } from './association.js';
import { UpstreamInvalidError } from '../adapters/slurm/errors.js';

type QosSource = 'job' | 'partition';

interface QosEntry {
  readonly name: string;
  readonly priority: number;
  readonly flags: ReadonlySet<string>;
  // Relative QOS limits are percentages of cluster/partition capacity, not
  // absolute counts.
  readonly relative: boolean;
  readonly grpTres: AssociationTres;
  readonly grpTresRunMins: AssociationTres;
  readonly grpJobs: number | null;
  readonly grpNodes: number | null;
  readonly maxTresPerUser: AssociationTres;
  readonly maxJobsPerUser: number | null;
  // Scales applicable association [Grp|Max]TRES limits (not QOS-own limits).
  readonly limitFactor: number | null;
  // Scales TRESMins/TRESRunMins usage for jobs running under this QOS.
  // Always known: unset means Slurm's default of 1, and the adapter
  // rejects malformed values.
  readonly usageFactor: number;
  // Set only by the actual UsageFactorSafe QOS flag.
  readonly usageFactorSafe: boolean;
}

interface QosStore {
  readonly byName: ReadonlyMap<string, QosEntry>;
}

interface EffectiveQos {
  readonly name: string;
  readonly source: QosSource;
  readonly entry: QosEntry | null;
}

function emptyQosEntry(name: string): QosEntry {
  return {
    name,
    priority: 0,
    flags: new Set(),
    relative: false,
    grpTres: emptyTres(),
    grpTresRunMins: emptyTres(),
    grpJobs: null,
    grpNodes: null,
    maxTresPerUser: emptyTres(),
    maxJobsPerUser: null,
    limitFactor: null,
    usageFactor: 1,
    usageFactorSafe: false,
  };
}

function buildQosStore(entries: QosEntry[]): QosStore {
  const byName = new Map<string, QosEntry>();
  for (const entry of entries) {
    if (byName.has(entry.name)) {
      throw new UpstreamInvalidError(
        `sacctmgr returned duplicate QOS name: ${entry.name}`
      );
    }
    byName.set(entry.name, entry);
  }
  return { byName };
}

function isRelativeQos(entry: QosEntry | null): boolean {
  return entry?.relative === true || entry?.flags.has('Relative') === true;
}

// Resolve the effective QOS: job QOS first, then partition QOS.
function resolveEffectiveQos(
  store: QosStore,
  selector: { jobQos: string | null; partitionQos: string | null }
): EffectiveQos | null {
  if (selector.jobQos !== null && selector.jobQos.length > 0) {
    return {
      name: selector.jobQos,
      source: 'job',
      entry: store.byName.get(selector.jobQos) ?? null,
    };
  }
  if (selector.partitionQos !== null && selector.partitionQos.length > 0) {
    return {
      name: selector.partitionQos,
      source: 'partition',
      entry: store.byName.get(selector.partitionQos) ?? null,
    };
  }
  return null;
}

export {
  buildQosStore,
  emptyQosEntry,
  isRelativeQos,
  resolveEffectiveQos,
};
export type { EffectiveQos, QosEntry, QosSource, QosStore };
