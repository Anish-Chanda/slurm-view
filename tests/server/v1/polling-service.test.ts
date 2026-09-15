import { PollingService } from '../../../src/server/services/polling-service.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('PollingService', () => {
  test('refreshes immediately on start, then waits the interval between completions', async () => {
    const calls: number[] = [];
    const poller = new PollingService(
      () => {
        calls.push(Date.now());
        return Promise.resolve();
      },
      40
    );
    poller.start();
    await sleep(110);
    poller.stop();
    // t=0 immediate + ~t=40 + ~t=80
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.length).toBeLessThanOrEqual(4);
    const countAfterStop = calls.length;
    await sleep(80);
    expect(calls.length).toBe(countAfterStop);
  });

  test('a slow refresh never overlaps itself', async () => {
    let active = 0;
    let maxActive = 0;
    const poller = new PollingService(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(50);
      active -= 1;
    }, 10);
    poller.start();
    await sleep(160);
    poller.stop();
    expect(maxActive).toBe(1);
  });

  test('start is idempotent', async () => {
    let calls = 0;
    const poller = new PollingService(() => {
      calls += 1;
      return Promise.resolve();
    }, 30);
    poller.start();
    poller.start();
    await sleep(80);
    poller.stop();
    expect(poller.isActive()).toBe(false);
    // One chain only: immediate + ~2 interval ticks, not doubled.
    expect(calls).toBeLessThanOrEqual(4);
  });

  test('failed refresh does not stop future polling', async () => {
    let calls = 0;
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const poller = new PollingService(() => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('flaky slurm')) : Promise.resolve();
      }, 20);
      poller.start();
      await sleep(90);
      poller.stop();
      expect(calls).toBeGreaterThanOrEqual(3);
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  test('stop aborts an in-flight refresh', async () => {
    let seenAborted: boolean | undefined;
    const poller = new PollingService((signal) => {
      signal.addEventListener('abort', () => {
        seenAborted = true;
      });
      return new Promise(() => undefined);
    }, 20);
    poller.start();
    await sleep(20);
    poller.stop();
    expect(seenAborted).toBe(true);
  });
});
