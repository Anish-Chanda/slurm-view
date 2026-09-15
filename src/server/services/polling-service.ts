// Refresh, wait the interval, refresh. A slow call can never overlap
// itself. Failures are logged and the schedule continues.
type RefreshFn = (signal: AbortSignal) => Promise<unknown>;

class PollingService {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private activeController: AbortController | undefined;

  constructor(
    private readonly refresh: RefreshFn,
    private readonly intervalMs: number
  ) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new TypeError('intervalMs must be a positive finite number');
    }
  }

  isActive(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.activeController?.abort();
    this.activeController = undefined;
  }

  private async tick(): Promise<void> {
    if (!this.running) {
      return;
    }
    const controller = new AbortController();
    this.activeController = controller;
    try {
      await this.refresh(controller.signal);
    } catch (error) {
      // stop() aborts the active refresh; that shutdown path is expected.
      if (this.running) {
        console.error(
          `[Polling] Refresh failed, retrying in ${this.intervalMs}ms: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    } finally {
      if (this.activeController === controller) {
        this.activeController = undefined;
      }
    }
    if (!this.running) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick();
    }, this.intervalMs);
    // Never keep the process alive on a pending wait alone.
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }
}

export { PollingService };
export type { RefreshFn };
