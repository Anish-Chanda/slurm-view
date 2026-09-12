import { runCommandCapture } from './command-runner.js';
import type { CapturedCommandResult, RunCommandOptions } from './command-runner.js';
import { CommandError } from './command-runner.js';
import { UpstreamInvalidError } from './errors.js';
import { canonicalJobIdSchema } from '../../validation/job-id.js';
import type { Efficiency } from '../../models/efficiency.js';

const SEFF_COMMAND_TIMEOUT_MS = 15_000;
const SEFF_COMMAND_MAX_BUFFER_BYTES = 512 * 1024;

class SeffNotAvailableError extends Error {
  constructor() {
    super('seff executable is not available');
    this.name = 'SeffNotAvailableError';
  }
}

type SeffRunFn = (
  executable: string,
  args: readonly string[],
  options?: RunCommandOptions
) => Promise<CapturedCommandResult>;

// seff elapsed values look like "00:07:53" or "3-05:12:33".
function parseElapsedToSeconds(input: string): number | null {
  const match = input.trim().match(/^(?:(\d+)-)?(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) {
    return null;
  }
  const days = Number(match[1] ?? 0);
  let hours: number;
  let minutes: number;
  let seconds: number;
  if (match[4] === undefined) {
    hours = 0;
    minutes = Number(match[2]);
    seconds = Number(match[3]);
  } else {
    hours = Number(match[2]);
    minutes = Number(match[3]);
    seconds = Number(match[4]);
  }
  if (![days, hours, minutes, seconds].every((part) => Number.isFinite(part) && part >= 0)) {
    return null;
  }
  if (minutes >= 60 || seconds >= 60) {
    return null;
  }
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

// seff memory values look like "39.10 GB" or "512.00 MB", where MB means
// MiB and GB means GiB.
const SEFF_MEMORY_TO_MIB: Record<string, number> = {
  K: 1 / 1024,
  M: 1,
  G: 1024,
  T: 1024 * 1024,
  P: 1024 * 1024 * 1024,
  E: 1024 * 1024 * 1024 * 1024,
};

function parseSeffMemoryToMiB(input: string): number | null {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGTPE])B$/i);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }
  const factor = SEFF_MEMORY_TO_MIB[(match[2] ?? 'M').toUpperCase()] ?? null;
  if (factor === null) {
    return null;
  }
  return Math.round(amount * factor);
}

// Percentages pass through untouched, including values above 100.
function parseSeffPercent(input: string): number | null {
  if (input.trim().length === 0) {
    return null;
  }
  const value = Number(input.trim());
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function splitSeffLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^([^:]+):\s*(.*)$/);
  if (!match) {
    return null;
  }
  return { key: match[1]!.trim(), value: (match[2] ?? '').trim() };
}

// Throws UpstreamInvalidError when stdout carries no usable efficiency data,
// including efficiency labels with nothing parseable behind them.
function parseSeffStdout(stdout: string): Efficiency {
  const efficiency: Efficiency = {
    cpu: { efficiencyPercent: null, utilizedSeconds: null, allocatedCoreSeconds: null },
    memory: { efficiencyPercent: null, utilizedMiB: null, allocatedMiB: null },
    wallClockSeconds: null,
  };

  for (const line of stdout.split('\n')) {
    const parsed = splitSeffLine(line);
    if (!parsed || parsed.value.length === 0) {
      continue;
    }
    switch (parsed.key) {
      case 'CPU Utilized': {
        efficiency.cpu.utilizedSeconds = parseElapsedToSeconds(parsed.value);
        break;
      }
      case 'CPU Efficiency': {
        const match = parsed.value.match(/^(\S+)%\s+of\s+(.+?)\s+core-walltime\s*$/);
        if (match) {
          efficiency.cpu.efficiencyPercent = parseSeffPercent(match[1]!);
          efficiency.cpu.allocatedCoreSeconds = parseElapsedToSeconds(match[2]!);
        }
        break;
      }
      case 'Job Wall-clock time': {
        efficiency.wallClockSeconds = parseElapsedToSeconds(parsed.value);
        break;
      }
      case 'Memory Utilized': {
        efficiency.memory.utilizedMiB = parseSeffMemoryToMiB(parsed.value);
        break;
      }
      case 'Memory Efficiency': {
        const match = parsed.value.match(/^(\S+)%\s+of\s+(\S+(?:\s+[KMGTPE]B)?)(?:\s+\([^)]+\))?\s*$/i);
        if (match) {
          efficiency.memory.efficiencyPercent = parseSeffPercent(match[1]!);
          efficiency.memory.allocatedMiB = parseSeffMemoryToMiB(match[2]!);
        }
        break;
      }
      default:
        break;
    }
  }

  const usableValues = [
    efficiency.cpu.efficiencyPercent,
    efficiency.cpu.utilizedSeconds,
    efficiency.cpu.allocatedCoreSeconds,
    efficiency.memory.efficiencyPercent,
    efficiency.memory.utilizedMiB,
    efficiency.memory.allocatedMiB,
    efficiency.wallClockSeconds,
  ].filter((value) => value !== null);

  if (usableValues.length === 0) {
    throw new UpstreamInvalidError('seff returned no usable efficiency data');
  }
  return efficiency;
}

async function fetchEfficiency(
  jobId: string,
  deps: { run?: SeffRunFn; signal?: AbortSignal } = {}
): Promise<Efficiency> {
  const parsed = canonicalJobIdSchema.safeParse(jobId);
  if (!parsed.success) {
    throw new UpstreamInvalidError(`Invalid job ID for seff: ${jobId}`);
  }
  const run: SeffRunFn = deps.run ?? runCommandCapture;
  let captured: CapturedCommandResult;
  try {
    captured = await run('seff', [parsed.data], {
      timeoutMs: SEFF_COMMAND_TIMEOUT_MS,
      maxBufferBytes: SEFF_COMMAND_MAX_BUFFER_BYTES,
      signal: deps.signal,
    });
  } catch (error) {
    if (error instanceof CommandError && error.kind === 'executable-not-found') {
      throw new SeffNotAvailableError();
    }
    throw error;
  }
  // seff has historically exited non-zero after printing usable output, so a
  // non-zero exit with parseable stdout is accepted here.
  return parseSeffStdout(captured.stdout);
}

export {
  SEFF_COMMAND_MAX_BUFFER_BYTES,
  SEFF_COMMAND_TIMEOUT_MS,
  SeffNotAvailableError,
  fetchEfficiency,
  parseElapsedToSeconds,
  parseSeffMemoryToMiB,
  parseSeffPercent,
  parseSeffStdout,
};
export type { SeffRunFn };
