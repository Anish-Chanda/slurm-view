import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';
import { CommandError } from '../../../src/server/adapters/slurm/command-runner.js';
import { createApp } from '../../../src/server/app.js';
import { NodesCache } from '../../../src/server/cache/nodes-cache.js';
import type { SlurmRunFn } from '../../../src/server/adapters/slurm/context.js';

const FIXTURES = path.join(__dirname, 'fixtures');

function fixtureRun(): SlurmRunFn {
  const stdout = fs.readFileSync(path.join(FIXTURES, 'v45-nodes.json'), 'utf8');
  return jest.fn().mockResolvedValue({ stdout, stderr: '' });
}

describe('GET /api/v1/stats', () => {
  test('returns semantic stats without D3 shapes', async () => {
    const app = createApp({ nodesCache: new NodesCache({ parser: 'v0.0.45', run: fixtureRun() }) });
    const res = await request(app).get('/api/v1/stats');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.success).toBeUndefined();
    expect(res.body.name).toBeUndefined();
    expect(res.body.children).toBeUndefined();
    expect(res.body.cpu).toMatchObject({ configuredCpus: 192, allocatedCpus: 16 });
    expect(res.body.memory).toMatchObject({ totalMiB: 768000 });
    expect(res.body.gpu).toMatchObject({ total: 10, allocated: 2 });
    expect(typeof res.body.updatedAt).toBe('string');
  });

  test('partition filter scopes; all means cluster-wide', async () => {
    const app = createApp({ nodesCache: new NodesCache({ parser: 'v0.0.45', run: fixtureRun() }) });

    const gpu = await request(app).get('/api/v1/stats').query({ partition: 'gpu' });
    expect(gpu.status).toBe(200);
    expect(gpu.body.cpu.configuredCpus).toBe(128);
    expect(gpu.body.gpu.total).toBe(8);

    const all = await request(app).get('/api/v1/stats').query({ partition: 'all' });
    expect(all.status).toBe(200);
    expect(all.body.cpu.configuredCpus).toBe(192);
  });

  test('invalid partition becomes RFC 9457 Bad Request', async () => {
    const app = createApp({ nodesCache: new NodesCache({ parser: 'v0.0.45', run: fixtureRun() }) });
    const res = await request(app).get('/api/v1/stats').query({ partition: 'bad;name' });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  test('Slurm failure becomes 503 without leaking internals', async () => {
    const run: SlurmRunFn = jest.fn().mockRejectedValue(
      new CommandError({
        kind: 'timeout',
        executable: 'scontrol',
        args: [],
        stderrSnippet: 'secret controller detail',
        message: 'Command timed out: scontrol',
      })
    );
    const app = createApp({ nodesCache: new NodesCache({ parser: 'v0.0.45', run }) });
    const res = await request(app).get('/api/v1/stats');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('secret controller detail');
  });

  test('missing cache wiring becomes 503, not a crash', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/stats');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SLURM_UNAVAILABLE');
  });
});
