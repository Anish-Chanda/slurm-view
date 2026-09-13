// sprio adapter for priority evidence. sprio has no JSON mode; parse
// whitespace-delimited tables. Factor columns vary by cluster, so keep
// whatever the header advertises.
import { runCommand } from './command-runner.js';
import type { SlurmContext, SlurmRunFn } from './context.js';

const SPRIO_COMMAND_TIMEOUT_MS = 15_000;
const SPRIO_COMMAND_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

interface SprioJobFactors {
  readonly jobId: string;
  readonly priority: number | null;
  // Factor name (upper-cased header token) to value; null when unparseable.
  readonly factors: Readonly<Record<string, number | null>>;
}

function splitColumns(line: string): string[] {
  return line.trim().split(/\s+/).filter((token) => token.length > 0);
}

function parseNumericToken(token: string | undefined): number | null {
  if (token === undefined) {
    return null;
  }
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.toUpperCase() === 'N/A') {
    return null;
  }
  // Priorities and weights are unsigned; negative or NaN means unknown.
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseSprioTable(stdout: string, normalized: boolean): SprioJobFactors[] {
  const rows: SprioJobFactors[] = [];
  const lines = stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length < 2) {
    return rows;
  }
  const header = splitColumns(lines[0] ?? '');
  const jobIdx = header.findIndex((token) => token.toUpperCase() === 'JOBID');
  const prioIdx = header.findIndex((token) => token.toUpperCase() === 'PRIORITY');
  if (jobIdx === -1 || prioIdx === -1) {
    return rows;
  }
  for (const line of lines.slice(1)) {
    // Skip the weights pseudo-row.
    if (/^\s*weights?\b/i.test(line)) {
      continue;
    }
    const cols = splitColumns(line);
    const jobId = cols[jobIdx]?.trim() ?? '';
    if (jobId.length === 0) {
      continue;
    }
    const factors: Record<string, number | null> = {};
    for (let i = 0; i < header.length; i += 1) {
      if (i === jobIdx || i === prioIdx) {
        continue;
      }
      const name = (header[i] ?? '').toUpperCase();
      if (name.length === 0) {
        continue;
      }
      factors[name] = parseNumericToken(cols[i]);
    }
    rows.push({
      jobId,
      priority: parseNumericToken(cols[prioIdx]),
      factors,
    });
  }
  return rows;
}

function parseSprioWeights(stdout: string): Readonly<Record<string, number | null>> {
  const weights: Record<string, number | null> = {};
  const lines = stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return weights;
  }
  // `sprio -w` prints a header plus a Weights row; some clusters emit only
  // the row.
  let header: string[] = [];
  let row: string[] = [];
  if (/^\s*weights?\b/i.test(lines[0] ?? '')) {
    row = splitColumns(lines[0] ?? '');
  } else {
    header = splitColumns(lines[0] ?? '');
    const weightsLine = lines.find((line) => /^\s*weights?\b/i.test(line));
    if (weightsLine === undefined) {
      return weights;
    }
    row = splitColumns(weightsLine);
  }
  if (header.length === 0) {
    // No header means columns cannot be attributed.
    return weights;
  }
  const start = /^\s*weights?\b/i.test(row[0] ?? '') ? 1 : 0;
  // Header includes JOBID/PRIORITY placeholders; the weights row may omit
  // them, so align from the right when lengths differ.
  const offset = Math.max(0, header.length - row.length - (start === 0 ? 0 : 0));
  for (let i = start; i < row.length; i += 1) {
    const name = (header[i + offset] ?? '').toUpperCase();
    if (name.length === 0 || name === 'JOBID' || name === 'PRIORITY') {
      continue;
    }
    weights[name] = parseNumericToken(row[i]);
  }
  return weights;
}

async function fetchSprioJob(
  context: SlurmContext,
  jobId: string,
  options: { normalized?: boolean; signal?: AbortSignal } = {}
): Promise<SprioJobFactors | null> {
  const run: SlurmRunFn = context.run ?? runCommand;
  const args = options.normalized === true ? ['-n', '-j', jobId] : ['-j', jobId];
  const { stdout } = await run('sprio', args, {
    timeoutMs: SPRIO_COMMAND_TIMEOUT_MS,
    maxBufferBytes: SPRIO_COMMAND_MAX_BUFFER_BYTES,
    signal: options.signal,
  });
  const rows = parseSprioTable(stdout, options.normalized === true);
  // Exact JOBID match only.
  return rows.find((row) => row.jobId === jobId) ?? null;
}

async function fetchSprioWeights(
  context: SlurmContext,
  options: { signal?: AbortSignal } = {}
): Promise<Readonly<Record<string, number | null>>> {
  const run: SlurmRunFn = context.run ?? runCommand;
  const { stdout } = await run('sprio', ['-w'], {
    timeoutMs: SPRIO_COMMAND_TIMEOUT_MS,
    maxBufferBytes: SPRIO_COMMAND_MAX_BUFFER_BYTES,
    signal: options.signal,
  });
  return parseSprioWeights(stdout);
}

export {
  SPRIO_COMMAND_MAX_BUFFER_BYTES,
  SPRIO_COMMAND_TIMEOUT_MS,
  fetchSprioJob,
  fetchSprioWeights,
  parseSprioTable,
  parseSprioWeights,
};
export type { SprioJobFactors };
