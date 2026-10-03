import { z } from 'zod';
import { slurmNumericSchema } from './common.js';

// This schema models the fields used to normalize targeted scontrol JSON.
const slurmExitCodeSchema = z.object({
  return_code: slurmNumericSchema.nullish(),
});

const rawJobSchema = z.object({
  job_id: z.union([z.string(), z.number()]),
  array_job_id: slurmNumericSchema.nullish(),
  array_task_id: slurmNumericSchema.nullish(),
  partition: z.string().nullish(),
  name: z.string().nullish(),
  user_name: z.string().nullish(),
  qos: z.string().nullish(),
  account: z.string().nullish(),
  job_state: z.union([z.string(), z.array(z.string())]).nullish(),
  state_reason: z.string().nullish(),
  time_limit: slurmNumericSchema.nullish(),
  submit_time: slurmNumericSchema.nullish(),
  eligible_time: slurmNumericSchema.nullish(),
  start_time: slurmNumericSchema.nullish(),
  end_time: slurmNumericSchema.nullish(),
  priority: slurmNumericSchema.nullish(),
  tasks: slurmNumericSchema.nullish(),
  cpus_per_task: slurmNumericSchema.nullish(),
  features: z.string().nullish(),
  resv_name: z.string().nullish(),
  wckey: z.string().nullish(),
  batch_host: z.string().nullish(),
  node_count: slurmNumericSchema.nullish(),
  nodes: z.union([z.string(), z.array(z.union([z.string(), z.number()]))]).nullish(),
  tres_req_str: z.string().nullish(),
  tres_alloc_str: z.string().nullish(),
  gres_detail: z.array(z.union([z.string(), z.number()])).nullish(),
  command: z.string().nullish(),
  current_working_directory: z.string().nullish(),
  standard_output: z.string().nullish(),
  standard_error: z.string().nullish(),
  dependency: z.string().nullish(),
  exit_code: slurmExitCodeSchema.nullish(),
  derived_exit_code: slurmExitCodeSchema.nullish(),
  flags: z.union([z.array(z.string()), z.string()]).nullish(),
});

type RawJob = z.infer<typeof rawJobSchema>;

export { rawJobSchema };
export type { RawJob };
