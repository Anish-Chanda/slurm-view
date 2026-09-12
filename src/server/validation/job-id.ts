import { z } from 'zod';
import { CANONICAL_JOB_ID_PATTERN } from '../../shared/api/v1/jobs.js';

// Canonical IDs the jobs API can emit. Step suffixes (".batch", ".0") are
// outside this space: JobsCache has no step records for them to resolve to.
const canonicalJobIdSchema = z.string().regex(CANONICAL_JOB_ID_PATTERN).max(64);

export { canonicalJobIdSchema };
