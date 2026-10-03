// Partitions API contract. The client represents "All partitions" by omitting
// the partition query parameter.
export interface PartitionsResponse {
  partitions: string[];
  updatedAt: string;
}
