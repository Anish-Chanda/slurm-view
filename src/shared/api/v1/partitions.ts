// Public v1 partitions contract: real Slurm partition names only.
// The client renders its own "All partitions" option, which omits the
// partition query parameter instead of naming a partition.
export interface PartitionsResponse {
  partitions: string[];
  updatedAt: string;
}
