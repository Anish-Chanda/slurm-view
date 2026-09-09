const request = require('supertest');
const express = require('express');
const { createApp } = require('../../dist/server/app.js');
const { HttpError, errorHandler } = require('../../dist/server/middleware/error-handler.js');
const { ProblemCode } = require('../../dist/shared/api/v1/common.js');

const PASSENGER_BASE_URI = '/pun/dev/slurm-view';

let savedPassengerBaseUri;

beforeEach(() => {
  savedPassengerBaseUri = process.env.PASSENGER_BASE_URI;
  delete process.env.PASSENGER_BASE_URI;
});

afterEach(() => {
  if (savedPassengerBaseUri === undefined) {
    delete process.env.PASSENGER_BASE_URI;
  } else {
    process.env.PASSENGER_BASE_URI = savedPassengerBaseUri;
  }
});

describe('GET /api/v1/health', () => {
  test('returns direct resource response without envelope', async () => {
    const app = createApp();

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.body.data).toBeUndefined();
    expect(res.body.success).toBeUndefined();
  });
});

describe('v1 routes under PASSENGER_BASE_URI', () => {
  test('prefixed health route works and unprefixed route is 404', async () => {
    process.env.PASSENGER_BASE_URI = PASSENGER_BASE_URI;
    const app = createApp();
    // Delete before any requests to prove the base URI was captured
    // at construction time rather than read from process.env per request.
    delete process.env.PASSENGER_BASE_URI;

    const prefixed = await request(app).get(`${PASSENGER_BASE_URI}/api/v1/health`);

    expect(prefixed.status).toBe(200);
    expect(prefixed.body).toEqual({ status: 'ok' });

    const unprefixed = await request(app).get('/api/v1/health');

    expect(unprefixed.status).toBe(404);
  });
});

describe('unknown /api/v1 routes', () => {
  test('GET /api/v1/nope returns RFC 9457 Not Found', async () => {
    const app = createApp();

    const res = await request(app).get('/api/v1/nope');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toEqual({
      type: 'urn:slurm-view:problem:not-found',
      title: 'Not Found',
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});

describe('v1 error middleware', () => {
  function makeErrorApp(errToThrow) {
    const app = express();
    // eslint-disable-next-line no-unused-vars
    app.get('/boom', (req, res, next) => next(errToThrow));
    app.use(errorHandler);
    return app;
  }

  test('HttpError derives Problem Details from its ProblemCode', async () => {
    const app = makeErrorApp(new HttpError(ProblemCode.BadRequest, 'bad input'));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toEqual({
      type: 'urn:slurm-view:problem:bad-request',
      title: 'Bad Request',
      status: 400,
      detail: 'bad input',
      code: 'BAD_REQUEST',
    });
    expect(res.body.success).toBeUndefined();
    expect(res.body.error).toBeUndefined();
  });

  test('HttpError without detail omits the detail member', async () => {
    const app = makeErrorApp(new HttpError(ProblemCode.BadRequest));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toEqual({
      type: 'urn:slurm-view:problem:bad-request',
      title: 'Bad Request',
      status: 400,
      code: 'BAD_REQUEST',
    });
    expect(res.body.detail).toBeUndefined();
  });

  test('unknown errors return generic 500 Problem Details without leaking details', async () => {
    const app = makeErrorApp(new Error('secret internals'));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toEqual({
      type: 'urn:slurm-view:problem:internal-error',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(res.body.detail).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('secret internals');
  });
});

describe('legacy routes keep legacy error shape', () => {
  test('legacy validation failure is not converted to Problem Details', async () => {
    const app = createApp();

    // bad;name fails partition validation before any Slurm access, so this
    // is deterministic without service mocks.
    const res = await request(app).get('/api/stats/').query({ partition: 'bad;name' });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-type']).not.toMatch(/problem\+json/);
    expect(res.body.success).toBe(false);
    expect(res.body.type).toBeUndefined();
  });
});
