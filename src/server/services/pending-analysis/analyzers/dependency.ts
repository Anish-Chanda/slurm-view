// Dependency analyzer: evaluates the job's Slurm dependency expression.
// DependencyNeverSatisfied reuses this analyzer; only the scheduler reason
// itself establishes that conclusion.
import { fetchTargetedJob } from '../../../adapters/slurm/targeted-job.js';
import { CommandError } from '../../../adapters/slurm/command-runner.js';
import { SlurmUpstreamError } from '../../../adapters/slurm/errors.js';
import { isMissingJobSignal } from '../missing-job.js';
import type { Job } from '../../../models/job.js';
import type { AnalyzerContext } from '../types.js';
import { combineStatus, parseDependency } from '../dependency-parser.js';
import type { DependencyItem } from '../dependency-parser.js';
import type {
  DependencyAnalysisDto,
  DependencyStatus,
} from '../../../../shared/api/v1/pending-analysis.js';
import type { JobState } from '../../../../shared/api/v1/jobs.js';
import { JOB_STATES } from '../../../../shared/api/v1/jobs.js';

const TERMINAL_STATES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMEOUT',
  'NODE_FAIL',
  'OUT_OF_MEMORY',
  'BOOT_FAIL',
  'DEADLINE',
]);

const FAILED_STATES: ReadonlySet<string> = new Set([
  'FAILED',
  'NODE_FAIL',
  'TIMEOUT',
  'OUT_OF_MEMORY',
  'BOOT_FAIL',
  'DEADLINE',
]);

const DEPENDENCY_TARGET_CAP = 50;

interface TargetEvidence {
  job: Job | null;
  missing: boolean;
}

// Completed array tasks may have left the live queue, so visible tasks
// cannot prove that the whole array has completed.
function collectArrayTasks(ctx: AnalyzerContext, arrayJobId: string): Job[] {
  const tasks: Job[] = [];
  const prefix = `${arrayJobId}_`;
  for (const job of ctx.jobsSnapshot.jobs) {
    // The array master itself (bare id) is never one of its tasks.
    if (job.id.startsWith(prefix) && job.arrayTaskId !== null) {
      tasks.push(job);
    }
  }
  return tasks;
}

// A bare ArrayJobID dependency applies to the whole array, not the master
// job record.
function taskFailedTerminal(task: Job): boolean | null {
  if (FAILED_STATES.has(task.state)) {
    return true;
  }
  if (task.state === 'COMPLETED') {
    const nonZero = exitCodeNonZero(task.exitCode);
    if (nonZero === null) {
      return null;
    }
    return nonZero;
  }
  if (TERMINAL_STATES.has(task.state)) {
    return false;
  }
  return null;
}

// Whole-array rules for a bare ArrayJobID target. Visible tasks can show
// the dependency is not met, but never that the whole array met it.
function evaluateBareArray(
  type: string,
  tasks: Job[],
  delayMinutes: number | null,
  now: Date
): DependencyStatus {
  if (tasks.length === 0) {
    return 'unknown';
  }
  const terminalOrPreempted = (task: Job): boolean =>
    TERMINAL_STATES.has(task.state) || task.state === 'PREEMPTED';
  switch (type) {
    case 'after': {
      // Any observed task that has not met the condition disproves it,
      // regardless of visit order.
      for (const task of tasks) {
        const status = evaluateAfter({ job: task, missing: false }, delayMinutes, now);
        if (status === 'unsatisfied') {
          return 'unsatisfied';
        }
      }
      return 'unknown';
    }
    case 'afterany': {
      for (const task of tasks) {
        if (!terminalOrPreempted(task)) {
          return 'unsatisfied';
        }
      }
      return 'unknown';
    }
    case 'afterok': {
      // Any failed, cancelled, or live task disproves whole-array success.
      for (const task of tasks) {
        if (!terminalOrPreempted(task)) {
          return 'unsatisfied';
        }
        const failed = taskFailedTerminal(task);
        if (failed === true) {
          return 'unsatisfied';
        }
        if (failed === false && task.state !== 'COMPLETED') {
          return 'unsatisfied';
        }
      }
      return 'unknown';
    }
    case 'afternotok': {
      // Slurm requires the array finished with at least one failed task.
      // A live task means the array has not finished, even when another
      // visible task already failed.
      for (const task of tasks) {
        if (!terminalOrPreempted(task)) {
          return 'unsatisfied';
        }
      }
      return 'unknown';
    }
    default:
      return 'unknown';
  }
}

function isJobState(value: string | null): value is JobState {
  return value !== null && (JOB_STATES as readonly string[]).includes(value);
}

