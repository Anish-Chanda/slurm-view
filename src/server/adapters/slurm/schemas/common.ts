import { z } from 'zod';

// The schema models consumed fields and strips unknown keys.

// Slurm wraps scalars as `{ number, set, infinite }`. Some fields also arrive
// as plain numbers or strings.
const slurmNumericSchema = z.union([
  z.number(),
  z.string(),
  z.object({
    number: z.union([z.number(), z.string()]).nullish(),
    set: z.boolean().nullish(),
    infinite: z.boolean().nullish(),
  }),
]);

type SlurmNumeric = z.infer<typeof slurmNumericSchema>;

interface NormalizedNumber {
  value: number | null;
  infinite: boolean;
}

function normalizeSlurmNumber(input: unknown): NormalizedNumber {
  if (input === null || input === undefined) {
    return { value: null, infinite: false };
  }
  if (typeof input === 'object') {
    const wrapper = input as { number?: unknown; set?: unknown; infinite?: unknown };
    if (wrapper.infinite === true) {
      return { value: null, infinite: true };
    }
    if (wrapper.set === false) {
      return { value: null, infinite: false };
    }
    return normalizeSlurmNumber(wrapper.number ?? null);
  }
  if (typeof input === 'number' || typeof input === 'string') {
    const parsed = typeof input === 'number' ? input : Number(input.trim());
    return Number.isFinite(parsed)
      ? { value: parsed, infinite: false }
      : { value: null, infinite: false };
  }
  return { value: null, infinite: false };
}

// The schema keeps known envelope notice fields and strips the rest.
const slurmNoticeSchema = z.object({
  description: z.string().nullish(),
  message: z.string().nullish(),
  error: z.string().nullish(),
  error_code: z.union([z.string(), z.number()]).nullish(),
  source: z.string().nullish(),
});

type SlurmNotice = z.infer<typeof slurmNoticeSchema>;

function describeNotice(notice: SlurmNotice): string {
  return (
    notice.description ?? notice.message ?? notice.error ?? 'unknown Slurm error'
  );
}

export { describeNotice, normalizeSlurmNumber, slurmNoticeSchema, slurmNumericSchema };
export type { NormalizedNumber, SlurmNotice, SlurmNumeric };
