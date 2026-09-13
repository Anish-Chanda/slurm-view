// Checks whether the job's resource request fits candidate nodes, using
// currently-unallocated capacity. Aggregate CPU/GPU requests are only
// per-node for single-node jobs; CPU capacity uses effectiveCpus.
import { expandSlurmHostlist } from '../../../adapters/slurm/hostlist.js';
import type { MemoryRequirement } from '../../../adapters/slurm/targeted-job.js';
import type { AnalyzerContext } from '../types.js';
import type { ClusterNode } from '../../../models/node.js';
import type {
  ResourceKind,
  ResourceNodeAnalysisDto,
  ResourcesAnalysisDto,
} from '../../../../shared/api/v1/pending-analysis.js';

const NODE_DETAIL_CAP = 50;

interface NodeCapacity {
  cpus: number;
  memoryMiB: number;
  // Null when the node reported no GPU inventory data at all.
  gpuTotal: number | null;
  gpuByType: Readonly<Record<string, number>>;
  gpuKnown: boolean;
}

function nodeCapacity(node: ClusterNode): NodeCapacity {
  const gpuByType: Record<string, number> = {};
  for (const [type, inventory] of Object.entries(node.gpu.byType)) {
    gpuByType[type] = Math.max(0, inventory.total - inventory.allocated);
  }
  const gpuKnown = node.gpuInventoryKnown;
  return {
    // Effective set minus allocated; configured CPUs outside the effective
    // set are not usable.
    cpus: Math.max(0, node.effectiveCpus - node.allocCpus),
    memoryMiB: Math.max(0, node.totalMemoryMiB - node.allocMemoryMiB),
    gpuTotal: gpuKnown ? Math.max(0, node.gpu.total - node.gpu.allocated) : null,
    gpuByType,
    gpuKnown,
  };
}

// Per-node memory requirement, or null when the mode/placement has no
// valid conversion.
function perNodeMemory(
  memory: MemoryRequirement,
  requestedNodes: number | null,
  totalCpus: number | null,
  totalGpus: number | null
): number | null {
  const singleNode = requestedNodes === 1;
  switch (memory.kind) {
    case 'perNode':
      return memory.memoryMiB;
    case 'perCpu':
      // Single-node: every requested CPU lands on the one node.
      if (singleNode && totalCpus !== null && totalCpus > 0) {
        return memory.memoryMiB * totalCpus;
      }
      return null;
    case 'perGpu':
      if (singleNode && totalGpus !== null && totalGpus > 0) {
        return memory.memoryMiB * totalGpus;
      }
      return null;
    case 'unknown': {
      // Aggregate memory counts per-node only for a single-node job.
      if (singleNode && memory.memoryMiB !== null) {
        return memory.memoryMiB;
      }
      return null;
    }
  }
}