function exitCodeNonZero(exitCode: string | null): boolean | null {
  if (exitCode === null) {
    return null;
  }
  const parsed = Number(exitCode.trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed) !== 0;
}

interface LookupBudget {
  // Only live `scontrol show job` probes consume the budget. Snapshot hits
  // are free; exhaustion yields `unknown`.
  liveRemaining: number;
}

const LIVE_LOOKUP_CAP = 10;

async function resolveTarget(
  ctx: AnalyzerContext,
  jobId: string,
  arrayTaskId: string | null,
  cache: Map<string, TargetEvidence>,
  budget: LookupBudget
): Promise<TargetEvidence> {
  const key = arrayTaskId !== null ? `${jobId}_${arrayTaskId}` : jobId;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  // Exact task identity only: the array master is never evidence for a
  // specific task.
  const snapshotHit = ctx.jobsSnapshot.byId.get(key) ?? null;
  if (snapshotHit !== null) {
    const evidence = { job: snapshotHit, missing: false };
    cache.set(key, evidence);
    return evidence;
  }
  if (budget.liveRemaining <= 0) {
    const evidence = { job: null, missing: true };
    cache.set(key, evidence);
    return evidence;
  }
  budget.liveRemaining -= 1;
  try {
    const targeted = await fetchTargetedJob(ctx.slurmContext, key, { signal: ctx.signal });
    if (targeted === null) {
      const evidence = { job: null, missing: true };
      cache.set(key, evidence);
      return evidence;
    }
    // A master record for an explicit task query arrives as no match.
    const evidence = { job: targeted.job, missing: false };
    cache.set(key, evidence);
    return evidence;
  } catch (error) {
    // Timeouts, malformed responses, and unrelated controller errors
    // propagate; only missing-job signals become uncertainty.
    if (error instanceof CommandError) {
      const text = `${error.stderrSnippet ?? ''}\n${error.message ?? ''}`;
      if (!isMissingJobSignal(text, key)) {
        throw error;
      }
    } else if (error instanceof SlurmUpstreamError) {
      if (!isMissingJobSignal(error.message, key)) {
        throw error;
      }
    } else {
      throw error;
    }
    const evidence = { job: null, missing: true };
    cache.set(key, evidence);
    return evidence;
  }
}

function evaluateAfterOk(evidence: TargetEvidence): DependencyStatus {
  if (evidence.job === null) {
    return 'unknown';
  }
  if (evidence.job.state !== 'COMPLETED') {
    return TERMINAL_STATES.has(evidence.job.state) ? 'unsatisfied' : 'unsatisfied';
  }
  const nonZero = exitCodeNonZero(evidence.job.exitCode);
  if (nonZero === null) {
    return 'unknown';
  }
  return nonZero ? 'unsatisfied' : 'satisfied';
}

function evaluateAfterNotOk(evidence: TargetEvidence): DependencyStatus {
  if (evidence.job === null) {
    return 'unknown';
  }
  const state = evidence.job.state;
  if (FAILED_STATES.has(state)) {
    return 'satisfied';
  }
  if (state === 'COMPLETED') {
    const nonZero = exitCodeNonZero(evidence.job.exitCode);
    if (nonZero === null) {
      return 'unknown';
    }
    return nonZero ? 'satisfied' : 'unsatisfied';
  }
  if (TERMINAL_STATES.has(state)) {
    return 'unsatisfied';
  }
  return 'unsatisfied';
}

function evaluateAfterAny(evidence: TargetEvidence): DependencyStatus {
  if (evidence.job === null) {
    return 'unknown';
  }
  return TERMINAL_STATES.has(evidence.job.state) || evidence.job.state === 'PREEMPTED'
    ? 'satisfied'
    : 'unsatisfied';
}

function evaluateAfter(evidence: TargetEvidence, delayMinutes: number | null, now: Date): DependencyStatus {
  if (evidence.job === null) {
    return 'unknown';
  }
  const job = evidence.job;
  const started = job.startTime !== null || job.state === 'RUNNING' || TERMINAL_STATES.has(job.state);
  const cancelled = job.state === 'CANCELLED';
  if (!started && !cancelled) {
    return 'unsatisfied';
  }
  if (delayMinutes === null || delayMinutes <= 0) {
    return 'satisfied';
  }
  // Delayed `after` needs start (or cancel/end) plus the delay interval.
  const anchor = job.startTime ?? job.endTime;
  if (anchor === null) {
    return 'unknown';
  }
  return now.getTime() >= anchor.getTime() + delayMinutes * 60_000 ? 'satisfied' : 'unsatisfied';
}

