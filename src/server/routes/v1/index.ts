import { Router, type Request, type Response } from 'express';
import type { HealthResponse } from '../../../shared/api/v1/health.js';
import type { JobsCache } from '../../cache/jobs-cache.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { createJobsRouter } from './jobs.js';

interface V1RouterDeps {
  jobsCache?: JobsCache;
}

function createV1Router(deps: V1RouterDeps = {}): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const body: HealthResponse = {
      status: 'ok',
    };
    res.json(body);
  });

  router.use('/jobs', createJobsRouter(deps.jobsCache));

  router.use(errorHandler);

  return router;
}

export { createV1Router };
export type { V1RouterDeps };
