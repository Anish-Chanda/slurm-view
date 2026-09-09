import * as fs from 'node:fs';
import * as path from 'node:path';
import { CommandError } from '../../../src/server/adapters/slurm/command-runner.js';
import { JobsCache, createJobSnapshot } from '../../../src/server/cache/jobs-cache.js';
import { NodesCache } from '../../../src/server/cache/nodes-cache.js';
import { PollingService } from '../../../src/server/services/polling-service.js';
import type { SlurmRunFn } from '../../../src/server/adapters/slurm/context.js';

const FIXTURES = path.join(__dirname, 'fixtures');

function fixtureStdout(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function runFor(stdout: string): SlurmRunFn {
  return jest.fn().mockResolvedValue({ stdout, stderr: '' });
}

describe('JobsCache', () => {
  test('builds an atomic snapshot with an id index and timestamp', async () => {
    const cache = new JobsCache({ parser: 'v0.0.45', run: runFor(fixtureStdout('v45-jobs.json')) });
    const snapshot = await cache.getOrLoad();
    expect(snapshot.jobs).toHaveLength(3);
    expect(snapshot.byId.get('101')?.name).toBe('train-model');
    expect(snapshot.byId.get('100_2')?.user).toBe('bob');
    expect(snapshot.capturedAt).toBeInstanceOf(Date);
  });

  test('createJobSnapshot is atomic and readonly-safe', () => {
    const snapshot = createJobSnapshot([], new Date(0));
    expect(snapshot.jobs).toEqual([]);
    expect(snapshot.byId.size).toBe(0);
  });

  test('refresh failure propagates without inserting partial data', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce({ stdout: fixtureStdout('v45-jobs.json'), stderr: '' })
      .mockRejectedValueOnce(new Error('controller down'));
    const cache = new JobsCache({ parser: 'v0.0.45', run });
    const first = await cache.getOrLoad();
    await expect(cache.refresh()).rejects.toThrow('controller down');
    expect(cache.peek()).toBe(first);
  });

  test('poller shutdown aborts the active jobs command without a retry log', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      let observed: AbortSignal | undefined;
      const run: SlurmRunFn = (_executable, _args, options) =>
        new Promise((_resolve, reject) => {
          observed = options?.signal;
          options?.signal?.addEventListener('abort', () => {
            reject(
              new CommandError({
                kind: 'aborted',
                executable: 'squeue',
                args: [],
                message: 'Command aborted: squeue',
              })
            );
          });
        });
      const cache = new JobsCache({ parser: 'v0.0.45', run });
      const poller = new PollingService((signal) => cache.refresh({ signal }), 20);
      poller.start();
      await new Promise((resolve) => setTimeout(resolve, 30));
      poller.stop();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(observed).toBeDefined();
      expect(observed?.aborted).toBe(true);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

describe('NodesCache', () => {
  test('builds a node snapshot from versioned output', async () => {
    const cache = new NodesCache({ parser: 'v0.0.44', run: runFor(fixtureStdout('v44-nodes.json')) });
    const snapshot = await cache.getOrLoad();
    expect(snapshot.nodes).toHaveLength(4);
    expect(snapshot.nodes.map((node) => node.name)).toEqual(['gpu01', 'cpu01', 'gpu02', 'down01']);
  });
});
