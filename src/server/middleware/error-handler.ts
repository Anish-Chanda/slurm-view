import type { NextFunction, Request, Response } from 'express';
import {
  ProblemCode,
  ProblemDefinitions,
  createProblemDetails,
} from '../../shared/api/v1/common.js';

class HttpError extends Error {
  public readonly detail?: string;

  constructor(
    public readonly code: ProblemCode,
    detail?: string
  ) {
    const definition = ProblemDefinitions[code];
    super(detail ?? definition.title);
    this.detail = detail;
    this.name = 'HttpError';
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    const body = createProblemDetails(err.code, err.detail);
    res.type('application/problem+json').status(body.status).json(body);
    return;
  }

  const body = createProblemDetails(ProblemCode.InternalError);
  res.type('application/problem+json').status(body.status).json(body);
}

export { HttpError, errorHandler };
