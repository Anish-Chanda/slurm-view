declare module '@tanstack/history' {
  interface HistoryState {
    fromJobsQueue?: boolean;
  }
}

// True when the jobs table linked here, so Back can restore its state.
function hasJobsQueueOrigin(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { fromJobsQueue?: unknown }).fromJobsQueue === true
  );
}

export { hasJobsQueueOrigin };
