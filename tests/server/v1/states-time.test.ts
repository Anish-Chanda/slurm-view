import { normalizeSlurmNumber } from '../../../src/server/adapters/slurm/schemas/common.js';
import { splitJobState, splitNodeState } from '../../../src/server/adapters/slurm/states.js';
import { nodeAvailability } from '../../../src/server/models/node.js';
import {
  normalizeEpochSeconds,
  normalizeTimeLimitMinutes,
} from '../../../src/server/adapters/slurm/time.js';
import {
  CPU_LOAD_HUNDREDTHS,
  normalizeCpuLoad,
} from '../../../src/server/adapters/slurm/cpu-load.js';
import {
  classifyCpuLoadBucket,
} from '../../../src/server/models/stats.js';

describe('normalizeSlurmNumber', () => {
  test('unwraps set values', () => {
    expect(normalizeSlurmNumber({ number: 42, set: true, infinite: false })).toEqual({
      value: 42,
      infinite: false,
    });
  });

  test('unset and missing values become null', () => {
    expect(normalizeSlurmNumber({ number: 42, set: false, infinite: false }).value).toBeNull();
    expect(normalizeSlurmNumber({ number: null, set: false }).value).toBeNull();
    expect(normalizeSlurmNumber(null).value).toBeNull();
    expect(normalizeSlurmNumber(undefined).value).toBeNull();
  });

  test('infinite is preserved explicitly, never collapsed to a number', () => {
    expect(normalizeSlurmNumber({ number: 0, set: false, infinite: true })).toEqual({
      value: null,
      infinite: true,
    });
  });

  test('plain numbers and numeric strings parse', () => {
    expect(normalizeSlurmNumber(7).value).toBe(7);
    expect(normalizeSlurmNumber('1').value).toBe(1);
    expect(normalizeSlurmNumber('abc').value).toBeNull();
  });
});

describe('splitJobState', () => {
  test('preserves base + flags instead of keeping only [0]', () => {
    expect(splitJobState(['PENDING', 'REQUEUE_HOLD'])).toEqual({
      base: 'PENDING',
      flags: ['REQUEUE_HOLD'],
    });
  });

  test('finds the base regardless of ordering', () => {
    expect(splitJobState(['COMPLETING', 'RUNNING'])).toEqual({
      base: 'RUNNING',
      flags: ['COMPLETING'],
    });
  });

  test('accepts scalar states and normalizes case', () => {
    expect(splitJobState('running')).toEqual({ base: 'RUNNING', flags: [] });
  });

  test('unknown states fall back without dropping tokens', () => {
    expect(splitJobState(['SOME_FUTURE_STATE'])).toEqual({
      base: 'UNKNOWN',
      flags: ['SOME_FUTURE_STATE'],
    });
    expect(splitJobState(null)).toEqual({ base: 'UNKNOWN', flags: [] });
  });
});

describe('splitNodeState', () => {
  test('splits base and drain flags', () => {
    expect(splitNodeState(['IDLE', 'DRAIN'])).toEqual({ base: 'IDLE', flags: ['DRAIN'] });
    expect(splitNodeState('DOWN')).toEqual({ base: 'DOWN', flags: [] });
  });

  test('node availability separates down, restricted, and available', () => {
    expect(nodeAvailability('DOWN', [])).toBe('down');
    expect(nodeAvailability('UNKNOWN', [])).toBe('down');
    expect(nodeAvailability('IDLE', ['NOT_RESPONDING'])).toBe('down');
    expect(nodeAvailability('IDLE', ['FAIL'])).toBe('down');
    expect(nodeAvailability('IDLE', ['POWERED_DOWN'])).toBe('down');
    expect(nodeAvailability('IDLE', ['POWERING_DOWN'])).toBe('down');
    expect(nodeAvailability('IDLE', ['DRAIN'])).toBe('restricted');
    expect(nodeAvailability('MIXED', ['DRAIN'])).toBe('restricted');
    expect(nodeAvailability('IDLE', ['DRAINING'])).toBe('restricted');
    expect(nodeAvailability('IDLE', ['DRAINED'])).toBe('restricted');
    expect(nodeAvailability('IDLE', ['FAILING'])).toBe('restricted');
    expect(nodeAvailability('ERROR', [])).toBe('restricted');
    expect(nodeAvailability('IDLE', [])).toBe('available');
    expect(nodeAvailability('MIXED', [])).toBe('available');
    expect(nodeAvailability('ALLOCATED', ['COMPLETING'])).toBe('available');
  });
});

describe('time normalization', () => {
  test('minutes become finite second limits', () => {
    expect(normalizeTimeLimitMinutes({ number: 120, set: true, infinite: false })).toEqual({
      kind: 'finite',
      seconds: 7200,
    });
  });

  test('infinite stays explicit; unset becomes null', () => {
    expect(normalizeTimeLimitMinutes({ number: 0, set: false, infinite: true })).toEqual({
      kind: 'infinite',
    });
    expect(normalizeTimeLimitMinutes({ number: 0, set: false, infinite: false })).toBeNull();
    expect(normalizeTimeLimitMinutes(null)).toBeNull();
  });

  test('epoch seconds become Dates; zero/missing become null', () => {
    expect(normalizeEpochSeconds({ number: 1725799500, set: true, infinite: false })).toEqual(
      new Date(1725799500 * 1000)
    );
    expect(normalizeEpochSeconds({ number: 0, set: false, infinite: false })).toBeNull();
    expect(normalizeEpochSeconds(null)).toBeNull();
  });
});

describe('cpu load', () => {
  test('JSON integer is scaled from hundredths exactly once', () => {
    expect(CPU_LOAD_HUNDREDTHS).toBe(100);
    expect(normalizeCpuLoad({ number: 1250, set: true, infinite: false })).toBe(12.5);
    expect(normalizeCpuLoad(5)).toBe(0.05);
    expect(normalizeCpuLoad({ number: 0, set: false })).toBeNull();
  });

  test('bucket boundaries: < lowMax is low, <= mediumMax is medium', () => {
    const thresholds = { lowMax: 0.33, mediumMax: 0.66 };
    expect(classifyCpuLoadBucket(0.329, thresholds)).toBe('low');
    expect(classifyCpuLoadBucket(0.33, thresholds)).toBe('medium');
    expect(classifyCpuLoadBucket(0.66, thresholds)).toBe('medium');
    expect(classifyCpuLoadBucket(0.661, thresholds)).toBe('high');
  });
});
