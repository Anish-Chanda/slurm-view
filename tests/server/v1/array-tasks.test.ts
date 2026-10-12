import { ArrayTasksCache } from '../../../src/server/cache/array-tasks-cache.js';
import { createJobSnapshot } from '../../../src/server/cache/jobs-cache.js';
import {
  fetchArrayTasks,
  parseArrayTasksStdout,
} from '../../../src/server/adapters/slurm/array-tasks.js';
import { SlurmUpstreamError, UpstreamInvalidError } from '../../../src/server/adapters/slurm/errors.js';
import { getArrayTasks, summarizeLiveSiblings } from '../../../src/server/services/array-service.js';
import type { SlurmRunFn } from '../../../src/server/adapters/slurm/context.js';
import type { QueueJob } from '../../../src/server/models/queue-job.js';

function queueJob(overrides: Partial<QueueJob> & { id: string }): QueueJob {
  return {
    jobId: overrides.id,
    arrayJobId: null,
    arrayTaskId: null,
    partition: null,
    name: null,
    user: null,
    account: null,
    qos: null,
    state: 'RUNNING',
    stateFlags: [],
    stateReason: null,
    timeLimit: null,
    submitTime: null,
    startTime: null,
    endTime: null,
    priority: null,
    nodeCount: null,
    nodeExpression: null,
    allocated: {
      cpus: null,
      memoryMiB: null,
      nodes: null,
      gpus: { total: 0, byType: {} },
      gpuPresent: false,
    },
    exitCode: null,
    ...overrides,
  };
}

describe('parseArrayTasksStdout', () => {
  test('keeps exact array elements sorted by numeric task ID', () => {
    const stdout = [
      '100_10|COMPLETED|0:0|3600|node02',
      '100_2|FAILED|1:0|120|node01',
      '100_1|COMPLETED|0:0|60|node01',
    ].join('\n');
    const tasks = parseArrayTasksStdout(`${stdout}\n`, '100');
    expect(tasks.map((task) => task.taskId)).toEqual([1, 2, 10]);
    expect(tasks[0]).toMatchObject({ state: 'COMPLETED', elapsedSeconds: 60, nodeExpression: 'node01', exitCode: '0' });
    expect(tasks[1]).toMatchObject({ state: 'FAILED', elapsedSeconds: 120, exitCode: '1' });
    expect(tasks[2]).toMatchObject({ state: 'COMPLETED', elapsedSeconds: 3600, nodeExpression: 'node02' });
  });

  test('ignores steps, the master row, other arrays, and unrelated malformed rows', () => {
    const stdout = [
      '100|COMPLETED|0:0|3700|node01',
      '100_1.batch|COMPLETED|0:0|10|node01',
      '100_1.0|COMPLETED|0:0|10|node01',
      '100_1.extern|COMPLETED|0:0|10|node01',
      '101_1|COMPLETED|0:0|10|node09',
      '100_2|RUNNING||120|',
      'not-a-row',
      '101_3|COMPLETED|0:0',
      '',
    ].join('\n');
    const tasks = parseArrayTasksStdout(`${stdout}\n`, '100');
    expect(tasks.map((task) => task.taskId)).toEqual([2]);
    expect(tasks[0]).toMatchObject({ state: 'RUNNING', elapsedSeconds: 120, nodeExpression: null, exitCode: null });
  });

  test('a malformed exact target row raises instead of returning a partial map', () => {
    const stdout = [
      '100_1|COMPLETED|0:0|60|node01',
      '100_2|FAILED|1:0',
    ].join('\n');
    expect(() => parseArrayTasksStdout(`${stdout}\n`, '100')).toThrow(UpstreamInvalidError);
  });

  test('normalizes unknown states and numeric elapsed values', () => {
    const stdout = '100_4|SOME_NEW_STATE|2:0|93784|node[01-02]\n';
    const tasks = parseArrayTasksStdout(stdout, '100');
    expect(tasks).toEqual([
      { taskId: 4, state: 'UNKNOWN', elapsedSeconds: 93784, nodeExpression: 'node[01-02]', exitCode: '2' },
    ]);
  });

  test('normalizes state decorations', () => {
    const stdout = [
      '100_1|CANCELLED by 1234|0:0|60|node01',
      '100_2|COMPLETED+|0:0|61|node02',
    ].join('\n');
    const tasks = parseArrayTasksStdout(`${stdout}\n`, '100');
    expect(tasks.map((task) => task.state)).toEqual(['CANCELLED', 'COMPLETED']);
  });

  test('a trailing delimiter is malformed with parsable2', () => {
    expect(() => parseArrayTasksStdout('100_1|COMPLETED|0:0|60|node01|\n', '100')).toThrow(UpstreamInvalidError);
  });

  test('content with no valid exact elements raises instead of returning empty', () => {
    const stdout = [
      '100|COMPLETED|0:0|3700|node01',
      '100_1.batch|COMPLETED|0:0|10|node01',
      'not-a-row',
    ].join('\n');
    expect(() => parseArrayTasksStdout(`${stdout}\n`, '100')).toThrow(UpstreamInvalidError);
  });

  test('empty output yields no tasks', () => {
    expect(parseArrayTasksStdout('', '100')).toEqual([]);
  });
});

