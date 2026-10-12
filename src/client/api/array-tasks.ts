import type { ArrayTaskDto, ArrayTasksResponse, JobState } from '../../shared/api/v1/jobs.ts';
import { JOB_STATES } from '../../shared/api/v1/jobs.ts';
import { apiUrl } from './base.ts';
import { ApiError, fetchJson } from './client.ts';
import { jobsKeys } from './query-keys.ts';

const ARRAY_TASKS_STALE_TIME_MS = 30_000;
const ARRAY_TASKS_REFETCH_INTERVAL_MS = 30_000;

const JOB_STATE_SET: ReadonlySet<string> = new Set(JOB_STATES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isArrayTask(value: unknown): value is ArrayTaskDto {
  if (!isRecord(value)) return false;
  if (typeof value.taskId !== 'number' || !Number.isInteger(value.taskId) || value.taskId < 0) return false;
  if (typeof value.state !== 'string' || !JOB_STATE_SET.has(value.state)) return false;
  if (!isNullableNumber(value.elapsedSeconds)) return false;
  if (!isNullableString(value.nodeExpression)) return false;
  if (!isNullableString(value.exitCode)) return false;
  return true;
}

function isArrayTasksResponse(value: unknown): value is ArrayTasksResponse {
  if (!isRecord(value)) return false;
  return Array.isArray(value.tasks) && value.tasks.every(isArrayTask);
}

async function fetchArrayTasks(
  arrayJobId: string,
  options: { signal?: AbortSignal } = {}
): Promise<ArrayTasksResponse> {
  const response = await fetchJson<unknown>(
    apiUrl(`jobs/${encodeURIComponent(arrayJobId)}/array`),
    options
  );
  if (!isArrayTasksResponse(response)) {
    throw new ApiError(
      'INVALID_ARRAY_RESPONSE',
      502,
      'Array task history returned malformed data.'
    );
  }
  const tasks = [...response.tasks].sort((a, b) => a.taskId - b.taskId);
  return { tasks };
}

function arrayTasksQueryOptions(arrayJobId: string) {
  return {
    queryKey: jobsKeys.array(arrayJobId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchArrayTasks(arrayJobId, { signal }),
    staleTime: ARRAY_TASKS_STALE_TIME_MS,
    refetchInterval: ARRAY_TASKS_REFETCH_INTERVAL_MS,
    retry: (failureCount: number, error: unknown) =>
      error instanceof ApiError && error.status === 404 ? false : failureCount < 1,
  };
}

export { ARRAY_TASKS_REFETCH_INTERVAL_MS, ARRAY_TASKS_STALE_TIME_MS, arrayTasksQueryOptions, fetchArrayTasks, isArrayTasksResponse };
export type { ArrayTaskDto as ClientArrayTaskDto, JobState as ClientArrayJobState };
