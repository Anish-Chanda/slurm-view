import {
  MISSING,
  formatCount,
  formatDateTime,
  formatDuration,
  formatMemoryMiB,
  formatTimeLeft,
  formatTimeLimit,
} from '../../src/client/features/jobs/formatting';

const baseJob = {
  state: 'RUNNING' as const,
  startTime: '2026-09-09T10:00:00.000Z',
  endTime: '2026-09-09T12:00:00.000Z',
  timeLimit: { kind: 'finite', seconds: 7200 } as const,
};

describe('jobs formatting', () => {
  test('missing values render as an em dash, never N/A', () => {
    expect(MISSING).toBe('—');
    expect(MISSING).not.toContain('N/A');
    expect(formatTimeLimit(null)).toBe('—');
    expect(formatDateTime(null)).toBe('—');
    expect(formatCount(null)).toBe('—');
    expect(formatMemoryMiB(null)).toBe('—');
  });

  test('formatDuration mirrors the legacy compact style', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(90123)).toBe('1d 1h 2m 3s');
  });

  test('time limits handle finite, infinite, and missing', () => {
    expect(formatTimeLimit({ kind: 'finite', seconds: 7200 })).toBe('2h');
    expect(formatTimeLimit({ kind: 'infinite' })).toBe('UNLIMITED');
    expect(formatTimeLimit(null)).toBe('—');
  });

  test('time left counts down for running jobs from endTime', () => {
    const now = Date.parse('2026-09-09T11:00:00.000Z');
    expect(formatTimeLeft(baseJob, now)).toBe('1h');
  });

  test('time left falls back to startTime plus limit', () => {
    const now = Date.parse('2026-09-09T10:30:00.000Z');
    expect(formatTimeLeft({ ...baseJob, endTime: null }, now)).toBe('1h 30m');
  });

  test('time left reports pending, exceeded, and terminal states', () => {
    expect(formatTimeLeft({ ...baseJob, state: 'PENDING' })).toBe('Not started');
    expect(formatTimeLeft(baseJob, Date.parse('2026-09-09T13:00:00.000Z'))).toBe('Exceeded');
    expect(formatTimeLeft({ ...baseJob, state: 'COMPLETED' })).toBe('—');
    expect(formatTimeLeft({ ...baseJob, state: 'FAILED' })).toBe('—');
    expect(formatTimeLeft({ ...baseJob, state: 'CANCELLED' })).toBe('—');
    expect(formatTimeLeft({ ...baseJob, state: 'TIMEOUT' })).toBe('—');
    expect(formatTimeLeft({ ...baseJob, state: 'SUSPENDED' })).toBe('—');
    expect(formatTimeLeft({ ...baseJob, endTime: null, startTime: null })).toBe('—');
  });

  test('memory and counts format plainly', () => {
    expect(formatMemoryMiB(512)).toBe('512 MiB');
    expect(formatMemoryMiB(32768)).toBe('32 GiB');
    expect(formatCount(4)).toBe('4');
  });
});
