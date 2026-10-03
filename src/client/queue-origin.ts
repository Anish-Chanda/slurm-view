declare module '@tanstack/history' {
  interface HistoryState {
    fromJobsQueue?: boolean;
  }
}

// Indicates navigation from the jobs table, allowing Back to restore its state.
function hasJobsQueueOrigin(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { fromJobsQueue?: unknown }).fromJobsQueue === true
  );
}

export { hasJobsQueueOrigin };
