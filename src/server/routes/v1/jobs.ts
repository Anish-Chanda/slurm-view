import { Router } from 'express';
import type { JobsCache } from '../../cache/jobs-cache.js';
import type { SeffRunFn } from '../../adapters/slurm/seff.js';
import { createJobDetailsHandler, createJobsHandler } from '../../handlers/jobs.js';
import { createEfficiencyHandler } from '../../handlers/efficiency.js';

function createJobsRouter(jobsCache: JobsCache | undefined, run?: SeffRunFn): Router {
  const router = Router();
  router.get('/', createJobsHandler(jobsCache));
  router.get('/:id/efficiency', createEfficiencyHandler(jobsCache, run));
  router.get('/:id', createJobDetailsHandler(jobsCache));
  return router;
}

export { createJobsRouter };
