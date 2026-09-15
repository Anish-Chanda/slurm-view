// Array-throttle analyzer: max simultaneous tasks from the targeted job
// record; running-task count from the shared snapshot.
import type { AnalyzerContext } from '../types.js';
import type { ArrayThrottleAnalysisDto } from '../../../../shared/api/v1/pending-analysis.js';

async function analyzeArrayThrottle(ctx: AnalyzerContext): Promise<ArrayThrottleAnalysisDto | null> {
  const { targeted, jobsSnapshot } = ctx;
  const maxRunningTasks = targeted.arrayThrottle;
  if (maxRunningTasks === null) {
    return null;
  }
  // Count running tasks of the same array; null when unidentifiable.
  const arrayJobId = targeted.job.arrayJobId ?? targeted.job.jobId.split('_')[0] ?? null;
  let runningTasks: number | null = null;
  if (arrayJobId !== null) {
    let count = 0;
    let identifiable = false;
    for (const entry of jobsSnapshot.jobs) {
      const entryArray = entry.arrayJobId ?? (entry.id.includes('_') ? entry.id.split('_')[0] : null);
      if (entryArray !== null && entryArray === arrayJobId) {
        identifiable = true;
        if (entry.state === 'RUNNING') {
          count += 1;
        }
      }
    }
    runningTasks = identifiable ? count : null;
  }
  return { kind: 'arrayThrottle', maxRunningTasks, runningTasks };
}

export { analyzeArrayThrottle };
