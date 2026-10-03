import type { JobBaseState, TimeLimit, AllocatedJobResources } from './job.js';

/** Minimal scheduler data retained from the queue-wide squeue snapshot. */
interface QueueJob {
  readonly id: string;
  readonly jobId: string;
  readonly arrayJobId: string | null;
  readonly arrayTaskId: string | null;
  readonly partition: string | null;
  readonly name: string | null;
  readonly user: string | null;
  readonly account: string | null;
  readonly qos: string | null;
  readonly state: JobBaseState;
  readonly stateFlags: readonly string[];
  readonly stateReason: string | null;
  readonly timeLimit: TimeLimit;
  readonly submitTime: Date | null;
  readonly startTime: Date | null;
  readonly endTime: Date | null;
  readonly priority: number | null;
  readonly nodeCount: number | null;
  readonly nodeExpression: string | null;
  readonly allocated: AllocatedJobResources;
  readonly exitCode: string | null;
}

export type { QueueJob };
