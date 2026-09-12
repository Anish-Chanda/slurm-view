import {
  queueWaitSeconds,
  remainingSeconds,
  runtimeSeconds,
  waitingSeconds,
} from '../../src/client/features/job-details/lifecycle';

const SUBMIT = '2026-09-12T16:42:00.000Z';
const ELIGIBLE = '2026-09-12T16:50:00.000Z';
const START = '2026-09-12T16:58:00.000Z';
const END = '2026-09-12T18:00:00.000Z';

describe('queueWaitSeconds', () => {
  test('prefers eligible time over submit time', () => {
    expect(queueWaitSeconds({ submitTime: SUBMIT, eligibleTime: ELIGIBLE, startTime: START })).toEqual({
      seconds: 8 * 60,
      fromEligible: true,
    });
  });

  test('falls back to submit time without claiming eligibility', () => {
    expect(queueWaitSeconds({ submitTime: SUBMIT, eligibleTime: null, startTime: START })).toEqual({
      seconds: 16 * 60,
      fromEligible: false,
    });
  });

  test('needs a start time', () => {
    expect(queueWaitSeconds({ submitTime: SUBMIT, eligibleTime: ELIGIBLE, startTime: null })).toBeNull();
  });
});

describe('waitingSeconds', () => {
  test('pending waits since eligible when known', () => {
    const now = Date.parse('2026-09-12T17:00:00.000Z');
    expect(waitingSeconds({ submitTime: SUBMIT, eligibleTime: ELIGIBLE }, now)).toBe(10 * 60);
  });

  test('pending waits since submit without eligible', () => {
    const now = Date.parse('2026-09-12T17:00:00.000Z');
    expect(waitingSeconds({ submitTime: SUBMIT, eligibleTime: null }, now)).toBe(18 * 60);
  });
});

describe('runtimeSeconds', () => {
  test('uses end time for finished jobs', () => {
    expect(runtimeSeconds({ startTime: START, endTime: END }, Date.parse(END))).toBe(62 * 60);
  });

  test('uses now for running jobs', () => {
    const now = Date.parse('2026-09-12T17:58:00.000Z');
    expect(runtimeSeconds({ startTime: START, endTime: null }, now)).toBe(60 * 60);
  });

  test('needs a start time', () => {
    expect(runtimeSeconds({ startTime: null, endTime: null }, Date.now())).toBeNull();
  });
});

describe('remainingSeconds', () => {
  test('computes time until end', () => {
    const now = Date.parse('2026-09-12T17:00:00.000Z');
    expect(remainingSeconds({ endTime: END }, now)).toBe(60 * 60);
  });

  test('needs an end time', () => {
    expect(remainingSeconds({ endTime: null }, Date.now())).toBeNull();
  });
});
