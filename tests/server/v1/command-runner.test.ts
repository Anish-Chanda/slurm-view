import { CommandError, runCommand } from '../../../src/server/adapters/slurm/command-runner.js';
import type { ExecFileLike } from '../../../src/server/adapters/slurm/command-runner.js';

const NODE = process.execPath;

describe('runCommand', () => {
  test('captures stdout on success', async () => {
    const result = await runCommand(NODE, ['-e', 'console.log("hello")']);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.stderr).toBe('');
  });

  test('passes argv verbatim without shell interpretation', async () => {
    const args = ['a b', 'x;touch /tmp/slurm-view-pwned', '$(whoami)', '`id`', "it's", '"quoted"', '|&><'];
    const result = await runCommand(
      NODE,
      ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...args],
      { timeoutMs: 10_000 }
    );
    expect(JSON.parse(result.stdout)).toEqual(args);
  });

  test('shell metacharacters in a single arg are not executed', async () => {
    const sentinel = 'slurm-view-no-shell';
    const result = await runCommand(
      NODE,
      ['-e', `console.log(process.argv[1]); console.log("${sentinel}")`, 'a; echo INJECTED'],
      { timeoutMs: 10_000 }
    );
    // If a shell interpreted the arg, `echo INJECTED` would emit an extra
    // bare `INJECTED` line. Verbatim argv yields exactly two lines.
    expect(result.stdout.split('\n').filter((line) => line.length > 0)).toEqual([
      'a; echo INJECTED',
      sentinel,
    ]);
  });

  test('non-zero exit reports exit code and stderr', async () => {
    const failure = runCommand(
      NODE,
      ['-e', 'console.error("boom-stderr"); process.exit(3)'],
      { timeoutMs: 10_000 }
    );
    await expect(failure).rejects.toMatchObject({
      kind: 'non-zero-exit',
      exitCode: 3,
    } satisfies Partial<CommandError>);
    await expect(failure).rejects.toBeInstanceOf(CommandError);
    let error: CommandError | null = null;
    try {
      await runCommand(NODE, ['-e', 'console.error("boom-stderr"); process.exit(3)'], {
        timeoutMs: 10_000,
      });
    } catch (err) {
      error = err as CommandError;
    }
    expect(error).toBeInstanceOf(CommandError);
    expect(error?.stderrSnippet).toContain('boom-stderr');
    expect(error?.message).not.toContain('boom-stderr');
  });

  test('missing executable is typed', async () => {
    await expect(
      runCommand('__slurm_view_definitely_missing_binary__', ['--version'])
    ).rejects.toMatchObject({ kind: 'executable-not-found' });
  });

  test('timeout is typed', async () => {
    await expect(
      runCommand(NODE, ['-e', 'setTimeout(() => {}, 30_000)'], { timeoutMs: 200 })
    ).rejects.toMatchObject({ kind: 'timeout' });
  }, 10_000);

  test('AbortSignal cancellation is typed', async () => {
    const controller = new AbortController();
    const pending = runCommand(NODE, ['-e', 'setTimeout(() => {}, 30_000)'], {
      timeoutMs: 20_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  }, 10_000);

  test('output beyond maxBuffer is a bounded failure', async () => {
    await expect(
      runCommand(NODE, ['-e', 'console.log("x".repeat(2 * 1024 * 1024))'], {
        timeoutMs: 10_000,
        maxBufferBytes: 64 * 1024,
      })
    ).rejects.toMatchObject({ kind: 'output-too-large' });
  }, 10_000);

  test('maxBuffer takes priority over the killed/timeout classification', async () => {
    const maxBufferFailure = Object.assign(new Error('maxBuffer exceeded'), {
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      killed: true,
    });
    const execFileFn: ExecFileLike = (_exe, _args, _opts, callback) => {
      callback(maxBufferFailure, '', '');
    };
    await expect(
      runCommand('squeue', ['--json=v0.0.45'], {}, { execFileFn })
    ).rejects.toMatchObject({ kind: 'output-too-large' });
  });

  test('rejects programmer errors directly', async () => {
    await expect(runCommand('', [])).rejects.toBeInstanceOf(TypeError);
    await expect(
      runCommand(NODE, ['ok', 42 as unknown as string])
    ).rejects.toBeInstanceOf(TypeError);
  });
});
