import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ArrayTaskDto, JobDto, JobState } from '../../../shared/api/v1/jobs.ts';
import { arrayTasksQueryOptions } from '../../api/array-tasks.ts';
import { StateBadge } from '../../components/StateBadge.tsx';
import { RefreshWarning } from '../../components/RefreshWarning.tsx';
import { MISSING, formatDuration } from '../jobs/formatting.ts';
import { DetailList, DetailRow } from './DetailList.tsx';

type TaskGroup = 'completed' | 'running' | 'pending' | 'problem';

const CELL_STATE_CLASSES: Record<JobState, string> = {
  BOOT_FAIL: 'bg-red-200 text-red-900',
  CANCELLED: 'bg-gray-200 text-gray-700',
  COMPLETED: 'bg-green-200 text-green-900',
  DEADLINE: 'bg-red-200 text-red-900',
  FAILED: 'bg-red-200 text-red-900',
  NODE_FAIL: 'bg-red-200 text-red-900',
  OUT_OF_MEMORY: 'bg-red-200 text-red-900',
  PENDING: 'bg-yellow-200 text-yellow-900',
  PREEMPTED: 'bg-orange-200 text-orange-900',
  RUNNING: 'bg-blue-200 text-blue-900',
  SUSPENDED: 'bg-purple-200 text-purple-900',
  TIMEOUT: 'bg-red-200 text-red-900',
  UNKNOWN: 'bg-slate-200 text-slate-700',
};

function groupOf(state: JobState): TaskGroup {
  if (state === 'COMPLETED') return 'completed';
  if (state === 'RUNNING') return 'running';
  if (state === 'PENDING') return 'pending';
  return 'problem';
}

interface FilterState {
  completed: boolean;
  running: boolean;
  pending: boolean;
  problem: boolean;
}

const ALL_FILTERS: FilterState = { completed: true, running: true, pending: true, problem: true };

// Bin large arrays to keep the DOM bounded.
const DIRECT_CELL_LIMIT = 500;

interface Bin {
  first: number;
  last: number;
  tasks: ArrayTaskDto[];
  // Most common state in the bin.
  dominant: JobState;
}

function dominantState(tasks: ArrayTaskDto[]): JobState {
  const counts = new Map<JobState, number>();
  for (const task of tasks) {
    counts.set(task.state, (counts.get(task.state) ?? 0) + 1);
  }
  let best: JobState = tasks[0].state;
  let bestCount = -1;
  for (const [state, count] of counts) {
    if (count > bestCount || (count === bestCount && state < best)) {
      best = state;
      bestCount = count;
    }
  }
  return best;
}

function buildBins(tasks: ArrayTaskDto[]): Bin[] {
  if (tasks.length <= DIRECT_CELL_LIMIT) {
    return tasks.length > 0
      ? [{ first: tasks[0].taskId, last: tasks[tasks.length - 1].taskId, tasks, dominant: dominantState(tasks) }]
      : [];
  }
  const binCount = Math.ceil(Math.sqrt(tasks.length));
  const binSize = Math.ceil(tasks.length / binCount);
  const bins: Bin[] = [];
  for (let start = 0; start < tasks.length; start += binSize) {
    const slice = tasks.slice(start, start + binSize);
    bins.push({ first: slice[0].taskId, last: slice[slice.length - 1].taskId, tasks: slice, dominant: dominantState(slice) });
  }
  return bins;
}

