// Priority analyzer: sprio multifactor evidence plus same-partition
// competition from the shared snapshot. Slurm order is not strict numeric
// priority under backfill, so no queue position is reported.
import { fetchSprioJob } from '../../../adapters/slurm/sprio.js';
import type { AnalyzerContext } from '../types.js';
import type { PriorityAnalysisDto } from '../../../../shared/api/v1/pending-analysis.js';

const COMPETITOR_CAP = 5;

async function analyzePriority(ctx: AnalyzerContext): Promise<PriorityAnalysisDto | null> {
  const { targeted, jobsSnapshot, slurmContext, sprioWeights } = ctx;
  const job = targeted.job;
  if (job.partition === null) {
    return null;
  }
  const partition = job.partition;
  // Snapshot priorities order competitors; the job's own priority falls
  // back to the sprio total. An empty sprio table means no factors.
  const [weighted, normalized] = await Promise.all([
    fetchSprioJob(slurmContext, ctx.jobId, { signal: ctx.signal }),
    fetchSprioJob(slurmContext, ctx.jobId, { normalized: true, signal: ctx.signal }),
  ]);
  const priority = job.priority ?? weighted?.priority ?? null;
  if (priority === null) {
    return null;
  }
  const weightMap = sprioWeights?.weights ?? {};
  const factorNames = new Set<string>([
    ...Object.keys(weighted?.factors ?? {}),
    ...Object.keys(normalized?.factors ?? {}),
    ...Object.keys(weightMap),
  ]);
  const factors = [...factorNames]
    .sort()
    .map((name) => ({
      name: name.toLowerCase(),
      weighted: weighted?.factors[name] ?? weighted?.factors[name.toUpperCase()] ?? null,
      normalized: normalized?.factors[name] ?? normalized?.factors[name.toUpperCase()] ?? null,
      weight: weightMap[name] ?? weightMap[name.toUpperCase()] ?? null,
    }))
    .filter((factor) => factor.weighted !== null || factor.normalized !== null || factor.weight !== null);
  const pending = jobsSnapshot.jobs.filter(
    (entry) => entry.partition === partition && entry.state === 'PENDING'
  );
  const ranked = pending.filter(
    (entry) => entry.id !== job.id && entry.priority !== null && entry.priority > priority
  );
  ranked.sort((a, b) => (b.priority as number) - (a.priority as number));
  const runningJobs = jobsSnapshot.jobs.filter(
    (entry) => entry.partition === partition && entry.state === 'RUNNING'
  ).length;
  return {
    kind: 'priority',
    partition,
    priority,
    factors,
    pendingJobs: pending.length,
    higherPriorityJobs: ranked.length,
    runningJobs,
    competitors: ranked.slice(0, COMPETITOR_CAP).map((entry) => ({
      jobId: entry.id,
      user: entry.user,
      priority: entry.priority as number,
    })),
  };
}

export { COMPETITOR_CAP, analyzePriority };
