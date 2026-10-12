import type { ArrayTasksCache } from '../cache/array-tasks-cache.js';
import type { ArrayTaskRecord } from '../adapters/slurm/array-tasks.js';
import type { ArrayOverviewDto, ArrayTaskDto } from '../../shared/api/v1/jobs.js';
import type { QueueJob } from '../models/queue-job.js';
import { SlurmUpstreamError, UpstreamInvalidError } from '../adapters/slurm/errors.js';

const ARRAY_JOB_ID_PATTERN = /^[1-9]\d*$/;

interface ArraySource {
  peek(): JobSnapshotLike | undefined;
}

interface JobSnapshotLike {
  byArrayJobId: ReadonlyMap<string, readonly QueueJob[]>;
}

// Summarize live running and pending tasks.
function summarizeLiveSiblings(siblings: readonly QueueJob[]): ArrayOverviewDto {
  let runningTasks = 0;
  let pendingTasks = 0;
  const reasons = new Map<string | null, number>();
  for (const sibling of siblings) {
    if (sibling.state === 'RUNNING') {
      runningTasks += 1;
    } else if (sibling.state === 'PENDING') {
      pendingTasks += 1;
      reasons.set(sibling.stateReason, (reasons.get(sibling.stateReason) ?? 0) + 1);
    }
  }
  const pendingReasons = [...reasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (a.reason === null ? 1 : 0) - (b.reason === null ? 1 : 0) ||
        (a.reason ?? '').localeCompare(b.reason ?? '')
    );
  return { runningTasks, pendingTasks, pendingReasons };
}

// Overlay live queue state on accounting history.
async function getArrayTasks(
  arrayJobId: string,
  deps: { jobsCache: ArraySource; arrayTasksCache: ArrayTasksCache },
  options: { signal?: AbortSignal } = {}
): Promise<ArrayTaskDto[]> {
  if (!ARRAY_JOB_ID_PATTERN.test(arrayJobId)) {
    throw new UpstreamInvalidError(`Invalid array job ID: ${arrayJobId}`);
  }
  const accounting = await deps.arrayTasksCache.getOrLoad(arrayJobId, { signal: options.signal });
  if (accounting.length === 0) {
    throw new SlurmUpstreamError([`sacct returned no accounting records for array job ${arrayJobId}`]);
  }
  const merged = new Map<number, ArrayTaskDto>();
  for (const record of accounting) {
    merged.set(record.taskId, toDto(record));
  }
  // Use the existing queue snapshot without refreshing it.
  const live = deps.jobsCache.peek()?.byArrayJobId.get(arrayJobId) ?? [];
  for (const sibling of live) {
    if (sibling.arrayTaskId === null || !/^\d+$/.test(sibling.arrayTaskId)) {
      continue;
    }
    const taskId = Number(sibling.arrayTaskId);
    if (!Number.isSafeInteger(taskId)) {
      continue;
    }
    const previous = merged.get(taskId);
    merged.set(taskId, {
      taskId,
      state: sibling.state,
      elapsedSeconds: previous?.elapsedSeconds ?? null,
      nodeExpression: sibling.nodeExpression ?? previous?.nodeExpression ?? null,
      exitCode: sibling.exitCode ?? previous?.exitCode ?? null,
    });
  }
  return [...merged.values()].sort((a, b) => a.taskId - b.taskId);
}

function toDto(record: ArrayTaskRecord): ArrayTaskDto {
  return {
    taskId: record.taskId,
    state: record.state,
    elapsedSeconds: record.elapsedSeconds,
    nodeExpression: record.nodeExpression,
    exitCode: record.exitCode,
  };
}

export { getArrayTasks, summarizeLiveSiblings };
