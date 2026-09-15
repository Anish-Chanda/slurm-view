import request from 'supertest';
import { createApp } from '../../../src/server/app.js';

describe('GET /api/v1/ui-settings', () => {
  test('returns the resolved presentation policy without backend internals', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/ui-settings');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.charts).toEqual({
      cpu: { showSecondaryLayer: expect.any(Boolean) },
      memory: { showSecondaryLayer: expect.any(Boolean) },
      gpu: { showSecondaryLayer: expect.any(Boolean) },
    });
    expect(res.body.navbar).toEqual({
      enabled: expect.any(Boolean),
      title: expect.any(String),
      color: expect.any(String),
    });
    // No raw config surface: thresholds, file paths, or merge details.
    expect(JSON.stringify(res.body)).not.toContain('threshold');
    expect(JSON.stringify(res.body)).not.toContain('config.d');
  });

  test('unknown query parameters become RFC 9457 Bad Request', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/ui-settings').query({ verbose: '1' });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('BAD_REQUEST');
  });
});
