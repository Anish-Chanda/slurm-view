import { normalizeSlurmNumber } from './schemas/common.js';

// Slurm reports node cpu_load in hundredths.
const CPU_LOAD_HUNDREDTHS = 100;

function normalizeCpuLoad(input: unknown): number | null {
  const { value } = normalizeSlurmNumber(input);
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value / CPU_LOAD_HUNDREDTHS;
}

export { CPU_LOAD_HUNDREDTHS, normalizeCpuLoad };