function evaluateAfterBurstBuffer(evidence: TargetEvidence): DependencyStatus {
  if (evidence.job === null) {
    return 'unknown';
  }
  // COMPLETED alone does not prove burst-buffer stage-out finished.
  // STAGE_OUT means still staging; otherwise the state is unobservable.
  if (evidence.job.stateFlags.includes('STAGE_OUT')) {
    return 'unsatisfied';
  }
  if (!TERMINAL_STATES.has(evidence.job.state)) {
    return 'unsatisfied';
  }
  return 'unknown';
}

// Launch order: submit timestamp first, then numeric job id. Either may be
// absent; comparison uses whichever evidence exists.
function compareJobOrder(candidate: Job, self: Job): number | null {
  const candidateTime = candidate.submitTime?.getTime() ?? null;
  const selfTime = self.submitTime?.getTime() ?? null;
  const timesUsable =
    candidateTime !== null && selfTime !== null && Number.isFinite(candidateTime) && Number.isFinite(selfTime);
  if (timesUsable && (candidateTime as number) !== (selfTime as number)) {
    return (candidateTime as number) < (selfTime as number) ? -1 : 1;
  }
  const candidateId = Number((candidate.arrayJobId ?? candidate.jobId).split('_')[0]);
  const selfId = Number((self.arrayJobId ?? self.jobId).split('_')[0]);
  const idsUsable = Number.isFinite(candidateId) && Number.isFinite(selfId);
  if (idsUsable && candidateId !== selfId) {
    return candidateId < selfId ? -1 : 1;
  }
  if (timesUsable || idsUsable) {
    return 0;
  }
  return null;
}

function evaluateSingleton(ctx: AnalyzerContext): DependencyStatus {
  const { job } = ctx.targeted;
  if (job.user === null || job.name === null) {
    return 'unknown';
  }
  // Singleton blocks on earlier same-name jobs of the same user that have
  // not terminated. Later jobs never block.
  let unknownOrdering = false;
  for (const entry of ctx.jobsSnapshot.jobs) {
    if (entry.id === job.id || entry.user !== job.user || entry.name !== job.name) {
      continue;
    }
    if (entry.state !== 'RUNNING' && entry.state !== 'SUSPENDED' && entry.state !== 'PENDING') {
      continue;
    }
    const order = compareJobOrder(entry, job);
    if (order === null) {
      unknownOrdering = true;
      continue;
    }
    if (order < 0) {
      return 'unsatisfied';
    }
  }
  return unknownOrdering ? 'unknown' : 'satisfied';
}

async function evaluateItem(
  ctx: AnalyzerContext,
  type: string,
  item: DependencyItem,
  cache: Map<string, TargetEvidence>,
  budget: LookupBudget,
  now: Date
): Promise<{ status: DependencyStatus; state: JobState | null; exitCode: string | null }> {
  if (type === 'singleton') {
    return { status: evaluateSingleton(ctx), state: null, exitCode: null };
  }
  // Wildcard array dependencies (123_*) stay `unknown`: the snapshot
  // cannot establish array-wide state.
  if (item.arrayWildcard) {
    const evidence = await resolveTarget(ctx, item.jobId, null, cache, budget);
    return {
      status: 'unknown',
      state: evidence.job !== null && isJobState(evidence.job.state) ? evidence.job.state : null,
      exitCode: evidence.job?.exitCode ?? null,
    };
  }
  // Slurm status markers (failed/unfulfilled) short-circuit to unsatisfied.
  if (item.statusMarker !== null) {
    const marker = item.statusMarker.toLowerCase();
    if (marker === 'failed' || marker === 'unfulfilled') {
      const evidence = await resolveTarget(ctx, item.jobId, item.arrayTaskId, cache, budget);
      return {
        status: 'unsatisfied',
        state: evidence.job !== null && isJobState(evidence.job.state) ? evidence.job.state : null,
        exitCode: evidence.job?.exitCode ?? null,
      };
    }
  }
  // A bare job ID may name a whole array. Live tasks or the record's own
  // array identity select whole-array rules; anything else stays scalar.
  if (
    (type === 'after' || type === 'afterok' || type === 'afternotok' || type === 'afterany') &&
    item.arrayTaskId === null
  ) {
    const tasks = collectArrayTasks(ctx, item.jobId);
    const master = ctx.jobsSnapshot.byId.get(item.jobId) ?? null;
    const masterArrayRelated =
      master !== null && (master.arrayJobId !== null || master.arrayTaskId !== null);
    if (tasks.length > 0 || masterArrayRelated) {
      // Job.taskCount is the Slurm task count, not the array size.
      const status = evaluateBareArray(type, tasks, item.delayMinutes, now);
      const state =
        master !== null && isJobState(master.state) ? master.state : null;
      return { status, state, exitCode: master?.exitCode ?? null };
    }
  }
  // Non-array aftercorr falls back to afterok.
  if (type === 'aftercorr') {
    const selfTask = ctx.targeted.job.arrayTaskId;
    if (selfTask === null) {
      const evidence = await resolveTarget(ctx, item.jobId, item.arrayTaskId, cache, budget);
      return {
        status: evaluateAfterOk(evidence),
        state: evidence.job !== null && isJobState(evidence.job.state) ? evidence.job.state : null,
        exitCode: evidence.job?.exitCode ?? null,
      };
    }
    const evidence = await resolveTarget(ctx, item.jobId, item.arrayTaskId ?? selfTask, cache, budget);
    if (evidence.job === null) {
      return { status: 'unknown', state: null, exitCode: null };
    }
    // Correlation requires the matching task.
    if (evidence.job.arrayTaskId !== null && evidence.job.arrayTaskId !== selfTask && item.arrayTaskId === null) {
      return {
        status: 'unknown',
        state: isJobState(evidence.job.state) ? evidence.job.state : null,
        exitCode: evidence.job.exitCode,
      };
    }
    return {
      status: evaluateAfterOk(evidence),
      state: isJobState(evidence.job.state) ? evidence.job.state : null,
      exitCode: evidence.job.exitCode,
    };
  }
  const evidence = await resolveTarget(ctx, item.jobId, item.arrayTaskId, cache, budget);
  let status: DependencyStatus;
  switch (type) {
    case 'afterok':
      status = evaluateAfterOk(evidence);
      break;
    case 'afternotok':
      status = evaluateAfterNotOk(evidence);
      break;
    case 'afterany':
      status = evaluateAfterAny(evidence);
      break;
    case 'after':
      status = evaluateAfter(evidence, item.delayMinutes, now);
      break;
    case 'afterburstbuffer':
      status = evaluateAfterBurstBuffer(evidence);
      break;
    default:
      status = 'unknown';
      break;
  }
  return {
    status,
    state: evidence.job !== null && isJobState(evidence.job.state) ? evidence.job.state : null,
    exitCode: evidence.job?.exitCode ?? null,
  };
}

