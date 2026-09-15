import {
  SlurmCompatibilityError,
  SUPPORTED_DATA_PARSERS,
  negotiateDataParser,
  selectDataParser,
} from '../../../src/server/adapters/slurm/parser-version.js';
import { CommandError } from '../../../src/server/adapters/slurm/command-runner.js';

function listOutput(parsers: string[]): string {
  return [
    'Slurm data parser plugins:',
    ...parsers.map((parser) => `  ${parser} (stable)`),
    'Use --json=<parser> to select one explicitly.',
  ].join('\n');
}

describe('selectDataParser', () => {
  test('prefers the newest supported parser', () => {
    expect(selectDataParser(listOutput(['v0.0.43', 'v0.0.44', 'v0.0.45']))).toBe('v0.0.45');
  });

  test('falls back down the supported order', () => {
    expect(selectDataParser(listOutput(['v0.0.42', 'v0.0.43', 'v0.0.44']))).toBe('v0.0.44');
    expect(selectDataParser(listOutput(['v0.0.42', 'v0.0.43']))).toBe('v0.0.43');
  });

  test('returns null when only unknown parsers are installed', () => {
    expect(selectDataParser(listOutput(['v0.0.41', 'v0.0.42']))).toBeNull();
    expect(selectDataParser('nothing useful here')).toBeNull();
  });

  test('tolerates decorative text and duplicates', () => {
    const output = `header v0.0.45\nstderr-style notes\nv0.0.45 again\nv0.0.43`;
    expect(selectDataParser(output)).toBe('v0.0.45');
  });

  test('supported order is newest-first with v0.0.43 as floor', () => {
    expect([...SUPPORTED_DATA_PARSERS]).toEqual(['v0.0.45', 'v0.0.44', 'v0.0.43']);
  });
});

describe('negotiateDataParser', () => {
  test('negotiates once through scontrol --json=list and reuses the result', async () => {
    const run = jest.fn().mockResolvedValue({
      stdout: listOutput(['v0.0.43', 'v0.0.44']),
      stderr: '',
    });
    await expect(negotiateDataParser({ run })).resolves.toBe('v0.0.44');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      'scontrol',
      ['--json=list'],
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
  });

  test('unsupported installations fail with supported + detected detail', async () => {
    const run = jest.fn().mockResolvedValue({ stdout: listOutput(['v0.0.42']), stderr: '' });
    const error = await negotiateDataParser({ run }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(SlurmCompatibilityError);
    expect((error as Error).message).toContain('v0.0.45');
    expect((error as Error).message).toContain('v0.0.44');
    expect((error as Error).message).toContain('v0.0.43');
    expect((error as Error).message).toContain('v0.0.42');
  });

  test('command failure becomes a compatibility error, not a raw exec error', async () => {
    const run = jest.fn().mockRejectedValue(
      new CommandError({
        kind: 'executable-not-found',
        executable: 'scontrol',
        args: ['--json=list'],
        message: 'Executable not found: scontrol',
      })
    );
    await expect(negotiateDataParser({ run })).rejects.toBeInstanceOf(SlurmCompatibilityError);
  });
});
