import request from 'supertest';
import { CommandError } from '../../../src/server/adapters/slurm/command-runner.js';
import { createApp } from '../../../src/server/app.js';
import { PartitionsCache } from '../../../src/server/cache/partitions-cache.js';
import type { SlurmRunFn } from '../../../src/server/adapters/slurm/context.js';

function envelope(partitions: Array<Record<string, unknown>>): string {
  return JSON.stringify({ meta: {}, errors: [], warnings: [], partitions });
}

function partitionsRun(names: string[]): SlurmRunFn {
  const stdout = envelope(names.map((name) => ({ name })));
  return jest.fn().mockResolvedValue({ stdout, stderr: '' });
}

describe('GET /api/v1/partitions', () => {
  test('returns real partition names without envelopes or a fake all entry', async () => {
    const app = createApp({
      partitionsCache: new PartitionsCache({ parser: 'v0.0.45', run: partitionsRun(['gpu', 'debug']) }),
    });
    const res = await request(app).get('/api/v1/partitions');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.partitions).toEqual(['gpu', 'debug']);
    expect(typeof res.body.updatedAt).toBe('string');
    expect(res.body.success).toBeUndefined();
  });

  test('a real partition literally named all passes through as a normal entry', async () => {
    const app = createApp({
      partitionsCache: new PartitionsCache({ parser: 'v0.0.44', run: partitionsRun(['all', 'gpu']) }),
    });
    const res = await request(app).get('/api/v1/partitions');

    expect(res.status).toBe(200);
    expect(res.body.partitions).toEqual(['all', 'gpu']);
  });

  test('unknown query parameters become RFC 9457 Bad Request', async () => {
    const app = createApp({
      partitionsCache: new PartitionsCache({ parser: 'v0.0.45', run: partitionsRun(['gpu']) }),
    });
    const res = await request(app).get('/api/v1/partitions').query({ verbose: '1' });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  test('Slurm failure becomes 503 without leaking internals', async () => {
    const run: SlurmRunFn = jest.fn().mockRejectedValue(
      new CommandError({
        kind: 'non-zero-exit',
        executable: 'sinfo',
        args: [],
        exitCode: 1,
        stderrSnippet: 'secret controller detail',
        message: 'Command exited with code 1: sinfo',
      })
    );
    const app = createApp({ partitionsCache: new PartitionsCache({ parser: 'v0.0.45', run }) });
    const res = await request(app).get('/api/v1/partitions');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('secret controller detail');
  });

  test('malformed Slurm payload becomes 502 without leaking the payload', async () => {
    const run: SlurmRunFn = jest.fn().mockResolvedValue({ stdout: 'not json {', stderr: '' });
    const app = createApp({ partitionsCache: new PartitionsCache({ parser: 'v0.0.45', run }) });
    const res = await request(app).get('/api/v1/partitions');

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('UPSTREAM_INVALID_RESPONSE');
    expect(JSON.stringify(res.body)).not.toContain('not json');
  });

  test('missing cache wiring becomes 503, not a crash', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/partitions');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
  });

  test('works under PASSENGER_BASE_URI', async () => {
    const saved = process.env.PASSENGER_BASE_URI;
    process.env.PASSENGER_BASE_URI = '/pun/dev/slurm-view';
    try {
      const app = createApp({
        partitionsCache: new PartitionsCache({ parser: 'v0.0.45', run: partitionsRun(['gpu']) }),
      });
      const res = await request(app).get('/pun/dev/slurm-view/api/v1/partitions');
      expect(res.status).toBe(200);
      expect(res.body.partitions).toEqual(['gpu']);
    } finally {
      if (saved === undefined) {
        delete process.env.PASSENGER_BASE_URI;
      } else {
        process.env.PASSENGER_BASE_URI = saved;
      }
    }
  });
});
