import { Router, type Request, type Response } from 'express';
import type { HealthResponse } from '../../../shared/api/v1/health.js';
import { errorHandler } from '../../middleware/error-handler.js';

function createV1Router(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const body: HealthResponse = {
      status: 'ok',
    };
    res.json(body);
  });

  router.use(errorHandler);

  return router;
}

export { createV1Router };
