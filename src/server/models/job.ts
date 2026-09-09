const JOB_BASE_STATES = [
  'BOOT_FAIL',
  'CANCELLED',
  'COMPLETED',
  'DEADLINE',
  'FAILED',
  'NODE_FAIL',
  'OUT_OF_MEMORY',
  'PENDING',
  'PREEMPTED',
  'RUNNING',
  'SUSPENDED',
  'TIMEOUT',
  'UNKNOWN',
] as const;

type JobBaseState = (typeof JOB_BASE_STATES)[number];

const JOB_STATE_FLAGS = [
  'COMPLETING',
  'CONFIGURING',
  'EXPEDITING',
  'LAUNCH_FAILED',
  'POWER_UP_NODE',
  'RECONFIG_FAIL',
  'REQUEUED',
  'REQUEUE_FED',
  'REQUEUE_HOLD',
  'RESIZING',
  'RESV_DEL_HOLD',
  'REVOKED',
  'SIGNALING',
  'SPECIAL_EXIT',
  'STAGE_OUT',
  'STOPPED',
  'UPDATE_DB',
] as const;

type JobStateFlag = (typeof JOB_STATE_FLAGS)[number];

type TimeLimit = { kind: 'finite'; seconds: number } | { kind: 'infinite' } | null;

interface GpuRequest {
  total: number;
  byType: Record<string, number>;
}

interface JobResources {
  cpus: number | null;
  memoryMiB: number | null;
  gpus: GpuRequest;
}

interface AllocatedJobResources extends JobResources {
  nodes: number | null;
}

interface Job {
  // "<arrayJobId>_<arrayTaskId>" for array tasks, else the Slurm job id.
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
  readonly nodeCount: number | null;
  readonly nodeExpression: string | null;
  readonly requested: JobResources;
  readonly allocated: AllocatedJobResources;
  readonly workdir: string | null;
  readonly command: string | null;
  readonly stdoutPath: string | null;
  readonly dependency: string | null;
  readonly exitCode: string | null;
  readonly derivedExitCode: string | null;
  readonly flags: readonly string[];
}

export type {
  AllocatedJobResources,
  GpuRequest,
  Job,
  JobBaseState,
  JobResources,
  JobStateFlag,
  TimeLimit,
};
export { JOB_BASE_STATES, JOB_STATE_FLAGS };
