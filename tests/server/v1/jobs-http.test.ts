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

function failingRun(): SlurmRunFn {
  return jest.fn().mockRejectedValue(
    new CommandError({
      kind: 'non-zero-exit',
      executable: 'squeue',
      args: [],
      exitCode: 1,
      stderrSnippet: 'slurmdbd: Access denied for secret-internals',
      message: 'Command exited with code 1: squeue',
    })
  );
}

describe('GET /api/v1/jobs', () => {
  test('returns the direct semantic contract without envelopes', async () => {
    const app = createApp({ jobsCache: new JobsCache({ parser: 'v0.0.45', run: fixtureRun() }) });
    const res = await request(app).get('/api/v1/jobs');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.data).toBeUndefined();
    expect(res.body.success).toBeUndefined();
    expect(res.body.fromCache).toBeUndefined();
    expect(res.body.jobs).toHaveLength(3);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 3, totalPages: 1 });
    expect(typeof res.body.updatedAt).toBe('string');

    const [first] = res.body.jobs as Array<Record<string, unknown>>;
    expect(first).toMatchObject({
      id: '101',
      state: 'RUNNING',
      stateReason: null,
      timeLimit: { kind: 'finite', seconds: 7200 },
      requested: { cpus: 8, memoryMiB: 32768 },
    });
    expect(first).not.toHaveProperty('job_state');
    expect(first).not.toHaveProperty('N/A');
  });

  test('filters and pagination work over the snapshot', async () => {
    const app = createApp({ jobsCache: new JobsCache({ parser: 'v0.0.45', run: fixtureRun() }) });

    const filtered = await request(app).get('/api/v1/jobs').query({ user: 'bob' });
    expect(filtered.status).toBe(200);
    expect(filtered.body.jobs.map((job: { id: string }) => job.id)).toEqual(['100_2']);

    const byId = await request(app).get('/api/v1/jobs').query({ id: '100_2' });
    expect(byId.status).toBe(200);
    expect(byId.body.jobs.map((job: { id: string }) => job.id)).toEqual(['100_2']);

    const paged = await request(app).get('/api/v1/jobs').query({ page: '2', pageSize: '2' });
    expect(paged.status).toBe(200);
    expect(paged.body.jobs.map((job: { id: string }) => job.id)).toEqual(['103']);
    expect(paged.body.pagination).toMatchObject({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
  });

  test.each([
    ['bad state', { state: 'BOGUS' }],
    ['oversized page', { pageSize: '500' }],
    ['non-numeric page', { page: 'abc' }],
    ['unknown parameter', { frobnicate: '1' }],
    ['bad partition chars', { partition: 'a;b' }],
  ])('invalid query (%s) becomes RFC 9457 Bad Request', async (_label, query) => {
    const app = createApp({ jobsCache: new JobsCache({ parser: 'v0.0.45', run: fixtureRun() }) });
    const res = await request(app).get('/api/v1/jobs').query(query);

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
    });
  });

  test('Slurm failure becomes 503 without leaking internals', async () => {
    const app = createApp({ jobsCache: new JobsCache({ parser: 'v0.0.45', run: failingRun() }) });
    const res = await request(app).get('/api/v1/jobs');

    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('secret-internals');
    expect(JSON.stringify(res.body)).not.toContain('slurmdbd');
  });

  test('malformed Slurm payload becomes 502 without leaking the payload', async () => {
    const run: SlurmRunFn = jest.fn().mockResolvedValue({ stdout: 'not json {', stderr: '' });
    const app = createApp({ jobsCache: new JobsCache({ parser: 'v0.0.45', run }) });
    const res = await request(app).get('/api/v1/jobs');

    expect(res.status).toBe(502);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('UPSTREAM_INVALID_RESPONSE');
    expect(JSON.stringify(res.body)).not.toContain('not json');
  });

  test('missing cache wiring becomes 503, not a crash', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/jobs');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
  });

  test('works under PASSENGER_BASE_URI', async () => {
    const saved = process.env.PASSENGER_BASE_URI;
    process.env.PASSENGER_BASE_URI = '/pun/dev/slurm-view';
    try {
      const app = createApp({ jobsCache: new JobsCache({ parser: 'v0.0.45', run: fixtureRun() }) });
      const res = await request(app).get('/pun/dev/slurm-view/api/v1/jobs');
      expect(res.status).toBe(200);
      expect(res.body.jobs).toHaveLength(3);
    } finally {
      if (saved === undefined) {
        delete process.env.PASSENGER_BASE_URI;
      } else {
        process.env.PASSENGER_BASE_URI = saved;
      }
    }
  });
});
