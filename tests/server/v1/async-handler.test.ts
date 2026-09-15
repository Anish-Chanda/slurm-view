import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../../../src/server/middleware/async-handler.js';

function makeRes(): { res: Partial<Response>; jsonBody: () => unknown } {
  let body: unknown;
  const res = {
    json(payload: unknown) {
      body = payload;
      return res;
    },
  } as Partial<Response>;
  return { res, jsonBody: () => body };
}

describe('asyncHandler', () => {
  test('forwards async rejections to next', async () => {
    const failure = new Error('async boom');
    const wrapped = asyncHandler(async () => {
      throw failure;
    });
    const next = jest.fn() as NextFunction;
    wrapped({} as Request, makeRes().res as Response, next);
    await new Promise((resolve) => setImmediate(resolve));
    expect(next).toHaveBeenCalledWith(failure);
  });

  test('does not call next on success', async () => {
    const { res, jsonBody } = makeRes();
    const wrapped = asyncHandler(async (_req, response) => {
      response.json({ ok: true });
    });
    const next = jest.fn() as NextFunction;
    wrapped({} as Request, res as Response, next);
    await new Promise((resolve) => setImmediate(resolve));
    expect(next).not.toHaveBeenCalled();
    expect(jsonBody()).toEqual({ ok: true });
  });
});
