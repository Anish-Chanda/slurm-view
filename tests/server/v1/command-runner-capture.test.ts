import { CommandError, runCommand, runCommandCapture } from '../../../src/server/adapters/slurm/command-runner.js';
import type { ExecFileLike } from '../../../src/server/adapters/slurm/command-runner.js';

const NODE = process.execPath;

describe('runCommandCapture', () => {
  test('resolves zero exits with output', async () => {
    const result = await runCommandCapture(NODE, ['-e', 'console.log("hello")']);
    expect(result).toMatchObject({ stdout: expect.stringContaining('hello'), exitCode: 0 });
  });

  test('preserves stdout on non-zero exit instead of throwing', async () => {
    const result = await runCommandCapture(NODE, [
      '-e',
      'console.log("usable-data"); process.exit(139)',
    ]);
    expect(result.stdout).toContain('usable-data');
    expect(result.exitCode).toBe(139);
  });

  test('still rejects timeouts without output', async () => {
    await expect(
      runCommandCapture(NODE, ['-e', 'setTimeout(() => {}, 30_000)'], { timeoutMs: 200 })
    ).rejects.toMatchObject({ kind: 'timeout' });
  }, 10_000);

  test('still rejects missing executables', async () => {
    await expect(runCommandCapture('__slurm_view_definitely_missing_binary__', ['--version'])).rejects.toMatchObject(
      { kind: 'executable-not-found' }
    );
  });

  test('still rejects oversized output', async () => {
    await expect(
      runCommandCapture(NODE, ['-e', 'console.log("x".repeat(2 * 1024 * 1024))'], {
        timeoutMs: 10_000,
        maxBufferBytes: 64 * 1024,
      })
    ).rejects.toMatchObject({ kind: 'output-too-large' });
  }, 10_000);

  test('still rejects aborts', async () => {
    const controller = new AbortController();
    const pending = runCommandCapture(NODE, ['-e', 'setTimeout(() => {}, 30_000)'], {
      timeoutMs: 20_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  }, 10_000);

  test('passes argv verbatim without a shell', async () => {
    const args = ['a; echo INJECTED', '$(whoami)'];
    const result = await runCommandCapture(NODE, [
      '-e',
      'console.log(JSON.stringify(process.argv.slice(1)))',
      ...args,
    ]);
    expect(JSON.parse(result.stdout)).toEqual(args);
    expect(result.exitCode).toBe(0);
  });
});

describe('runCommand strict wrapper', () => {
  test('resolves zero exits exactly as before', async () => {
    const result = await runCommand(NODE, ['-e', 'console.log("hello")']);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.stderr).toBe('');
  });

  test('non-zero exits throw the existing typed error without stdout', async () => {
    const failure = runCommand(NODE, ['-e', 'console.log("usable-data"); process.exit(3)'], {
      timeoutMs: 10_000,
    });
    await expect(failure).rejects.toMatchObject({ kind: 'non-zero-exit', exitCode: 3 });
    await expect(failure).rejects.toBeInstanceOf(CommandError);
    let message = '';
    try {
      await runCommand(NODE, ['-e', 'process.exit(3)'], { timeoutMs: 10_000 });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(`Command exited with code 3: ${NODE}`);
  });

  test('fake non-zero callbacks surface through the strict wrapper', async () => {
    const execFileFn: ExecFileLike = (_exe, _args, _opts, callback) => {
      callback(Object.assign(new Error('boom'), { code: 7 }), 'partial-stdout', 'some-stderr');
    };
    await expect(runCommand('seff', ['123'], {}, { execFileFn })).rejects.toMatchObject({
      kind: 'non-zero-exit',
      exitCode: 7,
    });
    const captured = await runCommandCapture('seff', ['123'], {}, { execFileFn });
    expect(captured).toMatchObject({ stdout: 'partial-stdout', stderr: 'some-stderr', exitCode: 7 });
  });
});
