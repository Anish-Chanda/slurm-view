import { CommandError, runCommand } from './command-runner.js';
import type { RunCommandResult } from './command-runner.js';

// Newest first. v0.0.43 is the compatibility floor for Slurm 25.05+.
const SUPPORTED_DATA_PARSERS = ['v0.0.45', 'v0.0.44', 'v0.0.43'] as const;

type SupportedDataParser = (typeof SUPPORTED_DATA_PARSERS)[number];

const PARSER_TOKEN_PATTERN = /v\d+\.\d+\.\d+/g;

type RunFn = (
  executable: string,
  args: readonly string[],
  options?: { timeoutMs?: number; maxBufferBytes?: number }
) => Promise<RunCommandResult>;

// Permanent environment incompatibility. Startup exits non-zero on these.
class SlurmCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlurmCompatibilityError';
  }
}

function extractParserTokens(output: string): string[] {
  const seen = new Set<string>();
  for (const match of output.matchAll(PARSER_TOKEN_PATTERN)) {
    seen.add(match[0]);
  }
  return [...seen];
}

// Newest supported parser present in `--json=list` stdout, or null.
function selectDataParser(listOutput: string): SupportedDataParser | null {
  const installed = new Set(extractParserTokens(listOutput));
  for (const parser of SUPPORTED_DATA_PARSERS) {
    if (installed.has(parser)) {
      return parser;
    }
  }
  return null;
}

// Runs `scontrol --json=list` once; the result is reused by all adapters.
async function negotiateDataParser(deps: { run?: RunFn } = {}): Promise<SupportedDataParser> {
  const run: RunFn = deps.run ?? runCommand;

  let stdout: string;
  try {
    ({ stdout } = await run('scontrol', ['--json=list'], {
      timeoutMs: 10_000,
      maxBufferBytes: 1024 * 1024,
    }));
  } catch (error) {
    const detail = error instanceof CommandError
      ? `${error.kind}: ${error.message}`
      : error instanceof Error ? error.message : String(error);
    throw new SlurmCompatibilityError(
      `Slurm compatibility check failed: unable to list data parsers via 'scontrol --json=list' (${detail}). ` +
      `Ensure Slurm CLI tools are installed and on PATH.`
    );
  }

  const selected = selectDataParser(stdout);
  if (selected === null) {
    const detected = extractParserTokens(stdout);
    throw new SlurmCompatibilityError(
      `Unsupported Slurm installation: none of the supported data parsers are installed. ` +
      `Supported: ${SUPPORTED_DATA_PARSERS.join(', ')}. ` +
      `Detected: ${detected.length > 0 ? detected.join(', ') : '(none found)'}.`
    );
  }
  return selected;
}

export {
  SlurmCompatibilityError,
  SUPPORTED_DATA_PARSERS,
  extractParserTokens,
  negotiateDataParser,
  selectDataParser,
};
export type { SupportedDataParser };
