import { HttpError } from '../middleware/error-handler.js';
import { ProblemCode } from '../../shared/api/v1/common.js';
import { CommandError } from '../adapters/slurm/command-runner.js';
import {
  SlurmUpstreamError,
  UpstreamInvalidError,
} from '../adapters/slurm/errors.js';

// Logs full internals server-side; clients get a generic detail per code.
function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof CommandError || error instanceof SlurmUpstreamError) {
    const logged = error.stack ?? error.message;
    console.error(`[v1] Request failed (SLURM_UNAVAILABLE): ${logged}`);
    return new HttpError(
      ProblemCode.SlurmUnavailable,
      'Slurm is temporarily unavailable; try again shortly.'
    );
  }
  if (error instanceof UpstreamInvalidError) {
    const logged = error.stack ?? error.message;
    console.error(`[v1] Request failed (UPSTREAM_INVALID_RESPONSE): ${logged}`);
    return new HttpError(
      ProblemCode.UpstreamInvalidResponse,
      'Received an invalid response from Slurm; try again shortly.'
    );
  }
  const logged = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[v1] Request failed (INTERNAL_ERROR): ${logged}`);
  return new HttpError(ProblemCode.InternalError);
}

export { toHttpError };
