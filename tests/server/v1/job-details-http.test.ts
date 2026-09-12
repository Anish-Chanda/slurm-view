import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';
import { CommandError } from '../../../src/server/adapters/slurm/command-runner.js';
import { createApp } from '../../../src/server/app.js';
import { JobsCache } from '../../../src/server/cache/jobs-cache.js';
import type { SlurmRunFn } from '../../../src/server/adapters/slurm/context.js';

const FIXTURES = path.join(__dirname, 'fixtures');

function fixtureRun(): SlurmRunFn {
  const stdout = fs.readFileSync(path.join(FIXTURES, 'v45-jobs.json'), 'utf8');
  return jest.fn().mockResolvedValue({ stdout, stderr: '' });
}

function cacheWith(run: SlurmRunFn): JobsCache {
  return new JobsCache({ parser: 'v0.0.45', run });
}

describe('GET /api/v1/jobs/:id', () => {
  test('returns one job with the shared semantic contract', async () => {
    const app = createApp({ jobsCache: cacheWith(fixtureRun()) });
    const res = await request(app).get('/api/v1/jobs/101');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(typeof res.body.updatedAt).toBe('string');
    expect(res.body.job).toMatchObject({
      id: '101',
      jobId: '101',
      state: 'RUNNING',
      requested: { cpus: 8, memoryMiB: 32768 },
    });
    expect(res.body.job).not.toHaveProperty('job_state');
    expect(res.body.job).toHaveProperty('eligibleTime');
    expect(res.body.job).toHaveProperty('stderrPath');
    expect(res.body.job).toHaveProperty('priority');
  });

  test('resolves composite array task IDs', async () => {
    const app = createApp({ jobsCache: cacheWith(fixtureRun()) });
    const res = await request(app).get('/api/v1/jobs/100_2');

    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({
      id: '100_2',
      arrayJobId: '100',
      arrayTaskId: '2',
      state: 'PENDING',
    });
  });

  test('unknown job becomes a 404 with job-specific detail', async () => {
    const app = createApp({ jobsCache: cacheWith(fixtureRun()) });
    const res = await request(app).get('/api/v1/jobs/99999');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.detail).toMatch(/99999/);
  });

  test.each([
    ['step suffix', '123.batch'],
    ['extern suffix', '123.extern'],
    ['numeric step', '123.0'],
    ['injection', '1;rm'],
    ['non-numeric', 'abc'],
    ['empty-ish', '1_'],
  ])('non-canonical ID (%s) becomes 400', async (_label, id) => {
    const app = createApp({ jobsCache: cacheWith(fixtureRun()) });
    const res = await request(app).get(`/api/v1/jobs/${encodeURIComponent(id)}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  test('Slurm failure becomes 503 without leaking internals', async () => {
    const run: SlurmRunFn = jest.fn().mockRejectedValue(
      new CommandError({
        kind: 'non-zero-exit',
        executable: 'squeue',
        args: [],
        exitCode: 1,
        stderrSnippet: 'slurmdbd: Access denied for secret-internals',
        message: 'Command exited with code 1: squeue',
      })
    );
    const app = createApp({ jobsCache: cacheWith(run) });
    const res = await request(app).get('/api/v1/jobs/101');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('secret-internals');
  });

  test('missing cache wiring becomes 503, not a crash', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/jobs/101');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
  });

  test('works under PASSENGER_BASE_URI', async () => {
    const saved = process.env.PASSENGER_BASE_URI;
    process.env.PASSENGER_BASE_URI = '/pun/dev/slurm-view';
    try {
      const app = createApp({ jobsCache: cacheWith(fixtureRun()) });
      const res = await request(app).get('/pun/dev/slurm-view/api/v1/jobs/101');
      expect(res.status).toBe(200);
      expect(res.body.job.id).toBe('101');
    } finally {
      if (saved === undefined) {
        delete process.env.PASSENGER_BASE_URI;
      } else {
        process.env.PASSENGER_BASE_URI = saved;
      }
    }
  });
});
