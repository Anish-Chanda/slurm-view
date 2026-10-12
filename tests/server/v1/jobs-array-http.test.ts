import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';
import { CommandError } from '../../../src/server/adapters/slurm/command-runner.js';
import { createApp } from '../../../src/server/app.js';
import { ArrayTasksCache } from '../../../src/server/cache/array-tasks-cache.js';
import { JobsCache } from '../../../src/server/cache/jobs-cache.js';
import type { SlurmRunFn } from '../../../src/server/adapters/slurm/context.js';

const FIXTURES = path.join(__dirname, 'fixtures');
const FIELD_SEPARATOR = '\x1f';
const RECORD_TERMINATOR = '\x1e\n';

function squeueRow(fields: string[]): string {
  return `${fields.join(FIELD_SEPARATOR)}${RECORD_TERMINATOR}`;
}

// Live array tasks with raw numeric JobIDs.
function liveSqueueStdout(): string {
  const base = ['debug', 'arr', 'alice', 'acct', 'normal'];
  return (
    squeueRow(['137', '100', '1', ...base, 'RUNNING', 'None', '1:00:00', '1700000000', '1700000100', '0', '100', '1', 'node09', 'cpu=8,mem=32768M,node=1', 'N/A']) +
    squeueRow(['139', '100', '3', ...base, 'PENDING', 'Resources', '1:00:00', '1700000000', '0', '0', '50', '1', 'N/A', 'N/A', 'N/A'])
  );
}

function sacctStdout(): string {
  return [
    '100_1|COMPLETED|0:0|60|node01',
    '100_2|FAILED|1:0|120|node02',
    '100_3|PENDING|0:0|0|',
  ].join('\n') + '\n';
}

async function appWith(squeueRun: SlurmRunFn, sacctRun: SlurmRunFn) {
  const jobsCache = new JobsCache({ parser: 'v0.0.45', run: squeueRun });
  await jobsCache.refresh();
  const arrayTasksCache = new ArrayTasksCache({ parser: 'v0.0.45', run: sacctRun });
  return createApp({ jobsCache, arrayTasksCache, slurmContext: { parser: 'v0.0.45', run: squeueRun } });
}

function okRun(stdout: string): SlurmRunFn {
  return jest.fn().mockResolvedValue({ stdout, stderr: '' });
}