async function analyzeDependency(ctx: AnalyzerContext): Promise<DependencyAnalysisDto | null> {
  const expression = ctx.targeted.job.dependency;
  if (expression === null) {
    return null;
  }
  const parsed = parseDependency(expression);
  if (parsed === null) {
    return null;
  }
  const now = new Date();
  const cache = new Map<string, TargetEvidence>();
  const budget: LookupBudget = { liveRemaining: LIVE_LOOKUP_CAP };
  const dependencies: DependencyAnalysisDto['dependencies'] = [];
  const clauseStatuses: DependencyStatus[] = [];
  for (const clause of parsed.clauses) {
    if (clause.type === 'singleton') {
      const status = evaluateSingleton(ctx);
      clauseStatuses.push(status);
      dependencies.push({ type: 'singleton', status, jobs: [] });
      continue;
    }
    // Every target contributes to the logical result; only the first
    // DEPENDENCY_TARGET_CAP rows are serialized.
    const evaluatedAll: Array<{ status: DependencyStatus; state: JobState | null; exitCode: string | null }> = [];
    for (const item of clause.jobs) {
      evaluatedAll.push(await evaluateItem(ctx, clause.type, item, cache, budget, now));
    }
    const itemStatuses = evaluatedAll.map((result) => result.status);
    const jobs: DependencyAnalysisDto['dependencies'][number]['jobs'] = clause.jobs
      .slice(0, DEPENDENCY_TARGET_CAP)
      .map((item, index) => {
        const evaluated = evaluatedAll[index] as { status: DependencyStatus; state: JobState | null; exitCode: string | null };
        return {
          jobId: item.arrayTaskId !== null ? `${item.jobId}_${item.arrayTaskId}` : item.jobId,
          state: evaluated.state,
          exitCode: evaluated.exitCode,
          status: evaluated.status,
          ...(item.delayMinutes !== null ? { delayMinutes: item.delayMinutes } : {}),
          ...(item.arrayWildcard ? { arrayWildcard: true } : {}),
        };
      });
    // Ids within one `type:a:b` clause combine with AND (OR groups were
    // flattened to single-id clauses at parse time).
    const clauseStatus = combineStatus(itemStatuses, 'and');
    clauseStatuses.push(clauseStatus);
    dependencies.push({ type: clause.type, status: clauseStatus, jobs });
  }
  return {
    kind: 'dependency',
    expression,
    operator: parsed.operator,
    status: combineStatus(clauseStatuses, parsed.operator),
    dependencies,
  };
}

export { DEPENDENCY_TARGET_CAP, analyzeDependency };
