import { Router } from 'express';
import type { PartitionsCache } from '../../cache/partitions-cache.js';
import { createPartitionsHandler } from '../../handlers/partitions.js';

function createPartitionsRouter(partitionsCache: PartitionsCache | undefined): Router {
  const router = Router();
  router.get('/', createPartitionsHandler(partitionsCache));
  return router;
}

export { createPartitionsRouter };