function binSummary(tasks: ArrayTaskDto[]): string {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    counts.set(task.state, (counts.get(task.state) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([state, count]) => `${count} ${state.toLowerCase()}`)
    .join(', ');
}

function TaskCell({
  task,
  arrayJobId,
  selected,
  dimmed,
  onSelect,
}: {
  task: ArrayTaskDto;
  arrayJobId: string;
  selected: boolean;
  dimmed: boolean;
  onSelect: (taskId: number) => void;
}) {
  return (
    <button
      type="button"
      title={`${arrayJobId}_${task.taskId} · ${task.state}`}
      aria-label={`Task ${task.taskId}, ${task.state}`}
      aria-pressed={selected}
      onClick={() => onSelect(task.taskId)}
      className={`flex h-7 min-w-7 items-center justify-center rounded px-1 font-mono text-[11px] leading-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 ${CELL_STATE_CLASSES[task.state]}${selected ? ' ring-2 ring-gray-900 ring-offset-1' : ''}${dimmed ? ' opacity-30' : ''}`}
    >
      {task.taskId}
    </button>
  );
}

function ArrayOverview({
  job,
  arrayThrottle,
}: {
  job: JobDto;
  arrayThrottle: number | null;
}) {
  const arrayJobId = job.arrayJobId ?? '';
  return (
    <section aria-label="Array overview">
      <h2 className="text-base font-semibold tracking-tight text-gray-900">Array overview</h2>
      <p className="mt-1 text-sm text-gray-600">Array {arrayJobId}</p>
      {arrayThrottle !== null ? (
        <p className="mt-1 text-sm text-gray-700">Allows {arrayThrottle} at a time</p>
      ) : null}
    </section>
  );
}

function ArrayExplorerContent({
  job,
  arrayThrottle,
  tasks,
}: {
  job: JobDto;
  arrayThrottle: number | null;
  tasks: ArrayTaskDto[];
}) {
  const arrayJobId = job.arrayJobId ?? '';
  const openedTaskId = job.arrayTaskId !== null ? Number(job.arrayTaskId) : NaN;
  const counts = useMemo(() => {
    const result = { completed: 0, running: 0, pending: 0, problem: 0 };
    for (const task of tasks) {
      result[groupOf(task.state)] += 1;
    }
    return result;
  }, [tasks]);
  const problemByState = useMemo(() => {
    const byState = new Map<JobState, number>();
    for (const task of tasks) {
      if (groupOf(task.state) === 'problem') {
        byState.set(task.state, (byState.get(task.state) ?? 0) + 1);
      }
    }
    return [...byState.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tasks]);
  const bins = useMemo(() => buildBins(tasks), [tasks]);
  const binned = bins.length > 1;

  const [filters, setFilters] = useState<FilterState>(ALL_FILTERS);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [expandedBin, setExpandedBin] = useState<number | null>(null);

  const effectiveSelected =
    selectedTaskId ??
    (Number.isInteger(openedTaskId) && tasks.some((task) => task.taskId === openedTaskId)
      ? openedTaskId
      : (tasks[0]?.taskId ?? null));
  const selected = tasks.find((task) => task.taskId === effectiveSelected) ?? null;
  const defaultBin = bins.findIndex(
    (bin) => effectiveSelected !== null && effectiveSelected >= bin.first && effectiveSelected <= bin.last
  );
  const effectiveBin = expandedBin ?? (defaultBin >= 0 ? defaultBin : null);
  const expanded = effectiveBin !== null && binned ? bins[effectiveBin] : null;

  function toggleFilter(group: TaskGroup): void {
    setFilters((previous) => ({ ...previous, [group]: !previous[group] }));
  }

  function isDimmed(task: ArrayTaskDto): boolean {
    // Keep task positions stable when filtering.
    return !filters[groupOf(task.state)];
  }

  function isBinDimmed(bin: Bin): boolean {
    return !bin.tasks.some((task) => filters[groupOf(task.state)]);
  }

  const filterDefs: Array<{ group: TaskGroup; label: string; count: number }> = [
    { group: 'completed', label: 'Completed', count: counts.completed },
    { group: 'running', label: 'Running', count: counts.running },
    { group: 'pending', label: 'Pending', count: counts.pending },
    { group: 'problem', label: 'Failed', count: counts.problem },
  ];

  return (
    <>
      <ArrayOverview job={job} arrayThrottle={arrayThrottle} />
      <section aria-label="Array task map" className="mt-6">
        <h2 className="text-base font-semibold tracking-tight text-gray-900">Task map</h2>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter tasks by state">
          {filterDefs.map(({ group, label, count }) => (
            <button
              key={group}
              type="button"
              aria-pressed={filters[group]}
              onClick={() => toggleFilter(group)}
              className={`rounded-full border px-2.5 py-0.5 text-xs tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${filters[group] ? 'border-gray-300 bg-white font-medium text-gray-900' : 'border-gray-200 bg-gray-50 text-gray-500 opacity-60'}`}
            >
              {label} {count}
            </button>
          ))}
        </div>
        {problemByState.length > 0 ? (
          <p className="mt-2 text-xs text-gray-600">
            {problemByState.map(([state, count]) => `${state} ×${count}`).join(' · ')}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-1" aria-label={binned ? 'Task bins in numeric order' : 'Tasks in numeric order'}>
          {binned
            ? bins.map((bin, index) => (
                <button
                  key={`${bin.first}-${bin.last}`}
                  type="button"
                  title={`Tasks ${bin.first}–${bin.last}: ${binSummary(bin.tasks)}`}
                  aria-label={`Tasks ${bin.first} to ${bin.last}: ${binSummary(bin.tasks)}`}
                  aria-pressed={effectiveBin === index}
                  onClick={() => {
                    setExpandedBin(index);
                    const firstVisible = bin.tasks.find((task) => !isDimmed(task)) ?? bin.tasks[0];
                    if (firstVisible) setSelectedTaskId(firstVisible.taskId);
                  }}
                  className={`flex h-7 items-center rounded px-2 font-mono text-[11px] leading-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 ${CELL_STATE_CLASSES[bin.dominant]}${effectiveBin === index ? ' ring-2 ring-gray-900 ring-offset-1' : ''}${isBinDimmed(bin) ? ' opacity-30' : ''}`}
                >
                  {bin.first}–{bin.last}
                </button>
              ))
            : tasks.map((task) => (
                <TaskCell
                  key={task.taskId}
                  task={task}
                  arrayJobId={arrayJobId}
                  selected={task.taskId === effectiveSelected}
                  dimmed={isDimmed(task)}
                  onSelect={setSelectedTaskId}
                />
              ))}
        </div>
        {expanded ? (
          <div className="mt-2 border border-gray-200 bg-gray-50 px-2 py-2">
            <p className="px-1 pb-1.5 text-xs text-gray-500">
              Tasks {expanded.first}–{expanded.last} in numeric order
            </p>
            <div className="flex flex-wrap gap-1" aria-label={`Tasks ${expanded.first} to ${expanded.last}`}>
              {expanded.tasks.map((task) => (
                <TaskCell
                  key={task.taskId}
                  task={task}
                  arrayJobId={arrayJobId}
                  selected={task.taskId === effectiveSelected}
                  dimmed={isDimmed(task)}
                  onSelect={setSelectedTaskId}
                />
              ))}
            </div>
          </div>
        ) : null}
        <p className="mt-2 text-xs text-gray-500">Ordered by task ID; position does not imply execution order.</p>
        {selected ? (
          <div className="mt-3 border border-gray-200 bg-white px-4 py-3" aria-label="Selected array task">
            <h3 className="text-sm font-medium text-gray-900">
              Task <span className="font-mono">{`${arrayJobId}_${selected.taskId}`}</span>
            </h3>
            <div className="mt-1">
              <DetailList>
                <DetailRow label="State">
                  <StateBadge state={selected.state} />
                </DetailRow>
                <DetailRow label="Runtime">
                  {selected.elapsedSeconds !== null ? formatDuration(selected.elapsedSeconds) : MISSING}
                </DetailRow>
                <DetailRow label="Node" mono>
                  {selected.nodeExpression ?? MISSING}
                </DetailRow>
                <DetailRow label="Exit code">
                  {selected.exitCode ?? MISSING}
                </DetailRow>
              </DetailList>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}

function ArrayExplorer({
  job,
  arrayThrottle,
}: {
  job: JobDto;
  arrayThrottle: number | null;
}) {
  if (job.arrayJobId === null || job.arrayTaskId === null) {
    return null;
  }
  return <ArrayExplorerQuery job={job} arrayThrottle={arrayThrottle} arrayJobId={job.arrayJobId} />;
}

function ArrayExplorerQuery({
  job,
  arrayThrottle,
  arrayJobId,
}: {
  job: JobDto;
  arrayThrottle: number | null;
  arrayJobId: string;
}) {
  const arrayQuery = useQuery(arrayTasksQueryOptions(arrayJobId));

  if (arrayQuery.data === undefined) {
    return (
      <>
        <ArrayOverview job={job} arrayThrottle={arrayThrottle} />
        <section aria-label="Array task map" className="mt-6">
          <h2 className="text-base font-semibold tracking-tight text-gray-900">Task map</h2>
          {arrayQuery.isPending ? (
            <div aria-busy="true" aria-label="Loading array tasks" className="mt-3">
              <div className="h-4 w-40 animate-pulse rounded bg-gray-200" />
              <div className="mt-2 h-16 animate-pulse rounded bg-gray-200" />
            </div>
          ) : (
            <div className="mt-3 border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-sm text-gray-600">Array task history is not available on this cluster.</p>
            </div>
          )}
        </section>
      </>
    );
  }

  return (
    <>
      <ArrayExplorerContent job={job} arrayThrottle={arrayThrottle} tasks={arrayQuery.data.tasks} />
      {arrayQuery.isError ? (
        <div className="mt-3">
          <RefreshWarning
            message="Showing the captured task map because the latest request failed."
            onRetry={() => void arrayQuery.refetch()}
          />
        </div>
      ) : null}
    </>
  );
}

export { ArrayExplorer };
