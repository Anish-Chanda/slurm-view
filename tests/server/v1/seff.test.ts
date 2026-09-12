import { CommandError } from '../../../src/server/adapters/slurm/command-runner.js';
import {
  SeffNotAvailableError,
  fetchEfficiency,
  parseElapsedToSeconds,
  parseSeffMemoryToMiB,
  parseSeffPercent,
  parseSeffStdout,
} from '../../../src/server/adapters/slurm/seff.js';
import type { SeffRunFn } from '../../../src/server/adapters/slurm/seff.js';
import { UpstreamInvalidError } from '../../../src/server/adapters/slurm/errors.js';

const COMPLETED_SEFF = `Job ID: 12345
Cluster: mycluster
User/Group: alice/research
State: COMPLETED (exit code 0)
Nodes: 2
Cores per node: 16
CPU Utilized: 03:42:10
CPU Efficiency: 88.16% of 04:12:00 core-walltime
Job Wall-clock time: 00:07:53
Memory Utilized: 39.10 GB
Memory Efficiency: 61.09% of 64.00 GB (32.00 GB/node)
`;

const SINGLE_CORE_SEFF = `Job ID: 7
Cluster: mycluster
User/Group: bob/teaching
State: COMPLETED (exit code 0)
Cores: 1
CPU Utilized: 00:59:10
CPU Efficiency: 98.61% of 01:00:00 core-walltime
Job Wall-clock time: 01:00:00
Memory Utilized: 512.00 MB
Memory Efficiency: 25.00% of 2.00 GB (2.00 GB/core)
`;

const PER_CORE_MULTI_NODE_SEFF = `Job ID: 99
Cluster: mycluster
User/Group: carol/research
State: COMPLETED (exit code 0)
Nodes: 4
Cores per node: 16
CPU Utilized: 3-05:12:33
CPU Efficiency: 103.20% of 3-04:00:00 core-walltime
Job Wall-clock time: 01:12:00
Memory Utilized: 100.00 GB
Memory Efficiency: 78.12% of 128.00 GB (2.00 GB/core)
`;

describe('parseSeffStdout', () => {
  test('parses a completed multi-core job with seff denominators', () => {
    const efficiency = parseSeffStdout(COMPLETED_SEFF);
    expect(efficiency.cpu).toEqual({
      efficiencyPercent: 88.16,
      utilizedSeconds: 3 * 3600 + 42 * 60 + 10,
      allocatedCoreSeconds: 4 * 3600 + 12 * 60,
    });
    expect(efficiency.memory).toEqual({
      efficiencyPercent: 61.09,
      utilizedMiB: Math.round(39.1 * 1024),
      allocatedMiB: 64 * 1024,
    });
    expect(efficiency.wallClockSeconds).toBe(7 * 60 + 53);
  });

  test('parses a single-core job', () => {
    const efficiency = parseSeffStdout(SINGLE_CORE_SEFF);
    expect(efficiency.cpu.efficiencyPercent).toBe(98.61);
    expect(efficiency.cpu.utilizedSeconds).toBe(59 * 60 + 10);
    expect(efficiency.cpu.allocatedCoreSeconds).toBe(3600);
    expect(efficiency.memory).toEqual({
      efficiencyPercent: 25,
      utilizedMiB: 512,
      allocatedMiB: 2048,
    });
  });

  test('parses multi-day elapsed times and per-core memory', () => {
    const efficiency = parseSeffStdout(PER_CORE_MULTI_NODE_SEFF);
    expect(efficiency.cpu.utilizedSeconds).toBe(3 * 86400 + 5 * 3600 + 12 * 60 + 33);
    expect(efficiency.cpu.allocatedCoreSeconds).toBe(3 * 86400 + 4 * 3600);
    expect(efficiency.memory.allocatedMiB).toBe(128 * 1024);
  });

  test('preserves percentages above 100 instead of clamping', () => {
    const efficiency = parseSeffStdout(PER_CORE_MULTI_NODE_SEFF);
    expect(efficiency.cpu.efficiencyPercent).toBe(103.2);
  });

  test('keeps usable legs when one value is malformed', () => {    const efficiency = parseSeffStdout(
      'CPU Efficiency: lots% of soon core-walltime\nMemory Efficiency: 50.00% of 2.00 GB\n'
    );
    expect(efficiency.cpu).toEqual({
      efficiencyPercent: null,
      utilizedSeconds: null,
      allocatedCoreSeconds: null,
    });
    expect(efficiency.memory.efficiencyPercent).toBe(50);
    expect(efficiency.memory.allocatedMiB).toBe(2048);
  });

  test.each([
    ['pending marker only', 'State: PENDING\nEfficiency not available for jobs in the PENDING state.\n'],
    ['empty output', ''],
    ['unrelated text', 'Job not found.\n'],
    [
      'labels with nothing parseable',
      'CPU Efficiency: lots% of soon core-walltime\nMemory Efficiency: nope% of never\n',
    ],
  ])('throws without usable values (%s)', (_label, stdout) => {
    expect(() => parseSeffStdout(stdout)).toThrow(UpstreamInvalidError);
  });
});

