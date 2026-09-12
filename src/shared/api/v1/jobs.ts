// Public v1 jobs contract: pure types, camelCase, explicit units, ISO timestamps.
// JOB_STATES is the closed normalized state vocabulary shared by server and client.
export const JOB_STATES = [
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

export type JobState = (typeof JOB_STATES)[number];

export type TimeLimitDto = { kind: 'finite'; seconds: number } | { kind: 'infinite' } | null;

export interface GpuBreakdownDto {
  total: number;
  byType: Record<string, number>;
}

export interface RequestedResourcesDto {
  cpus: number | null;
  memoryMiB: number | null;
  nodes: number | null;
  gpus: GpuBreakdownDto;
}

export interface AllocatedResourcesDto extends RequestedResourcesDto {
  nodes: number | null;
}

export interface JobDto {
  id: string;
  jobId: string;
  arrayJobId: string | null;
  arrayTaskId: string | null;
  partition: string | null;
  name: string | null;
  user: string | null;
  account: string | null;
  qos: string | null;
  state: JobState;
  stateFlags: string[];
  stateReason: string | null;
  timeLimit: TimeLimitDto;
  submitTime: string | null;
  eligibleTime: string | null;
  startTime: string | null;
  endTime: string | null;
  priority: number | null;
  taskCount: number | null;
  cpusPerTask: number | null;
  constraints: string | null;
  reservation: string | null;
  nodeCount: number | null;
  nodeExpression: string | null;
  requested: RequestedResourcesDto;
  allocated: AllocatedResourcesDto;
  workdir: string | null;
  command: string | null;
  stdoutPath: string | null;
  stderrPath: string | null;
  dependency: string | null;
  exitCode: string | null;
  derivedExitCode: string | null;
  wckey: string | null;
  batchHost: string | null;
  flags: string[];
}

export interface JobsPaginationDto {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface JobsResponse {
  jobs: JobDto[];
  pagination: JobsPaginationDto;
  updatedAt: string;
}

// Detail reuses JobDto so list and page share one normalization path.
export interface JobDetailsResponse {
  job: JobDto;
  updatedAt: string;
}

// Canonical IDs the jobs API can emit: a job id, or an array task id.
// Step suffixes (".batch", ".extern", ".0") are not part of this space.
export const CANONICAL_JOB_ID_PATTERN = /^[0-9]+(_[0-9]+)?$/;

export const JOBS_PAGE_DEFAULT = 1;
export const JOBS_PAGE_SIZE_DEFAULT = 20;
export const JOBS_PAGE_SIZE_MAX = 100;
