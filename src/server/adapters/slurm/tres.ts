import type { GpuRequest } from '../../models/job.js';

// Memory TRES values default to MiB; K/M/G/T/P suffixes select other sizes.
const MEMORY_UNIT_TO_MIB: Record<string, number> = {
  K: 1 / 1024,
  M: 1,
  G: 1024,
  T: 1024 * 1024,
  P: 1024 * 1024 * 1024,
};

const MEMORY_VALUE_PATTERN = /^(-?\d+(?:\.\d+)?)\s*([KMGTP])?$/i;

interface ParsedTres {
  cpus: number | null;
  memoryMiB: number | null;
  nodes: number | null;
  gpus: GpuRequest;
  /** Site-defined/unknown resources preserved verbatim. */
  other: Record<string, string>;
}

function parseMemoryToMiB(raw: string): number | null {
  const match = raw.trim().match(MEMORY_VALUE_PATTERN);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }
  const factor = MEMORY_UNIT_TO_MIB[(match[2] ?? 'M').toUpperCase()] ?? 1;
  return Math.round(amount * factor);
}

function parseCount(raw: string): number | null {
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

const GPU_TRES_PATTERN = /^gres\/gpu(?::(.+))?$/;

// `(IDX:…)` suffixes are stripped; the count already carries the size.
function parseGpuTresEntry(key: string, value: string): { gpuType: string; count: number } | null {
  const match = key.match(GPU_TRES_PATTERN);
  if (!match) {
    return null;
  }
  const countText = value.split('(')[0]?.trim() ?? '';
  const count = parseCount(countText);
  if (count === null) {
    return null;
  }
  const gpuType = (match[1] ?? '').trim();
  return { gpuType: gpuType.length > 0 ? gpuType : 'unknown', count };
}

function emptyGpuRequest(): GpuRequest {
  return { total: 0, byType: {} };
}

function addGpu(request: GpuRequest, gpuType: string, count: number): void {
  request.total += count;
  request.byType[gpuType] = (request.byType[gpuType] ?? 0) + count;
}

function parseTresString(input: string | null | undefined): ParsedTres {
  const result: ParsedTres = {
    cpus: null,
    memoryMiB: null,
    nodes: null,
    gpus: emptyGpuRequest(),
    other: {},
  };
  if (typeof input !== 'string' || input.trim().length === 0) {
    return result;
  }

  // Generic `gres/gpu=N` and typed `gres/gpu:<type>=N` can describe the
  // same GPUs, so the generic total wins when present instead of summing.
  let genericGpus: number | null = null;
  const typedGpus = emptyGpuRequest();

  for (const pair of input.split(',')) {
    const separator = pair.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key.length === 0 || value.length === 0 || value === '(null)') {
      continue;
    }

    if (key === 'cpu') {
      result.cpus = parseCount(value);
    } else if (key === 'mem') {
      result.memoryMiB = parseMemoryToMiB(value);
    } else if (key === 'node') {
      result.nodes = parseCount(value);
    } else {
      const gpu = parseGpuTresEntry(key, value);
      if (!gpu) {
        result.other[key] = value;
      } else if (gpu.gpuType === 'unknown') {
        genericGpus = gpu.count;
      } else {
        addGpu(typedGpus, gpu.gpuType, gpu.count);
      }
    }
  }

  if (genericGpus !== null) {
    result.gpus = {
      total: genericGpus,
      byType:
        Object.keys(typedGpus.byType).length > 0
          ? typedGpus.byType
          : { unknown: genericGpus },
    };
  } else {
    result.gpus = typedGpus;
  }
  return result;
}

// Non-GPU GRES such as `shard` is skipped: shared GRES is not whole GPUs.
function parseGresDetailEntries(entries: readonly unknown[]): GpuRequest {
  const request = emptyGpuRequest();
  for (const entry of entries) {
    if (typeof entry !== 'string') {
      continue;
    }
    const match = entry.match(/^gpu(?::([^:]+))?:(\d+)/);
    if (!match) {
      continue;
    }
    addGpu(request, match[1] ?? 'unknown', Number(match[2]));
  }
  return request;
}

export {
  addGpu,
  emptyGpuRequest,
  parseGresDetailEntries,
  parseMemoryToMiB,
  parseTresString,
};
export type { ParsedTres };
