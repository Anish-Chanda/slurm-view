import { fetchNodes } from '../adapters/slurm/nodes.js';
import type { SlurmContext } from '../adapters/slurm/context.js';
import type { ClusterNode } from '../models/node.js';
import { TtlDataCache } from './ttl-data-cache.js';

interface NodeSnapshot {
  nodes: readonly ClusterNode[];
  capturedAt: Date;
}

// Lazy TTL with on-demand refresh; node JSON is the heaviest Slurm call.
const NODES_TTL_MS = 15_000;

function createNodeSnapshot(nodes: ClusterNode[], capturedAt: Date = new Date()): NodeSnapshot {
  return { nodes: [...nodes], capturedAt };
}

interface NodesCacheOptions {
  ttlMs?: number;
}

class NodesCache {
  private readonly snapshots: TtlDataCache<NodeSnapshot>;

  constructor(
    private readonly context: SlurmContext,
    options: NodesCacheOptions = {}
  ) {
    this.snapshots = new TtlDataCache<NodeSnapshot>(
      options.ttlMs ?? NODES_TTL_MS,
      (signal) => this.load(signal)
    );
  }

  getOrLoad(options: { signal?: AbortSignal } = {}): Promise<NodeSnapshot> {
    return this.snapshots.getOrLoad(options);
  }

  peek(): NodeSnapshot | undefined {
    return this.snapshots.peek();
  }

  invalidate(): void {
    this.snapshots.invalidate();
  }

  private async load(signal?: AbortSignal): Promise<NodeSnapshot> {
    const nodes = await fetchNodes(this.context, { signal });
    return createNodeSnapshot(nodes);
  }
}

export { NODES_TTL_MS, NodesCache, createNodeSnapshot };
export type { NodeSnapshot, NodesCacheOptions };
