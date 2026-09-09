import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { HttpError } from '../middleware/error-handler.js';
import { ProblemCode } from '../../shared/api/v1/common.js';
import type { StatsResponse } from '../../shared/api/v1/stats.js';
import type { CpuLoadThresholds } from '../models/stats.js';
import type { NodesCache } from '../cache/nodes-cache.js';
import { StatsService } from '../services/stats-service.js';
import type { StatsResult } from '../services/stats-service.js';
import { toHttpError } from './errors.js';

// Thresholds come from the YAML-backed runtime config.
const { getRuntimeConfig } = require('../../../modules/runtimeConfig.js') as {
  getRuntimeConfig: () => { stats: { cpuLoad: { thresholds: CpuLoadThresholds } } };
};

const statsQuerySchema = z.strictObject({
  partition: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
});

type StatsQuery = z.infer<typeof statsQuerySchema>;

function toStatsResponse(result: StatsResult): StatsResponse {
  return {
    cpu: result.stats.cpu,
    memory: result.stats.memory,
    gpu: result.stats.gpu,
    updatedAt: result.updatedAt.toISOString(),
  };
}

function createStatsHandler(nodesCache: NodesCache | undefined) {
  return asyncHandler(async (req, res) => {
    if (!nodesCache) {
      throw new HttpError(
        ProblemCode.SlurmUnavailable,
        'Node snapshot is not initialized.'
      );
    }
    const parsed = statsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`)
        .join('; ');
      throw new HttpError(ProblemCode.BadRequest, `Invalid query parameters: ${detail}`);
    }
    // `partition=all` means cluster-wide.
    const partition =
      parsed.data.partition === undefined || parsed.data.partition === 'all'
        ? null
        : parsed.data.partition;
    try {
      const thresholds = getRuntimeConfig().stats.cpuLoad.thresholds;
      const service = new StatsService(nodesCache, thresholds);
      const result = await service.getStats(partition);
      res.json(toStatsResponse(result));
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

export { createStatsHandler, statsQuerySchema, toStatsResponse };
export type { StatsQuery };
