import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { HttpError } from '../middleware/error-handler.js';
import { ProblemCode } from '../../shared/api/v1/common.js';
import {
  JOBS_PAGE_DEFAULT,
  JOBS_PAGE_SIZE_DEFAULT,
  JOBS_PAGE_SIZE_MAX,
} from '../../shared/api/v1/jobs.js';
import type { JobDto, JobDetailsResponse, JobSummaryDto, JobsResponse } from '../../shared/api/v1/jobs.js';
import { JOB_BASE_STATES } from '../models/job.js';
import type { JobsCache } from '../cache/jobs-cache.js';
import type { Job } from '../models/job.js';
import type { QueueJob } from '../models/queue-job.js';
import { JobsService } from '../services/jobs-service.js';
import type { JobsFilter, JobsResult } from '../services/jobs-service.js';
import type { SlurmContext } from '../adapters/slurm/context.js';
import { fetchTargetedJob } from '../adapters/slurm/targeted-job.js';
import { CommandError } from '../adapters/slurm/command-runner.js';
import { SlurmUpstreamError } from '../adapters/slurm/errors.js';
import { isMissingJobSignal } from '../services/pending-analysis/missing-job.js';
import { canonicalJobIdSchema } from '../validation/job-id.js';
import { toHttpError } from './errors.js';

// Reject requests that include unknown query parameters.
const jobsQuerySchema = z.strictObject({
  id: z.string().max(64).optional(),
  partition: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  name: z.string().max(200).optional(),
  user: z.string().max(64).optional(),
  account: z.string().max(64).optional(),
  state: z.enum(JOB_BASE_STATES).optional(),
  stateReason: z.string().max(128).optional(),
  page: z.coerce.number().int().min(1).default(JOBS_PAGE_DEFAULT),
  pageSize: z.coerce.number().int().min(1).max(JOBS_PAGE_SIZE_MAX).default(JOBS_PAGE_SIZE_DEFAULT),
});

type JobsQuery = z.infer<typeof jobsQuerySchema>;

function toIsoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function toJobDto(job: Job): JobDto {
  return {
    id: job.id,
    jobId: job.jobId,
    arrayJobId: job.arrayJobId,
    arrayTaskId: job.arrayTaskId,
    partition: job.partition,
    name: job.name,
    user: job.user,
    account: job.account,
    qos: job.qos,
    state: job.state,
    stateFlags: [...job.stateFlags],
    stateReason: job.stateReason,
    timeLimit:
      job.timeLimit === null
        ? null
        : job.timeLimit.kind === 'infinite'
          ? { kind: 'infinite' }
          : { kind: 'finite', seconds: job.timeLimit.seconds },
    submitTime: toIsoDate(job.submitTime),
    eligibleTime: toIsoDate(job.eligibleTime),
    startTime: toIsoDate(job.startTime),
    endTime: toIsoDate(job.endTime),
    priority: job.priority,
    taskCount: job.taskCount,
    cpusPerTask: job.cpusPerTask,
    constraints: job.constraints,
    reservation: job.reservation,
    nodeCount: job.nodeCount,
    nodeExpression: job.nodeExpression,
    requested: {
      cpus: job.requested.cpus,
      memoryMiB: job.requested.memoryMiB,
      nodes: job.requested.nodes,
      gpus: { total: job.requested.gpus.total, byType: { ...job.requested.gpus.byType } },
    },
    allocated: {
      cpus: job.allocated.cpus,
      memoryMiB: job.allocated.memoryMiB,
      nodes: job.allocated.nodes,
      gpus: { total: job.allocated.gpus.total, byType: { ...job.allocated.gpus.byType } },
    },
    workdir: job.workdir,
    command: job.command,
    stdoutPath: job.stdoutPath,
    stderrPath: job.stderrPath,
    dependency: job.dependency,
    exitCode: job.exitCode,
    derivedExitCode: job.derivedExitCode,
    wckey: job.wckey,
    batchHost: job.batchHost,
    flags: [...job.flags],
  };
}

