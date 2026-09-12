import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';
import { createApp } from '../../../src/server/app.js';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLIENT_DIR = path.join(PROJECT_ROOT, 'dist', 'client');
const CLIENT_INDEX = path.join(CLIENT_DIR, 'index.html');
const FIXTURE_ASSET_NAME = 'app-fallback-test-fixture.js';
const FIXTURE_ASSET = path.join(CLIENT_DIR, 'assets', FIXTURE_ASSET_NAME);
const FIXTURE_ASSET_BODY = '/* slurm-view fallback test asset */\n';
const MARKER_INDEX = [
  '<!doctype html>',
  '<html><head><meta charset="utf-8"><title>Slurm View</title></head>',
  '<body><div id="root"></div>',
  `<script type="module" src="./assets/${FIXTURE_ASSET_NAME}"></script>`,
  '</body></html>',
  '',
].join('\n');

let createdIndex = false;
let createdAsset = false;

beforeAll(() => {
  if (!fs.existsSync(CLIENT_INDEX)) {
    fs.mkdirSync(path.dirname(CLIENT_INDEX), { recursive: true });
    fs.writeFileSync(CLIENT_INDEX, MARKER_INDEX);
    createdIndex = true;
  }
  if (!fs.existsSync(FIXTURE_ASSET)) {
    fs.mkdirSync(path.dirname(FIXTURE_ASSET), { recursive: true });
    fs.writeFileSync(FIXTURE_ASSET, FIXTURE_ASSET_BODY);
    createdAsset = true;
  }
});

afterAll(() => {
  if (createdAsset && fs.existsSync(FIXTURE_ASSET)) {
    fs.rmSync(FIXTURE_ASSET);
  }
  if (createdIndex && fs.existsSync(CLIENT_INDEX)) {
    fs.rmSync(CLIENT_INDEX);
  }
});

describe('React staging deep links under /react/*', () => {
  test('direct navigation to /react/jobs/123 returns shell HTML with a mount base', async () => {
    const app = createApp();
    const res = await request(app).get('/react/jobs/123');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('id="root"');
    expect(res.text).toContain('<base href="/react/">');
  });

  test('malformed job deep links receive the shell for GlobalNotFound', async () => {
    const app = createApp();
    const res = await request(app).get('/react/jobs/123.batch');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<base href="/react/">');
    expect(res.text).toContain('id="root"');
  });
  test('array task deep links also return the shell with a mount base', async () => {
    const app = createApp();
    const res = await request(app).get('/react/jobs/100_2');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<base href="/react/">');
  });

  test('the staging root serves the shell with a mount base', async () => {
    const app = createApp();
    const res = await request(app).get('/react/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('id="root"');
    expect(res.text).toContain('<base href="/react/">');
  });

  test('relative assets resolve under the mount, not the deep-link path', async () => {
    const app = createApp();
    const res = await request(app).get(`/react/assets/${FIXTURE_ASSET_NAME}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toBe(FIXTURE_ASSET_BODY);
  });

  test('file-like segments still fall through instead of serving HTML', async () => {
    const app = createApp();
    const res = await request(app).get('/react/assets/app-DUMMY1234.js');

    expect(res.status).toBe(404);
    expect(res.text).not.toContain('id="root"');
  });

  test('API paths are not swallowed by the fallback', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('unwired jobs API stays problem+json, not HTML', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/jobs');

    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  test('malformed job deep links under PASSENGER_BASE_URI receive the shell', async () => {
    const saved = process.env.PASSENGER_BASE_URI;
    process.env.PASSENGER_BASE_URI = '/pun/dev/slurm-view';
    try {
      const app = createApp();
      const res = await request(app).get('/pun/dev/slurm-view/react/jobs/123.batch');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('<base href="/pun/dev/slurm-view/react/">');
      expect(res.text).toContain('id="root"');
    } finally {
      if (saved === undefined) {
        delete process.env.PASSENGER_BASE_URI;
      } else {
        process.env.PASSENGER_BASE_URI = saved;
      }
    }
  });

  test('deep links and assets work under PASSENGER_BASE_URI', async () => {
    const saved = process.env.PASSENGER_BASE_URI;
    process.env.PASSENGER_BASE_URI = '/pun/dev/slurm-view';
    try {
      const app = createApp();
      const deepLink = await request(app).get('/pun/dev/slurm-view/react/jobs/123');

      expect(deepLink.status).toBe(200);
      expect(deepLink.text).toContain('<base href="/pun/dev/slurm-view/react/">');

      const asset = await request(app).get(
        `/pun/dev/slurm-view/react/assets/${FIXTURE_ASSET_NAME}`
      );

      expect(asset.status).toBe(200);
      expect(asset.headers['content-type']).toMatch(/javascript/);
      expect(asset.text).toBe(FIXTURE_ASSET_BODY);
    } finally {
      if (saved === undefined) {
        delete process.env.PASSENGER_BASE_URI;
      } else {
        process.env.PASSENGER_BASE_URI = saved;
      }
    }
  });
});
