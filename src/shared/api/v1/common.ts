// RFC 9457 Problem Details for HTTP APIs.
export const ProblemCode = {
  BadRequest: 'BAD_REQUEST',
  SlurmUnavailable: 'SLURM_UNAVAILABLE',
  UpstreamInvalidResponse: 'UPSTREAM_INVALID_RESPONSE',
  InternalError: 'INTERNAL_ERROR',
} as const;

export type ProblemCode = (typeof ProblemCode)[keyof typeof ProblemCode];

export const ProblemDefinitions = {
  [ProblemCode.BadRequest]: {
    type: 'urn:slurm-view:problem:bad-request',
    status: 400,
    title: 'Bad Request',
  },
  [ProblemCode.SlurmUnavailable]: {
    type: 'urn:slurm-view:problem:slurm-unavailable',
    status: 503,
    title: 'Slurm Unavailable',
  },
  [ProblemCode.UpstreamInvalidResponse]: {
    type: 'urn:slurm-view:problem:upstream-invalid-response',
    status: 502,
    title: 'Bad Gateway',
  },
  [ProblemCode.InternalError]: {
    type: 'urn:slurm-view:problem:internal-error',
    status: 500,
    title: 'Internal Server Error',
  },
} as const satisfies Record<ProblemCode, { type: string; status: number; title: string }>;

export type ProblemDefinition = (typeof ProblemDefinitions)[ProblemCode];

export type ProblemType = ProblemDefinition['type'];

// RFC 9457 Problem Details for HTTP APIs.
export type ProblemDetailsFor<C extends ProblemCode> = {
  code: C;
  type: (typeof ProblemDefinitions)[C]['type'];
  title: (typeof ProblemDefinitions)[C]['title'];
  status: (typeof ProblemDefinitions)[C]['status'];
  detail?: string;
  instance?: string;
};

export type ProblemDetails = {
  [C in ProblemCode]: ProblemDetailsFor<C>;
}[ProblemCode];

export function createProblemDetails<C extends ProblemCode>(
  code: C,
  detail?: string,
  instance?: string
): ProblemDetailsFor<C> {
  const definition = ProblemDefinitions[code];
  const body: ProblemDetailsFor<C> = {
    code,
    type: definition.type,
    title: definition.title,
    status: definition.status,
  };
  if (detail !== undefined) {
    body.detail = detail;
  }
  if (instance !== undefined) {
    body.instance = instance;
  }
  return body;
}
