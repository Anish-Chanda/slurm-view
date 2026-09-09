import { z } from 'zod';
import type { SupportedDataParser } from '../parser-version.js';
import { slurmNoticeSchema, slurmNumericSchema } from './common.js';

const rawNodeSchema = z.object({
  name: z.string(),
  state: z.union([z.string(), z.array(z.string())]).nullish(),
  partitions: z.array(z.string()).nullish(),
  cpus: slurmNumericSchema.nullish(),
  effective_cpus: slurmNumericSchema.nullish(),
  alloc_cpus: slurmNumericSchema.nullish(),
  alloc_idle_cpus: slurmNumericSchema.nullish(),
  cpu_load: slurmNumericSchema.nullish(),
  real_memory: slurmNumericSchema.nullish(),
  alloc_memory: slurmNumericSchema.nullish(),
  free_mem: slurmNumericSchema.nullish(),
  gres: z.string().nullish(),
  gres_used: z.string().nullish(),
  gres_drained: z.string().nullish(),
});

type RawNode = z.infer<typeof rawNodeSchema>;

const nodeResponseEnvelopeSchema = z.object({
  nodes: z.array(rawNodeSchema),
  meta: z.unknown().optional(),
  errors: z.array(slurmNoticeSchema).nullish(),
  warnings: z.array(slurmNoticeSchema).nullish(),
  last_update: z.unknown().optional(),
});

type NodeResponseEnvelope = z.infer<typeof nodeResponseEnvelopeSchema>;

const nodeResponseSchemas: Record<SupportedDataParser, typeof nodeResponseEnvelopeSchema> = {
  'v0.0.45': nodeResponseEnvelopeSchema,
  'v0.0.44': nodeResponseEnvelopeSchema,
  'v0.0.43': nodeResponseEnvelopeSchema,
};

function nodeResponseSchemaFor(parser: SupportedDataParser): typeof nodeResponseEnvelopeSchema {
  return nodeResponseSchemas[parser];
}

export { nodeResponseSchemaFor, nodeResponseSchemas, rawNodeSchema };
export type { NodeResponseEnvelope, RawNode };
