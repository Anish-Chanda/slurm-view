import { JOB_BASE_STATES } from '../../models/job.js';
import type { JobBaseState } from '../../models/job.js';
import { NODE_BASE_STATES } from '../../models/node.js';
import type { NodeBaseState } from '../../models/node.js';

const JOB_BASE_STATE_SET: ReadonlySet<string> = new Set(
  JOB_BASE_STATES.filter((state) => state !== 'UNKNOWN')
);

const NODE_BASE_STATE_SET: ReadonlySet<string> = new Set(
  NODE_BASE_STATES.filter((state) => state !== 'UNKNOWN')
);

interface SplitState<Base> {
  base: Base;
  flags: string[];
}

// Use the first recognized base-state token wherever it appears and keep
// other tokens as flags. If none is recognized, use UNKNOWN and keep every
// token as a flag.
function splitJobState(raw: unknown): SplitState<JobBaseState> {
  const tokens = (Array.isArray(raw) ? raw : [raw])
    .filter((token): token is string => typeof token === 'string')
    .map((token) => token.trim().toUpperCase())
    .filter((token) => token.length > 0);

  const baseIndex = tokens.findIndex((token) => JOB_BASE_STATE_SET.has(token));
  if (baseIndex === -1) {
    return { base: 'UNKNOWN', flags: [...new Set(tokens)] };
  }
  const base = tokens[baseIndex] as JobBaseState;
  const flags = tokens.filter((_, index) => index !== baseIndex);
  return { base, flags: [...new Set(flags)] };
}

function splitNodeState(raw: unknown): SplitState<NodeBaseState> {
  const tokens = (Array.isArray(raw) ? raw : [raw])
    .filter((token): token is string => typeof token === 'string')
    .map((token) => token.trim().toUpperCase())
    .filter((token) => token.length > 0);

  const baseIndex = tokens.findIndex((token) => NODE_BASE_STATE_SET.has(token));
  if (baseIndex === -1) {
    return { base: 'UNKNOWN', flags: [...new Set(tokens)] };
  }
  const base = tokens[baseIndex] as NodeBaseState;
  const flags = tokens.filter((_, index) => index !== baseIndex);
  return { base, flags: [...new Set(flags)] };
}

export { JOB_BASE_STATE_SET, NODE_BASE_STATE_SET, splitJobState, splitNodeState };
export type { SplitState };
