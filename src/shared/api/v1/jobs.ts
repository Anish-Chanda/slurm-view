// Public v1 jobs contract: pure types, camelCase, explicit units, ISO timestamps.
export type JobState =
  | 'BOOT_FAIL'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'DEADLINE'
  | 'FAILED'
  | 'NODE_FAIL'
  | 'OUT_OF_MEMORY'
  | 'PENDING'
  | 'PREEMPTED'
  | 'RUNNING'
  | 'SUSPENDED'
  | 'TIMEOUT'
  | 'UNKNOWN';

export type TimeLimitDto = { kind: 'finite'; seconds: number } | { kind: 'infinite' } | null;

export interface GpuBreakdownDto {
  total: number;
  byType: Record<string, number>;
}

export interface RequestedResourcesDto {
  cpus: number | null;
  memoryMiB: number | null;
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
  startTime: string | null;
  endTime: string | null;
  nodeCount: number | null;
  nodeExpression: string | null;
  requested: RequestedResourcesDto;
  allocated: AllocatedResourcesDto;
  workdir: string | null;
  command: string | null;
  stdoutPath: string | null;
  dependency: string | null;
  exitCode: string | null;
  derivedExitCode: string | null;
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

export const JOBS_PAGE_DEFAULT = 1;
export const JOBS_PAGE_SIZE_DEFAULT = 20;
export const JOBS_PAGE_SIZE_MAX = 100;
