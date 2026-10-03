import { z } from 'zod';
import type { SupportedDataParser } from '../parser-version.js';
import { slurmNoticeSchema } from './common.js';

// scontrol returns partition records under `partitions`. Keep the name and
// discard fields this endpoint does not use.
const rawPartitionSchema = z.object({
  name: z.string(),
});

type RawPartition = z.infer<typeof rawPartitionSchema>;

const partitionsResponseEnvelopeSchema = z.object({
  partitions: z.array(rawPartitionSchema),
  meta: z.unknown().optional(),
  errors: z.array(slurmNoticeSchema).nullish(),
  warnings: z.array(slurmNoticeSchema).nullish(),
  last_update: z.unknown().optional(),
});

type PartitionsResponseEnvelope = z.infer<typeof partitionsResponseEnvelopeSchema>;

const partitionsResponseSchemas: Record<SupportedDataParser, typeof partitionsResponseEnvelopeSchema> = {
  'v0.0.45': partitionsResponseEnvelopeSchema,
  'v0.0.44': partitionsResponseEnvelopeSchema,
  'v0.0.43': partitionsResponseEnvelopeSchema,
};

function partitionsResponseSchemaFor(parser: SupportedDataParser): typeof partitionsResponseEnvelopeSchema {
  return partitionsResponseSchemas[parser];
}

export { partitionsResponseSchemaFor, partitionsResponseSchemas, rawPartitionSchema };
export type { PartitionsResponseEnvelope, RawPartition };
