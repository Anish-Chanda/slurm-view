import { execFile as defaultExecFile } from 'node:child_process';
import type { ExecException, ExecFileOptions } from 'node:child_process';

export const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
export const DEFAULT_COMMAND_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

const STDERR_SNIPPET_MAX_CHARS = 500;

export type CommandErrorKind =
  | 'executable-not-found'
  | 'timeout'
  | 'output-too-large'
  | 'non-zero-exit'
  | 'spawn-failed'
  | 'aborted';

// Log-only diagnostics; never expose stderr or paths through the API.
class CommandError extends Error {
  public readonly kind: CommandErrorKind;
  public readonly executable: string;
  public readonly args: readonly string[];
  public readonly exitCode: number | null;
  public readonly stderrSnippet: string;

  constructor(options: {
    kind: CommandErrorKind;
    executable: string;
    args: readonly string[];
    exitCode?: number | null;
    stderrSnippet?: string;
    message: string;
  }) {
    super(options.message);
    this.name = 'CommandError';
    this.kind = options.kind;
    this.executable = options.executable;
    this.args = options.args;
    this.exitCode = options.exitCode ?? null;
    this.stderrSnippet = options.stderrSnippet ?? '';
  }
}

interface RunCommandOptions {
  timeoutMs?: number;
  maxBufferBytes?: number;
  signal?: AbortSignal;
}

interface RunCommandResult {
  stdout: string;
  stderr: string;
}

type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: (error: (ExecException & { code?: unknown }) | null, stdout: string, stderr: string) => void
) => unknown;

interface RunCommandDeps {
  execFileFn?: ExecFileLike;
}

function snippet(value: string): string {
  return value.length > STDERR_SNIPPET_MAX_CHARS
    ? `${value.slice(0, STDERR_SNIPPET_MAX_CHARS)}…`
    : value;
}

function toCommandError(
  executable: string,
  args: readonly string[],
  error: ExecException & { code?: unknown },
  stderr: string,
  aborted: boolean
): CommandError {
  if (aborted) {
    return new CommandError({
      kind: 'aborted',
      executable,
      args,
      stderrSnippet: snippet(stderr),
      message: `Command aborted: ${executable}`,
    });
  }

  if (error.code === 'ENOENT') {
    return new CommandError({
      kind: 'executable-not-found',
      executable,
      args,
      stderrSnippet: snippet(stderr),
      message: `Executable not found: ${executable}`,
    });
  }

  // A child killed for exceeding maxBuffer also reports killed; the buffer
  // check takes priority over the timeout check below.
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxbuffer/i.test(error.message)) {
    return new CommandError({
      kind: 'output-too-large',
      executable,
      args,
      stderrSnippet: snippet(stderr),
      message: `Command output exceeded buffer limit: ${executable}`,
    });
  }

  // execFile kills the child when its timeout fires.
  if (error.killed === true) {
    return new CommandError({
      kind: 'timeout',
      executable,
      args,
      stderrSnippet: snippet(stderr),
      message: `Command timed out: ${executable}`,
    });
  }

  if (typeof error.code === 'number') {
    return new CommandError({
      kind: 'non-zero-exit',
      executable,
      args,
      exitCode: error.code,
      stderrSnippet: snippet(stderr),
      message: `Command exited with code ${error.code}: ${executable}`,
    });
  }

  return new CommandError({
    kind: 'spawn-failed',
    executable,
    args,
    stderrSnippet: snippet(stderr),
    message: `Failed to run command ${executable}: ${error.message}`,
  });
}

// Runs a binary with an explicit argv array via execFile (no shell, so
// arguments pass through verbatim). Accepts any executable so tests can
// drive process.execPath; Slurm adapters hard-code their own binaries.
async function runCommand(
  executable: string,
  args: readonly string[],
  options: RunCommandOptions = {},
  deps: RunCommandDeps = {}
): Promise<RunCommandResult> {
  if (typeof executable !== 'string' || executable.length === 0) {
    throw new TypeError('executable must be a non-empty string');
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('args must be an array of strings');
  }

  const execFileFn: ExecFileLike =
    deps.execFileFn ?? (defaultExecFile as unknown as ExecFileLike);
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_COMMAND_MAX_BUFFER_BYTES;

  return new Promise<RunCommandResult>((resolve, reject) => {
    execFileFn(
      executable,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: maxBufferBytes,
        encoding: 'utf8',
        signal: options.signal,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            toCommandError(
              executable,
              args,
              error,
              typeof stderr === 'string' ? stderr : '',
              options.signal?.aborted === true
            )
          );
          return;
        }
        resolve({
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
        });
      }
    );
  });
}

export { CommandError, runCommand };
export type { ExecFileLike, RunCommandDeps, RunCommandOptions, RunCommandResult };