describe('fetchArrayTasks', () => {
  test('runs the exact sacct accounting command', async () => {
    const run: SlurmRunFn = jest.fn().mockResolvedValue({ stdout: '100_1|COMPLETED|0:0|60|node01\n', stderr: '' });
    const tasks = await fetchArrayTasks({ parser: 'v0.0.45', run }, '100');
    expect(run).toHaveBeenCalledWith(
      'sacct',
      [
        '--jobs=100',
        '--array',
        '--allocations',
        '--allusers',
        '--local',
        '--noheader',
        '--parsable2',
        '--format=JobID,State,ExitCode,ElapsedRaw,NodeList',
      ],
      expect.objectContaining({ timeoutMs: expect.any(Number), maxBufferBytes: expect.any(Number) })
    );
    expect(tasks).toHaveLength(1);
  });

  test('rejects non-array job IDs without running sacct', async () => {
    const run: SlurmRunFn = jest.fn();
    await expect(fetchArrayTasks({ parser: 'v0.0.45', run }, '100_2')).rejects.toThrow();
    await expect(fetchArrayTasks({ parser: 'v0.0.45', run }, 'abc')).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  test('blank accounting output rejects as unavailable, never as an empty map', async () => {
    const run: SlurmRunFn = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
    await expect(fetchArrayTasks({ parser: 'v0.0.45', run }, '100')).rejects.toThrow(SlurmUpstreamError);
  });
});

describe('createJobSnapshot byArrayJobId', () => {
  test('indexes expanded array elements by parent array job', () => {
    const snapshot = createJobSnapshot([
      queueJob({ id: '101' }),
      queueJob({ id: '100_0', jobId: '136', arrayJobId: '100', arrayTaskId: '0', state: 'RUNNING' }),
      queueJob({ id: '100_1', jobId: '137', arrayJobId: '100', arrayTaskId: '1', state: 'RUNNING' }),
      queueJob({ id: '100_2', jobId: '138', arrayJobId: '100', arrayTaskId: '2', state: 'PENDING' }),
    ]);
    expect(snapshot.byArrayJobId.get('100')?.map((job) => job.id)).toEqual(['100_0', '100_1', '100_2']);
    expect(snapshot.byArrayJobId.get('101')).toBeUndefined();
    expect(snapshot.byId.get('100_0')?.jobId).toBe('136');
    expect(snapshot.byId.get('100_1')?.state).toBe('RUNNING');
  });
});

describe('summarizeLiveSiblings', () => {
  test('counts running/pending and breaks pending reasons down deterministically', () => {
    const siblings = [
      queueJob({ id: '100_1', state: 'RUNNING' }),
      queueJob({ id: '100_2', state: 'PENDING', stateReason: 'Priority' }),
      queueJob({ id: '100_3', state: 'PENDING', stateReason: 'Resources' }),
      queueJob({ id: '100_4', state: 'PENDING', stateReason: 'Resources' }),
      queueJob({ id: '100_5', state: 'PENDING', stateReason: null }),
      queueJob({ id: '100_6', state: 'COMPLETED' }),
    ];
    expect(summarizeLiveSiblings(siblings)).toEqual({
      runningTasks: 1,
      pendingTasks: 4,
      pendingReasons: [
        { reason: 'Resources', count: 2 },
        { reason: 'Priority', count: 1 },
        { reason: null, count: 1 },
      ],
    });
  });

  test('empty siblings summarize to zeros', () => {
    expect(summarizeLiveSiblings([])).toEqual({ runningTasks: 0, pendingTasks: 0, pendingReasons: [] });
  });
});

describe('getArrayTasks', () => {
  test('merges live tasks by array task ID without loading the queue', async () => {
    const snapshot = createJobSnapshot([
      queueJob({
        id: '100_0',
        jobId: '136',
        arrayJobId: '100',
        arrayTaskId: '0',
        state: 'RUNNING',
        nodeExpression: 'node09',
      }),
      queueJob({
        id: '100_1',
        jobId: '137',
        arrayJobId: '100',
        arrayTaskId: '1',
        state: 'PENDING',
      }),
    ]);
    const jobsCache = { peek: jest.fn(() => snapshot) };
    const run: SlurmRunFn = jest.fn().mockResolvedValue({
      stdout: [
        '100_0|COMPLETED|0:0|60|node01',
        '100_1|COMPLETED|0:0|61|node02',
      ].join('\n') + '\n',
      stderr: '',
    });
    const arrayTasksCache = new ArrayTasksCache({ parser: 'v0.0.45', run });

    const tasks = await getArrayTasks('100', { jobsCache, arrayTasksCache });

    expect(jobsCache.peek).toHaveBeenCalledTimes(1);
    expect(tasks[0]).toEqual({
      taskId: 0,
      state: 'RUNNING',
      elapsedSeconds: 60,
      nodeExpression: 'node09',
      exitCode: '0',
    });
    expect(tasks[1]).toMatchObject({ taskId: 1, state: 'PENDING', elapsedSeconds: 61 });
  });
});

describe('ArrayTasksCache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([[0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'rejects non-positive TTL %p like TtlDataCache',
    (ttlMs) => {
      expect(() => new ArrayTasksCache({ parser: 'v0.0.45' }, { ttlMs })).toThrow(TypeError);
    }
  );

  test('expired entries miss and reload after the TTL', async () => {
    // TTLCache uses performance.now().
    let nowMs = 1_000_000;
    jest.spyOn(performance, 'now').mockImplementation(() => nowMs);
    const run: SlurmRunFn = jest
      .fn()
      .mockResolvedValueOnce({ stdout: '100_1|COMPLETED|0:0|60|node01\n', stderr: '' })
      .mockResolvedValue({ stdout: '100_1|FAILED|1:0|61|node02\n', stderr: '' });
    const cache = new ArrayTasksCache({ parser: 'v0.0.45', run }, { ttlMs: 1000 });
    const first = await cache.getOrLoad('100');
    expect(first[0]).toMatchObject({ state: 'COMPLETED' });
    nowMs += 999;
    await expect(cache.getOrLoad('100')).resolves.toBe(first);
    expect(cache.peek('100')).toBe(first);
    nowMs += 1;
    expect(cache.peek('100')).toBeUndefined();
    const second = await cache.getOrLoad('100');
    expect(second[0]).toMatchObject({ state: 'FAILED' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('caches per array ID until the TTL expires', async () => {
    const run: SlurmRunFn = jest
      .fn()
      .mockResolvedValueOnce({ stdout: '100_1|COMPLETED|0:0|60|node01\n', stderr: '' })
      .mockResolvedValue({ stdout: '100_1|FAILED|1:0|61|node02\n', stderr: '' });
    const cache = new ArrayTasksCache({ parser: 'v0.0.45', run }, { ttlMs: 1000 });
    const first = await cache.getOrLoad('100');
    expect(first[0]).toMatchObject({ state: 'COMPLETED' });
    const second = await cache.getOrLoad('100');
    expect(second).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);
    cache.invalidate('100');
    const third = await cache.getOrLoad('100');
    expect(third[0]).toMatchObject({ state: 'FAILED' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('dedups concurrent loads for the same array', async () => {
    let resolveRun!: (value: { stdout: string; stderr: string }) => void;
    const run: SlurmRunFn = jest.fn().mockReturnValue(
      new Promise<{ stdout: string; stderr: string }>((resolve) => {
        resolveRun = resolve;
      })
    );
    const cache = new ArrayTasksCache({ parser: 'v0.0.45', run });
    const first = cache.getOrLoad('100');
    const second = cache.getOrLoad('100');
    resolveRun({ stdout: '100_1|COMPLETED|0:0|60|node01\n', stderr: '' });
    await expect(first).resolves.toHaveLength(1);
    await expect(second).resolves.toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('keeps array IDs isolated', async () => {
    const run: SlurmRunFn = jest.fn((_: string, args: readonly string[]) => {
      const job = String(args[0]).split('=')[1];
      return Promise.resolve({ stdout: `${job}_1|COMPLETED|0:0|60|node01\n`, stderr: '' });
    });
    const cache = new ArrayTasksCache({ parser: 'v0.0.45', run });
    await cache.getOrLoad('100');
    await cache.getOrLoad('200');
    expect(run).toHaveBeenCalledTimes(2);
    await cache.getOrLoad('100');
    expect(run).toHaveBeenCalledTimes(2);
  });
});
