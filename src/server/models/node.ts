const NODE_BASE_STATES = [
  'ALLOCATED',
  'DOWN',
  'ERROR',
  'FUTURE',
  'IDLE',
  'MIXED',
  'UNKNOWN',
] as const;

type NodeBaseState = (typeof NODE_BASE_STATES)[number];

// A down node is unavailable. A restricted node accepts no new work, but
// existing allocations continue. An available node is fully schedulable.
type NodeAvailability = 'down' | 'restricted' | 'available';

const HARD_DOWN_FLAGS: ReadonlySet<string> = new Set([
  'FAIL',
  'NOT_RESPONDING',
  'POWERED_DOWN',
  'POWERING_DOWN',
]);
const RESTRICTED_FLAGS: ReadonlySet<string> = new Set([
  'DRAIN',
  'DRAINED',
  'DRAINING',
  'FAILING',
]);

// ERROR blocks new scheduling while existing work drains from the node.
function nodeAvailability(state: NodeBaseState, flags: readonly string[]): NodeAvailability {
  if (state === 'DOWN' || state === 'FUTURE') {
    return 'down';
  }
  if (flags.some((flag) => HARD_DOWN_FLAGS.has(flag))) {
    return 'down';
  }
  if (state === 'ERROR' || flags.some((flag) => RESTRICTED_FLAGS.has(flag))) {
    return 'restricted';
  }
  if (state === 'UNKNOWN') {
    return 'down';
  }
  return 'available';
}

interface GpuInventory {
  total: number;
  allocated: number;
  byType: Record<string, { total: number; allocated: number }>;
}

// Memory fields use MiB. freeMemoryMiB is null when Slurm omits it.
// reason contains Slurm's node reason (for example, down or drained), or null.
interface ClusterNode {
  readonly name: string;
  readonly partitions: readonly string[];
  readonly state: NodeBaseState;
  readonly stateFlags: readonly string[];
  readonly reason: string | null;
  readonly cpus: number;
  readonly effectiveCpus: number;
  readonly allocCpus: number;
  readonly allocIdleCpus: number;
  readonly cpuLoad: number | null;
  readonly totalMemoryMiB: number;
  readonly allocMemoryMiB: number;
  readonly freeMemoryMiB: number | null;
  readonly gresRaw: string | null;
  readonly gresUsedRaw: string | null;
  readonly gpu: GpuInventory;
  readonly gpuInventoryKnown: boolean;
}

export { NODE_BASE_STATES, nodeAvailability };
export type { ClusterNode, GpuInventory, NodeAvailability, NodeBaseState };
