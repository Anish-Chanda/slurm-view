import { asyncHandler } from '../middleware/async-handler.js';
import { HttpError } from '../middleware/error-handler.js';
import { ProblemCode } from '../../shared/api/v1/common.js';
import type { EfficiencyResponse } from '../../shared/api/v1/efficiency.js';
import type { JobsCache } from '../cache/jobs-cache.js';
import { JobsService } from '../services/jobs-service.js';
import type { Efficiency } from '../models/efficiency.js';
import { SeffNotAvailableError, fetchEfficiency } from '../adapters/slurm/seff.js';
import type { SeffRunFn } from '../adapters/slurm/seff.js';
import { canonicalJobIdSchema } from '../validation/job-id.js';
import { toHttpError } from './errors.js';

function toEfficiencyResponse(efficiency: Efficiency, updatedAt: Date): EfficiencyResponse {
  return {
    cpu: { ...efficiency.cpu },
    memory: { ...efficiency.memory },
    wallClockSeconds: efficiency.wallClockSeconds,
    updatedAt: updatedAt.toISOString(),
  };
}

// seff runs only for live COMPLETED jobs; anything else never spawns it.
function createEfficiencyHandler(jobsCache: JobsCache | undefined, run?: SeffRunFn) {
  return asyncHandler(async (req, res) => {
    if (!jobsCache) {
      throw new HttpError(
        ProblemCode.SlurmUnavailable,
        'Jobs snapshot is not initialized.'
      );
    }
    const parsed = canonicalJobIdSchema.safeParse(req.params.id);
    if (!parsed.success) {
      throw new HttpError(ProblemCode.BadRequest, `Invalid job ID: ${req.params.id}`);
    }
    try {
      const service = new JobsService(jobsCache);
      const detail = await service.getJobById(parsed.data);
      if (detail === null) {
        throw new HttpError(
          ProblemCode.NotFound,
          `Job ${parsed.data} is no longer available in the live scheduler data. Historical accounting is not queried.`
        );
      }
      if (detail.job.state !== 'COMPLETED') {
        throw new HttpError(
          ProblemCode.BadRequest,
          'Efficiency data is only available for completed jobs.'
        );
      }
      const efficiency = await fetchEfficiency(parsed.data, run ? { run } : {});
      res.json(toEfficiencyResponse(efficiency, new Date()));
    } catch (error) {
      if (error instanceof SeffNotAvailableError) {
        throw new HttpError(
          ProblemCode.SlurmUnavailable,
          "Efficiency data isn't available on this cluster."
        );
      }
      throw toHttpError(error);
    }
  });
}

export { createEfficiencyHandler, toEfficiencyResponse };
