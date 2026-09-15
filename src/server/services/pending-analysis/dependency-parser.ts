// Pure Slurm dependency expression parser. No Slurm I/O.
// Form (sbatch --dependency): <type:job_id[:job_id][,type:...]>
// or <?-separated OR form>. Only one separator per expression.
// Supported: after/afterok/afternotok/afterany/aftercorr/afterburstbuffer
// with per-id +delay minutes, array element `123_4`, wildcard `123_*`,
// status markers `(unfulfilled)/(failed)`, and bare `singleton`.
import type { DependencyStatus } from '../../../shared/api/v1/pending-analysis.js';

const DEPENDENCY_TYPES = new Set([
  'after',
  'afterok',
  'afternotok',
  'afterany',
  'aftercorr',
  'afterburstbuffer',
  'singleton',
]);

interface DependencyItem {
  readonly jobId: string;
  readonly arrayTaskId: string | null;
  readonly delayMinutes: number | null;
  readonly arrayWildcard: boolean;
  readonly statusMarker: string | null;
}

interface DependencyClause {
  readonly type: string;
  readonly jobs: DependencyItem[];
}

interface ParsedDependency {
  readonly operator: 'and' | 'or' | 'single';
  readonly clauses: DependencyClause[];
}

function parseDependencyItem(token: string): DependencyItem | null {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let core = trimmed;
  let statusMarker: string | null = null;
  const markerMatch = core.match(/\(([^)]+)\)\s*$/);
  if (markerMatch) {
    statusMarker = (markerMatch[1] ?? '').trim() || null;
    core = core.slice(0, markerMatch.index ?? core.length).trim();
  }
  let arrayWildcard = false;
  const wildcardMatch = core.match(/_\*\s*$/);
  if (wildcardMatch) {
    arrayWildcard = true;
    core = core.slice(0, wildcardMatch.index ?? core.length).trim();
  }
  // Per-id delay has the form <id>+<minutes>.
  let delayMinutes: number | null = null;
  let arrayTaskId: string | null = null;
  let jobId = core;
  const delayMatch = core.match(/^([^+]+)\+(\d+)\s*$/);
  if (delayMatch) {
    jobId = (delayMatch[1] ?? '').trim();
    const minutes = Number(delayMatch[2]);
    delayMinutes = Number.isFinite(minutes) && minutes >= 0 ? Math.floor(minutes) : null;
  }
  // Array element has the form <jobId>_<taskId>.
  const elementMatch = jobId.match(/^(\d+)_(\d+)$/);
  if (elementMatch) {
    jobId = elementMatch[1] ?? jobId;
    arrayTaskId = elementMatch[2] ?? null;
  }
  if (!/^\d+$/.test(jobId)) {
    return null;
  }
  return { jobId, arrayTaskId, delayMinutes, arrayWildcard, statusMarker };
}

function parseDependencyClause(segment: string): DependencyClause | null {
  const trimmed = segment.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.toLowerCase() === 'singleton') {
    return { type: 'singleton', jobs: [] };
  }
  const colon = trimmed.indexOf(':');
  if (colon === -1) {
    return null;
  }
  const type = trimmed.slice(0, colon).trim().toLowerCase();
  if (!DEPENDENCY_TYPES.has(type)) {
    return null;
  }
  const rest = trimmed.slice(colon + 1);
  const jobs: DependencyItem[] = [];
  for (const token of rest.split(':')) {
    const item = parseDependencyItem(token);
    if (item !== null) {
      jobs.push(item);
    }
  }
  if (jobs.length === 0) {
    return null;
  }
  return { type, jobs };
}

// In OR form each id of a `type:a:b` group is an alternative
// (afterok:20:21?afterany:23 means afterok:20 OR afterok:21 OR
// afterany:23), so flatten each id to its own clause.
function parseDependency(raw: string | null): ParsedDependency | null {
  if (raw === null) {
    return null;
  }
  const expression = raw.trim();
  if (expression.length === 0) {
    return null;
  }
  if (expression.toLowerCase() === 'singleton') {
    return { operator: 'single', clauses: [{ type: 'singleton', jobs: [] }] };
  }
  const hasOr = expression.includes('?');
  const hasAnd = expression.includes(',');
  if (hasOr && hasAnd) {
    return null;
  }
  if (hasOr) {
    const clauses: DependencyClause[] = [];
    for (const group of expression.split('?')) {
      const clause = parseDependencyClause(group);
      if (clause === null) {
        continue;
      }
      if (clause.type === 'singleton') {
        clauses.push(clause);
        continue;
      }
      // Flatten per-id alternatives.
      for (const job of clause.jobs) {
        clauses.push({ type: clause.type, jobs: [job] });
      }
    }
    if (clauses.length === 0) {
      return null;
    }
    return { operator: clauses.length === 1 ? 'single' : 'or', clauses };
  }
  const clauses: DependencyClause[] = [];
  for (const group of expression.split(',')) {
    const clause = parseDependencyClause(group);
    if (clause !== null) {
      clauses.push(clause);
    }
  }
  if (clauses.length === 0) {
    return null;
  }
  return { operator: clauses.length === 1 ? 'single' : 'and', clauses };
}

function combineStatus(values: DependencyStatus[], operator: 'and' | 'or' | 'single'): DependencyStatus {
  if (values.length === 0) {
    return 'unknown';
  }
  if (operator === 'or' || operator === 'single') {
    if (values.some((value) => value === 'satisfied')) {
      return 'satisfied';
    }
    if (values.some((value) => value === 'unknown')) {
      return 'unknown';
    }
    return 'unsatisfied';
  }
  if (values.some((value) => value === 'unsatisfied')) {
    return 'unsatisfied';
  }
  if (values.some((value) => value === 'unknown')) {
    return 'unknown';
  }
  return 'satisfied';
}

export { DEPENDENCY_TYPES, combineStatus, parseDependency, parseDependencyClause, parseDependencyItem };
export type { DependencyClause, DependencyItem, ParsedDependency };
