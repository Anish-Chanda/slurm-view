import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { HttpError } from '../middleware/error-handler.js';
import { ProblemCode } from '../../shared/api/v1/common.js';
import type { PartitionsResponse } from '../../shared/api/v1/partitions.js';
import type { PartitionsCache } from '../cache/partitions-cache.js';
import { toHttpError } from './errors.js';

const partitionsQuerySchema = z.strictObject({});

function createPartitionsHandler(partitionsCache: PartitionsCache | undefined) {
  return asyncHandler(async (req, res) => {
    if (!partitionsCache) {
      throw new HttpError(
        ProblemCode.SlurmUnavailable,
        'Partition snapshot is not initialized.'
      );
    }
    const parsed = partitionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`)
        .join('; ');
      throw new HttpError(ProblemCode.BadRequest, `Invalid query parameters: ${detail}`);
    }
    try {
      const snapshot = await partitionsCache.getOrLoad();
      const body: PartitionsResponse = {
        partitions: [...snapshot.partitions],
        updatedAt: snapshot.capturedAt.toISOString(),
      };
      res.json(body);
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

export { createPartitionsHandler, partitionsQuerySchema };