describe('parseElapsedToSeconds', () => {
  test.each([
    [' wall clock', '00:07:53', 473],
    ['core walltime', '04:12:00', 15120],
    ['multi-day', '3-05:12:33', 277953],
    ['short form', '05:12', 312],
  ])('%s', (_label, input, expected) => {
    expect(parseElapsedToSeconds(input)).toBe(expected);
  });

  test.each([['empty', ''], ['words', 'soon'], ['negative', '-01:00:00'], ['bad minutes', '01:61:00']])(
    'unparseable (%s) becomes null',
    (_label, input) => {
      expect(parseElapsedToSeconds(input)).toBeNull();
    }
  );
});

describe('parseSeffMemoryToMiB', () => {
  test.each([
    ['gigabytes', '39.10 GB', Math.round(39.1 * 1024)],
    ['megabytes', '512.00 MB', 512],
    ['zero', '0.00 MB', 0],
    ['terabytes', '1.50 TB', Math.round(1.5 * 1024 * 1024)],
    ['kilobytes', '512.00 KB', Math.round(512 / 1024)],
    ['case-insensitive', '39.10 gb', Math.round(39.1 * 1024)],
  ])('%s', (_label, input, expected) => {
    expect(parseSeffMemoryToMiB(input)).toBe(expected);
  });

  test.each([['empty', ''], ['no unit', '512'], ['negative', '-1.00 GB'], ['words', 'lots']])(
    'unparseable (%s) becomes null',
    (_label, input) => {
      expect(parseSeffMemoryToMiB(input)).toBeNull();
    }
  );
});

describe('parseSeffPercent', () => {
  test('accepts ordinary and above-100 values', () => {
    expect(parseSeffPercent('88.13')).toBe(88.13);
    expect(parseSeffPercent('103.2')).toBe(103.2);
    expect(parseSeffPercent('0')).toBe(0);
  });

  test.each([['negative', '-1'], ['words', 'lots'], ['empty', '']])(
    '%s becomes null',
    (_label, input) => {
      expect(parseSeffPercent(input)).toBeNull();
    }
  );
});

function runFor(stdout: string, exitCode = 0): SeffRunFn {
  return jest.fn().mockResolvedValue({ stdout, stderr: '', exitCode });
}

describe('fetchEfficiency', () => {
  test('parses usable stdout from a zero exit', async () => {
    const efficiency = await fetchEfficiency('12345', { run: runFor(COMPLETED_SEFF) });
    expect(efficiency.cpu.efficiencyPercent).toBe(88.16);
    expect(efficiency.memory.allocatedMiB).toBe(64 * 1024);
  });

  test('accepts usable stdout from a non-zero exit', async () => {
    const run = runFor(COMPLETED_SEFF, 139);
    const efficiency = await fetchEfficiency('12345', { run });
    expect(efficiency.cpu.efficiencyPercent).toBe(88.16);
    expect(run).toHaveBeenCalledWith('seff', ['12345'], expect.objectContaining({ timeoutMs: expect.any(Number) }));
  });

  test('rejects step IDs outside the canonical job space', async () => {
    const run = runFor(COMPLETED_SEFF);
    await expect(fetchEfficiency('123.batch', { run })).rejects.toThrow(UpstreamInvalidError);
    expect(run).not.toHaveBeenCalled();
  });

  test('rejects invalid job IDs without spawning', async () => {
    const run = runFor(COMPLETED_SEFF);
    await expect(fetchEfficiency('1;rm', { run })).rejects.toThrow(UpstreamInvalidError);
    expect(run).not.toHaveBeenCalled();
  });

  test('missing executable becomes a typed capability error', async () => {
    const run: SeffRunFn = jest.fn().mockRejectedValue(
      new CommandError({
        kind: 'executable-not-found',
        executable: 'seff',
        args: ['12345'],
        message: 'Executable not found: seff',
      })
    );
    await expect(fetchEfficiency('12345', { run })).rejects.toBeInstanceOf(SeffNotAvailableError);
  });

  test('non-zero exit without usable stdout fails as invalid upstream', async () => {
    await expect(fetchEfficiency('12345', { run: runFor('Job not found.\n', 2) })).rejects.toThrow(
      UpstreamInvalidError
    );
  });

  test('timeout propagates as a typed command error', async () => {
    const run: SeffRunFn = jest.fn().mockRejectedValue(
      new CommandError({ kind: 'timeout', executable: 'seff', args: ['12345'], message: 'timed out' })
    );
    await expect(fetchEfficiency('12345', { run })).rejects.toMatchObject({ kind: 'timeout' });
  });
});
