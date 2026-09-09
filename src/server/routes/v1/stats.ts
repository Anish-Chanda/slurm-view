import { Router } from 'express';
import type { NodesCache } from '../../cache/nodes-cache.js';
import { createStatsHandler } from '../../handlers/stats.js';

function createStatsRouter(nodesCache: NodesCache | undefined): Router {
  const router = Router();
  router.get('/', createStatsHandler(nodesCache));
  return router;
}

export { createStatsRouter };