function toJobSummaryDto(job: QueueJob): JobSummaryDto {
  return {
    id: job.id,
    partition: job.partition,
    name: job.name,
    user: job.user,
    account: job.account,
    state: job.state,
    timeLimit:
      job.timeLimit === null
        ? null
        : job.timeLimit.kind === 'infinite'
          ? { kind: 'infinite' }
          : { kind: 'finite', seconds: job.timeLimit.seconds },
    submitTime: toIsoDate(job.submitTime),
    startTime: toIsoDate(job.startTime),
    endTime: toIsoDate(job.endTime),
    nodeCount: job.nodeCount,
    nodeExpression: job.nodeExpression,
  };
}

function toJobsResponse(result: JobsResult): JobsResponse {
  return {
    jobs: result.jobs.map(toJobSummaryDto),
    pagination: result.pagination,
    updatedAt: result.updatedAt.toISOString(),
  };
}

function toJobDetailsResponse(job: Job, updatedAt: Date): JobDetailsResponse {
  return {
    job: toJobDto(job),
    updatedAt: updatedAt.toISOString(),
  };
}

function toJobsFilter(query: JobsQuery): JobsFilter {
  const filter: JobsFilter = {};
  if (query.id !== undefined) filter.id = query.id;
  if (query.partition !== undefined) filter.partition = query.partition;
  if (query.name !== undefined) filter.name = query.name;
  if (query.user !== undefined) filter.user = query.user;
  if (query.account !== undefined) filter.account = query.account;
  if (query.state !== undefined) filter.state = query.state;
  if (query.stateReason !== undefined) filter.stateReason = query.stateReason;
  return filter;
}

function createJobsHandler(jobsCache: JobsCache | undefined) {
  return asyncHandler(async (req, res) => {
    if (!jobsCache) {
      throw new HttpError(
        ProblemCode.SlurmUnavailable,
        'Jobs snapshot is not initialized.'
      );
    }
    const parsed = jobsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`)
        .join('; ');
      throw new HttpError(ProblemCode.BadRequest, `Invalid query parameters: ${detail}`);
    }
    try {
      const service = new JobsService(jobsCache);
      const result = await service.listJobs(toJobsFilter(parsed.data), {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      });
      res.json(toJobsResponse(result));
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

function isMissingTargetedJob(error: unknown, jobId: string): boolean {
  if (error instanceof CommandError) {
    return isMissingJobSignal(`${error.stderrSnippet}\n${error.message}`, jobId);
  }
  return error instanceof SlurmUpstreamError && isMissingJobSignal(error.message, jobId);
}

function createJobDetailsHandler(slurmContext: SlurmContext | undefined) {
  return asyncHandler(async (req, res) => {
    if (!slurmContext) {
      throw new HttpError(
        ProblemCode.SlurmUnavailable,
        'Slurm job lookup is not initialized.'
      );
    }
    const parsed = canonicalJobIdSchema.safeParse(req.params.id);
    if (!parsed.success) {
      throw new HttpError(ProblemCode.BadRequest, `Invalid job ID: ${req.params.id}`);
    }
    try {
      const targeted = await fetchTargetedJob(slurmContext, parsed.data);
      if (targeted === null) {
        throw new HttpError(
          ProblemCode.NotFound,
          `Job ${parsed.data} is no longer available in the live scheduler data. Historical accounting is not queried.`
        );
      }
      res.json(toJobDetailsResponse(targeted.job, targeted.capturedAt));
    } catch (error) {
      if (isMissingTargetedJob(error, parsed.data)) {
        throw new HttpError(
          ProblemCode.NotFound,
          `Job ${parsed.data} is no longer available in the live scheduler data. Historical accounting is not queried.`
        );
      }
      throw toHttpError(error);
    }
  });
}

export { createJobDetailsHandler, createJobsHandler, jobsQuerySchema, toJobDetailsResponse, toJobDto, toJobSummaryDto, toJobsResponse };
export type { JobsQuery };
