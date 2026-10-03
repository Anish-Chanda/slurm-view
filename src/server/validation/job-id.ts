import { z } from 'zod';
import { CANONICAL_JOB_ID_PATTERN } from '../../shared/api/v1/jobs.js';

// The API accepts numeric jobs and numeric array tasks. Step suffixes such as
// ".batch" and ".0" are outside this contract.
const canonicalJobIdSchema = z.string().regex(CANONICAL_JOB_ID_PATTERN).max(64);

export { canonicalJobIdSchema };
