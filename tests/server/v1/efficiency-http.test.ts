import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';
import { CommandError } from '../../../src/server/adapters/slurm/command-runner.js';
import { createApp } from '../../../src/server/app.js';
import { JobsCache } from '../../../src/server/cache/jobs-cache.js';
import type { SlurmRunFn } from '../../../src/server/adapters/slurm/context.js';
import type { SeffRunFn } from '../../../src/server/adapters/slurm/seff.js';

const FIXTURES = path.join(__dirname, 'fixtures');

const COMPLETED_SEFF = `Job ID: 103
Cluster: mycluster
User/Group: carol/research
State: COMPLETED (exit code 0)
Cores: 1
CPU Utilized: 00:59:10
CPU Efficiency: 98.61% of 01:00:00 core-walltime
Job Wall-clock time: 01:00:00
Memory Utilized: 512.00 MB
Memory Efficiency: 25.00% of 2.00 GB (2.00 GB/core)
`;

function fixtureRun(): SlurmRunFn {
  const stdout = fs.readFileSync(path.join(FIXTURES, 'v45-jobs.json'), 'utf8');
  return jest.fn().mockResolvedValue({ stdout, stderr: '' });
}

function seffRunFor(stdout: string, exitCode = 0): SeffRunFn {
  return jest.fn().mockResolvedValue({ stdout, stderr: '', exitCode });
}

function appWith(seffRun: SeffRunFn, squeueRun?: SlurmRunFn) {
  return createApp({
    jobsCache: new JobsCache({ parser: 'v0.0.45', run: squeueRun ?? fixtureRun() }),
    seffRun,
  });
}

describe('GET /api/v1/jobs/:id/efficiency', () => {
  test('returns typed numerics for a completed job', async () => {
    const app = appWith(seffRunFor(COMPLETED_SEFF));
    const res = await request(app).get('/api/v1/jobs/103/efficiency');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cpu: { efficiencyPercent: 98.61, utilizedSeconds: 3550, allocatedCoreSeconds: 3600 },
      memory: { efficiencyPercent: 25, utilizedMiB: 512, allocatedMiB: 2048 },
      wallClockSeconds: 3600,
      updatedAt: expect.any(String),
    });
    expect(res.body).not.toHaveProperty('CPU Efficiency');
  });

  test.each([
    ['running', '101'],
    ['pending array task', '100_2'],
  ])('does not spawn seff for a %s job', async (_label, id) => {
    const seffRun = seffRunFor(COMPLETED_SEFF);
    const app = appWith(seffRun);
    const res = await request(app).get(`/api/v1/jobs/${id}/efficiency`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
    expect(seffRun).not.toHaveBeenCalled();
  });

  test('does not spawn seff for failed jobs', async () => {
    const failedStdout = JSON.stringify({
      jobs: [{ job_id: 200, job_state: 'FAILED', exit_code: { return_code: { number: 1, set: true } } }],
    });
    const squeueRun: SlurmRunFn = jest.fn().mockResolvedValue({ stdout: failedStdout, stderr: '' });
    const seffRun = seffRunFor(COMPLETED_SEFF);
    const app = appWith(seffRun, squeueRun);
    const res = await request(app).get('/api/v1/jobs/200/efficiency');

    expect(res.status).toBe(400);
    expect(seffRun).not.toHaveBeenCalled();
  });

  test('accepts seff stdout from a non-zero exit', async () => {
    const app = appWith(seffRunFor(COMPLETED_SEFF, 139));
    const res = await request(app).get('/api/v1/jobs/103/efficiency');
    expect(res.status).toBe(200);
    expect(res.body.cpu.efficiencyPercent).toBe(98.61);
  });

  test('unknown job follows live not-found behavior', async () => {
    const seffRun = seffRunFor(COMPLETED_SEFF);
    const app = appWith(seffRun);
    const res = await request(app).get('/api/v1/jobs/99999/efficiency');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(seffRun).not.toHaveBeenCalled();
  });

  test.each([['step suffix', '123.batch'], ['injection', '1;rm']])(
    'invalid ID (%s) becomes 400 without spawning seff',
    async (_label, id) => {
      const seffRun = seffRunFor(COMPLETED_SEFF);
      const app = appWith(seffRun);
      const res = await request(app).get(`/api/v1/jobs/${encodeURIComponent(id)}/efficiency`);

      expect(res.status).toBe(400);
      expect(seffRun).not.toHaveBeenCalled();
    }
  );

  test('missing seff executable becomes a capability-style 503', async () => {
    const seffRun: SeffRunFn = jest.fn().mockRejectedValue(
      new CommandError({
        kind: 'executable-not-found',
        executable: 'seff',
        args: ['103'],
        message: 'Executable not found: seff',
      })
    );
    const app = appWith(seffRun);
    const res = await request(app).get('/api/v1/jobs/103/efficiency');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
    expect(res.body.detail).toMatch(/isn't available on this cluster/);
  });

  test('unusable seff output becomes 502 without leaking stdout', async () => {
    const app = appWith(seffRunFor('Job not found.\n', 2));
    const res = await request(app).get('/api/v1/jobs/103/efficiency');

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('UPSTREAM_INVALID_RESPONSE');
    expect(JSON.stringify(res.body)).not.toContain('Job not found');
  });

  test('missing cache wiring becomes 503, not a crash', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/jobs/103/efficiency');
    expect(res.status).toBe(503);
  });

  test('works under PASSENGER_BASE_URI', async () => {
    const saved = process.env.PASSENGER_BASE_URI;
    process.env.PASSENGER_BASE_URI = '/pun/dev/slurm-view';
    try {
      const app = createApp({
        jobsCache: new JobsCache({ parser: 'v0.0.45', run: fixtureRun() }),
        seffRun: seffRunFor(COMPLETED_SEFF),
      });
      const res = await request(app).get('/pun/dev/slurm-view/api/v1/jobs/103/efficiency');
      expect(res.status).toBe(200);
    } finally {
      if (saved === undefined) {
        delete process.env.PASSENGER_BASE_URI;
      } else {
        process.env.PASSENGER_BASE_URI = saved;
      }
    }
  });
});