describe('GET /api/v1/jobs/:arrayJobId/array', () => {
  test('returns the exact tasks contract with numeric ordering', async () => {
    const app = await appWith(okRun(liveSqueueStdout()), okRun(sacctStdout()));
    const res = await request(app).get('/api/v1/jobs/100/array');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['tasks']);
    expect(res.body.tasks.map((task: { taskId: number }) => task.taskId)).toEqual([1, 2, 3]);
    for (const task of res.body.tasks) {
      expect(Object.keys(task).sort()).toEqual(['elapsedSeconds', 'exitCode', 'nodeExpression', 'state', 'taskId']);
    }
    expect(res.body.tasks[1]).toMatchObject({ taskId: 2, state: 'FAILED', exitCode: '1' });
  });

  test('live siblings win without refreshing the queue', async () => {
    const squeueRun = okRun(liveSqueueStdout());
    const app = await appWith(squeueRun, okRun(sacctStdout()));
    const res = await request(app).get('/api/v1/jobs/100/array');

    expect(res.status).toBe(200);
    const byId = new Map(res.body.tasks.map((task: { taskId: number }) => [task.taskId, task]));
    expect(byId.get(1)).toMatchObject({ state: 'RUNNING', nodeExpression: 'node09' });
    expect(byId.get(3)).toMatchObject({ state: 'PENDING' });
    expect(squeueRun).toHaveBeenCalledTimes(1);
  });

  test('sacct failure is an API error, never a partial squeue-only map', async () => {
    const failing: SlurmRunFn = jest.fn().mockRejectedValue(
      new CommandError({
        kind: 'non-zero-exit',
        executable: 'sacct',
        args: [],
        exitCode: 1,
        stderrSnippet: 'sacct: accounting storage is not configured',
        message: 'Command exited with code 1: sacct',
      })
    );
    const app = await appWith(okRun(liveSqueueStdout()), failing);
    const res = await request(app).get('/api/v1/jobs/100/array');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
    expect(res.body).not.toHaveProperty('tasks');
    expect(JSON.stringify(res.body)).not.toContain('accounting storage');
  });

  test('blank sacct output with live siblings is an error, never a squeue-only map', async () => {
    const app = await appWith(okRun(liveSqueueStdout()), okRun(''));
    const res = await request(app).get('/api/v1/jobs/100/array');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
    expect(res.body).not.toHaveProperty('tasks');
  });

  test.each([['task ID', '100_2'], ['non-numeric', 'abc'], ['injection', '1;rm']])(
    'non-array ID (%s) becomes 400',
    async (_label, id) => {
      const app = await appWith(okRun(liveSqueueStdout()), okRun(sacctStdout()));
      const res = await request(app).get(`/api/v1/jobs/${encodeURIComponent(id)}/array`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    }
  );

  test('missing cache wiring becomes 503, not a crash', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/jobs/100/array');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
  });

  test('array task detail uses the existing queue snapshot', async () => {
    const stdout = fs.readFileSync(path.join(FIXTURES, 'v45-jobs.json'), 'utf8');
    const scontrol: SlurmRunFn = jest.fn().mockResolvedValue({ stdout, stderr: '' });
    const squeueRun = okRun(liveSqueueStdout());
    const jobsCache = new JobsCache({ parser: 'v0.0.45', run: squeueRun });
    await jobsCache.refresh();
    const app = createApp({
      jobsCache,
      arrayTasksCache: new ArrayTasksCache({ parser: 'v0.0.45', run: okRun(sacctStdout()) }),
      slurmContext: { parser: 'v0.0.45', run: scontrol },
    });
    const res = await request(app).get('/api/v1/jobs/100_2');

    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({
      id: '100_2',
      jobId: '102',
      arrayJobId: '100',
      arrayTaskId: '2',
    });
    expect(res.body.arrayOverview).toEqual({
      runningTasks: 1,
      pendingTasks: 1,
      pendingReasons: [{ reason: 'Resources', count: 1 }],
    });
    expect(squeueRun).toHaveBeenCalledTimes(1);
  });

  test('non-array job detail carries a null array overview', async () => {
    const stdout = fs.readFileSync(path.join(FIXTURES, 'v45-jobs.json'), 'utf8');
    const scontrol: SlurmRunFn = jest.fn().mockResolvedValue({ stdout, stderr: '' });
    const app = createApp({
      jobsCache: new JobsCache({ parser: 'v0.0.45', run: okRun(liveSqueueStdout()) }),
      slurmContext: { parser: 'v0.0.45', run: scontrol },
    });
    const res = await request(app).get('/api/v1/jobs/101');

    expect(res.status).toBe(200);
    expect(res.body.arrayOverview).toBeNull();
  });

  test('array route does not shadow job details', async () => {
    const stdout = fs.readFileSync(path.join(FIXTURES, 'v45-jobs.json'), 'utf8');
    const scontrol: SlurmRunFn = jest.fn().mockResolvedValue({ stdout, stderr: '' });
    const app = createApp({
      jobsCache: new JobsCache({ parser: 'v0.0.45', run: okRun(liveSqueueStdout()) }),
      arrayTasksCache: new ArrayTasksCache({ parser: 'v0.0.45', run: okRun(sacctStdout()) }),
      slurmContext: { parser: 'v0.0.45', run: scontrol },
    });
    const detail = await request(app).get('/api/v1/jobs/101');
    expect(detail.status).toBe(200);
    expect(detail.body.job.id).toBe('101');
  });
});

describe('GET /api/v1/jobs/:id array throttle', () => {
  test('exposes arrayThrottle from targeted scontrol data', async () => {
    const stdout = fs.readFileSync(path.join(FIXTURES, 'v45-jobs.json'), 'utf8');
    const run: SlurmRunFn = jest.fn().mockResolvedValue({ stdout, stderr: '' });
    const app = createApp({ slurmContext: { parser: 'v0.0.45', run } });
    const res = await request(app).get('/api/v1/jobs/100_2');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('arrayThrottle');
    expect(res.body.arrayThrottle === null || typeof res.body.arrayThrottle === 'number').toBe(true);
  });

  test('propagates a numeric array throttle limit', async () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'v45-jobs.json'), 'utf8')) as {
      jobs: Array<Record<string, unknown>>;
    };
    const throttled = envelope.jobs.map((job) =>
      job.job_id === 102 ? { ...job, array_throttle: { number: 2, set: true, infinite: false } } : job
    );
    const run: SlurmRunFn = jest
      .fn()
      .mockResolvedValue({ stdout: JSON.stringify({ ...envelope, jobs: throttled }), stderr: '' });
    const app = createApp({ slurmContext: { parser: 'v0.0.45', run } });
    const res = await request(app).get('/api/v1/jobs/100_2');

    expect(res.status).toBe(200);
    expect(res.body.arrayThrottle).toBe(2);
  });
});
