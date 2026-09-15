import { Router } from 'express';
import type { JobsCache } from '../../cache/jobs-cache.js';
import type { SeffRunFn } from '../../adapters/slurm/seff.js';
import { createJobDetailsHandler, createJobsHandler } from '../../handlers/jobs.js';
import { createEfficiencyHandler } from '../../handlers/efficiency.js';
import { createPendingAnalysisHandler } from '../../handlers/pending-analysis.js';
import type { PendingAnalysisDeps } from '../../services/pending-analysis-service.js';

function createJobsRouter(
  jobsCache: JobsCache | undefined,
  run?: SeffRunFn,
  pendingAnalysis?: PendingAnalysisDeps | undefined
): Router {
  const router = Router();
  router.get('/', createJobsHandler(jobsCache));
  router.get('/:id/efficiency', createEfficiencyHandler(jobsCache, run));
  router.get('/:id/pending-analysis', createPendingAnalysisHandler(pendingAnalysis));
  router.get('/:id', createJobDetailsHandler(jobsCache));
  return router;
}

export { createJobsRouter };
