// HTTP handler for GET /api/v1/jobs/:id/pending-analysis. Validates,
// delegates to PendingAnalysisService, serializes.
import { asyncHandler } from '../middleware/async-handler.js';
import { HttpError } from '../middleware/error-handler.js';
import { ProblemCode } from '../../shared/api/v1/common.js';
import type { PendingAnalysisDto, PendingAnalysisResponse } from '../../shared/api/v1/pending-analysis.js';
import { canonicalJobIdSchema } from '../validation/job-id.js';
import { toHttpError } from './errors.js';
import { PendingAnalysisService } from '../services/pending-analysis-service.js';
import type { PendingAnalysisDeps } from '../services/pending-analysis-service.js';

function toPendingAnalysisResponse(
  result: { stateReason: string | null; analysis: PendingAnalysisDto | null; updatedAt: Date }
): PendingAnalysisResponse {
  return {
    stateReason: result.stateReason,
    analysis: result.analysis,
    updatedAt: result.updatedAt.toISOString(),
  };
}

function createPendingAnalysisHandler(deps: PendingAnalysisDeps | undefined) {
  return asyncHandler(async (req, res) => {
    if (deps === undefined) {
      throw new HttpError(ProblemCode.SlurmUnavailable, 'Pending-analysis service is not initialized.');
    }
    const parsed = canonicalJobIdSchema.safeParse(req.params.id);
    if (!parsed.success) {
      throw new HttpError(ProblemCode.BadRequest, `Invalid job ID: ${req.params.id}`);
    }
    try {
      const service = new PendingAnalysisService(deps);
      const result = await service.analyze(parsed.data);
      res.json(toPendingAnalysisResponse(result));
    } catch (error) {
      throw toHttpError(error);
    }
  });
}

export { createPendingAnalysisHandler, toPendingAnalysisResponse };
