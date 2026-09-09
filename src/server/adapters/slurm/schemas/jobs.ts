import { z } from 'zod';
import type { SupportedDataParser } from '../parser-version.js';
import { slurmNoticeSchema, slurmNumericSchema } from './common.js';

// Only consumed fields are modeled; the rest is stripped. The per-parser
// record keeps each generation an explicit contract; they share one
// definition while the consumed fields stay identical.
const rawJobSchema = z.object({
  job_id: z.union([z.string(), z.number()]),
  array_job_id: z.union([z.string(), z.number()]).nullish(),
  array_task_id: z.union([z.string(), z.number()]).nullish(),
  partition: z.string().nullish(),
  name: z.string().nullish(),
  user_name: z.string().nullish(),
  qos: z.string().nullish(),
  account: z.string().nullish(),
  job_state: z.union([z.string(), z.array(z.string())]).nullish(),
  state_reason: z.string().nullish(),
  time_limit: slurmNumericSchema.nullish(),
  submit_time: slurmNumericSchema.nullish(),
  start_time: slurmNumericSchema.nullish(),
  end_time: slurmNumericSchema.nullish(),
  node_count: slurmNumericSchema.nullish(),
  nodes: z.union([z.string(), z.array(z.union([z.string(), z.number()]))]).nullish(),
  tres_req_str: z.string().nullish(),
  tres_alloc_str: z.string().nullish(),
  gres_detail: z.array(z.union([z.string(), z.number()])).nullish(),
  command: z.string().nullish(),
  current_working_directory: z.string().nullish(),
  standard_output: z.string().nullish(),
  dependency: z.string().nullish(),
  exit_code: z
    .union([
      z.string(),
      z.number(),
      z.object({ status: z.union([z.string(), z.number()]).nullish() }),
    ])
    .nullish(),
  derived_exit_code: z
    .union([
      z.string(),
      z.number(),
      z.object({ status: z.union([z.string(), z.number()]).nullish() }),
    ])
    .nullish(),
  flags: z.union([z.array(z.string()), z.string()]).nullish(),
});

type RawJob = z.infer<typeof rawJobSchema>;

const jobResponseEnvelopeSchema = z.object({
  jobs: z.array(rawJobSchema),
  meta: z.unknown().optional(),
  errors: z.array(slurmNoticeSchema).nullish(),
  warnings: z.array(slurmNoticeSchema).nullish(),
  last_update: z.unknown().optional(),
  last_backfill: z.unknown().optional(),
});

type JobResponseEnvelope = z.infer<typeof jobResponseEnvelopeSchema>;

const jobResponseSchemas: Record<SupportedDataParser, typeof jobResponseEnvelopeSchema> = {
  'v0.0.45': jobResponseEnvelopeSchema,
  'v0.0.44': jobResponseEnvelopeSchema,
  'v0.0.43': jobResponseEnvelopeSchema,
};

function jobResponseSchemaFor(parser: SupportedDataParser): typeof jobResponseEnvelopeSchema {
  return jobResponseSchemas[parser];
}

export { jobResponseSchemaFor, jobResponseSchemas, rawJobSchema };
export type { JobResponseEnvelope, RawJob };
