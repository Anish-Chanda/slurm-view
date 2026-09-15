// Normalized single-partition fact record (state, time/node caps).
interface PartitionDetail {
  readonly name: string;
  readonly state: string | null;
  readonly maxTimeSeconds: number | null;
  readonly maxNodes: number | null;
  readonly totalNodes: number | null;
  // Configured QOS attached to this partition (slurm.conf QOS=), if any.
  readonly qos: string | null;
}

export type { PartitionDetail };
