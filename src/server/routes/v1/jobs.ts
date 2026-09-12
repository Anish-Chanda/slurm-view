import { Router } from 'express';
import type { JobsCache } from '../../cache/jobs-cache.js';
import { createJobDetailsHandler, createJobsHandler } from '../../handlers/jobs.js';

function createJobsRouter(jobsCache: JobsCache | undefined): Router {
  const router = Router();
  router.get('/', createJobsHandler(jobsCache));
  router.get('/:id', createJobDetailsHandler(jobsCache));
  return router;
}

export { createJobsRouter };
