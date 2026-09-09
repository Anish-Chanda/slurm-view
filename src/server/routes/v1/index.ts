import { Router, type NextFunction, type Request, type Response } from 'express';
import { ProblemCode } from '../../../shared/api/v1/common.js';
import type { HealthResponse } from '../../../shared/api/v1/health.js';
import type { JobsCache } from '../../cache/jobs-cache.js';
import type { NodesCache } from '../../cache/nodes-cache.js';
import { HttpError, errorHandler } from '../../middleware/error-handler.js';
import { createJobsRouter } from './jobs.js';
import { createStatsRouter } from './stats.js';

interface V1RouterDeps {
  jobsCache?: JobsCache;
  nodesCache?: NodesCache;
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
  router.use('/stats', createStatsRouter(deps.nodesCache));

  router.use((_req: Request, _res: Response, next: NextFunction) => {
    next(new HttpError(ProblemCode.NotFound));
  });

  router.use(errorHandler);

  return router;
}

export { createV1Router };
export type { V1RouterDeps };
