import type { RunCommandOptions, RunCommandResult } from './command-runner.js';
import type { SupportedDataParser } from './parser-version.js';

type SlurmRunFn = (
  executable: string,
  args: readonly string[],
  options?: RunCommandOptions
) => Promise<RunCommandResult>;

interface SlurmContext {
  parser: SupportedDataParser;
  run?: SlurmRunFn;
}

export type { SlurmContext, SlurmRunFn };