async function analyzeResources(ctx: AnalyzerContext): Promise<ResourcesAnalysisDto | null> {
  const { targeted, nodesSnapshot } = ctx;
  const job = targeted.job;
  if (nodesSnapshot === null) {
    return null;
  }
  const schedNames =
    targeted.schedNodeList !== null ? expandSlurmHostlist(targeted.schedNodeList) : [];
  const reqNames =
    targeted.reqNodeList !== null ? expandSlurmHostlist(targeted.reqNodeList) : [];
  let scope: ResourcesAnalysisDto['scope'];
  let candidateNames: string[];
  if (schedNames.length > 0) {
    scope = 'scheduledNodes';
    candidateNames = schedNames;
  } else if (reqNames.length > 0) {
    scope = 'requestedNodes';
    candidateNames = reqNames;
  } else if (job.partition !== null) {
    scope = 'partition';
    candidateNames = nodesSnapshot.nodes
      .filter((node) => node.partitions.includes(job.partition as string))
      .map((node) => node.name);
  } else {
    return null;
  }
  // Unknown snapshot entries are still counted.
  const byName = new Map(nodesSnapshot.nodes.map((node) => [node.name, node]));
  const requestedNodes = job.requested.nodes ?? targeted.requestedNodes ?? null;
  const singleNode = requestedNodes === 1;
  // Aggregate CPU/GPU requests convert to per-node for single-node jobs only.
  const needCpus = singleNode ? job.requested.cpus : null;
  const needMem = perNodeMemory(
    targeted.memory,
    requestedNodes,
    job.requested.cpus,
    job.requested.gpus.total > 0 ? job.requested.gpus.total : null
  );
  const needGpuTotal =
    singleNode && job.requested.gpus.total > 0 ? job.requested.gpus.total : null;
  const needGpuByType: Record<string, number> = {};
  if (singleNode) {
    for (const [type, count] of Object.entries(job.requested.gpus.byType)) {
      if (type !== 'unknown' && count > 0) {
        needGpuByType[type] = count;
      }
    }
  }
  // A proven shortage marks insufficient even when another dimension is
  // unknown; "sufficient" requires every requested dimension evaluated
  // with no shortage.
  const cpuRequested = job.requested.cpus !== null;
  // ReqTRES can omit memory that scontrol reports via MinMemory*, so both
  // sources count as requested.
  const memRequested =
    job.requested.memoryMiB !== null ||
    targeted.memory.kind !== 'unknown' ||
    targeted.memory.memoryMiB !== null;
  const gpuRequested = job.requested.gpus.total > 0 || Object.keys(needGpuByType).length > 0;
  const gpuEvaluated = needGpuTotal !== null || Object.keys(needGpuByType).length > 0;
  if (!cpuRequested && !memRequested && !gpuRequested) {
    return null;
  }
  if (needCpus === null && needMem === null && !gpuEvaluated) {
    return null;
  }
  const details: ResourceNodeAnalysisDto[] = [];
  let sufficient = 0;
  let insufficient = 0;
  let unknown = 0;
  const bottleneckCounts = new Map<string, number>();
  for (const name of candidateNames) {
    const node = byName.get(name) ?? null;
    if (node === null) {
      unknown += 1;
      details.push({ name, state: null, status: 'unknown', shortages: [] });
      continue;
    }
    const capacity = nodeCapacity(node);
    const shortages: ResourceNodeAnalysisDto['shortages'] = [];
    let dimensionsUnknown = false;
    if (needCpus !== null && capacity.cpus < needCpus) {
      shortages.push({ resource: 'cpus', requested: needCpus, currentlyUnallocated: capacity.cpus });
    }
    if (needMem !== null && capacity.memoryMiB < needMem) {
      shortages.push({ resource: 'memoryMiB', requested: needMem, currentlyUnallocated: capacity.memoryMiB });
    }
    if (memRequested && needMem === null) {
      dimensionsUnknown = true;
    }
    if (cpuRequested && needCpus === null) {
      dimensionsUnknown = true;
    }
    const typedKeys = Object.keys(needGpuByType);
    if (typedKeys.length > 0) {
      for (const type of typedKeys) {
        const need = needGpuByType[type] ?? 0;
        // A node with no GPU inventory data cannot evaluate a GPU request.
        const free = capacity.gpuKnown ? (capacity.gpuByType[type] ?? 0) : null;
        if (free === null) {
          dimensionsUnknown = true;
        } else if (free < need) {
          shortages.push({
            resource: 'gpus',
            gpuType: type,
            requested: need,
            currentlyUnallocated: free,
          });
        }
      }
    } else if (needGpuTotal !== null) {
      if (capacity.gpuTotal === null) {
        dimensionsUnknown = true;
      } else if (capacity.gpuTotal < needGpuTotal) {
        shortages.push({ resource: 'gpus', requested: needGpuTotal, currentlyUnallocated: capacity.gpuTotal });
      }
    } else if (gpuRequested) {
      dimensionsUnknown = true;
    }
    if (shortages.length > 0) {
      insufficient += 1;
      for (const shortage of shortages) {
        const key: string = shortage.gpuType !== undefined ? `gpus:${shortage.gpuType}` : shortage.resource;
        bottleneckCounts.set(key, (bottleneckCounts.get(key) ?? 0) + 1);
      }
      details.push({ name, state: node.state, status: 'insufficient', shortages });
    } else if (dimensionsUnknown) {
      unknown += 1;
      details.push({ name, state: node.state, status: 'unknown', shortages: [] });
    } else {
      sufficient += 1;
      details.push({ name, state: node.state, status: 'sufficient', shortages: [] });
    }
  }
  const bottlenecks: ResourcesAnalysisDto['bottlenecks'] = [...bottleneckCounts.entries()].map(
    ([key, nodes]) => {
      if (key.startsWith('gpus:')) {
        return { resource: 'gpus' as ResourceKind, gpuType: key.slice(5), nodes };
      }
      return { resource: key as ResourceKind, nodes };
    }
  );
  bottlenecks.sort((a, b) => b.nodes - a.nodes);
  // Insufficient rows first so the detail cap keeps them.
  details.sort((a, b) => {
    const rank = (status: string): number =>
      status === 'insufficient' ? 0 : status === 'unknown' ? 1 : 2;
    return rank(a.status) - rank(b.status);
  });
  return {
    kind: 'resources',
    scope,
    analyzedNodes: candidateNames.length,
    sufficientNodes: sufficient,
    insufficientNodes: insufficient,
    unknownNodes: unknown,
    bottlenecks,
    nodes: details.slice(0, NODE_DETAIL_CAP),
  };
}

export { NODE_DETAIL_CAP, analyzeResources, perNodeMemory };
