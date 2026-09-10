import type { JobState } from '../../shared/api/v1/jobs.ts';

const STATE_BADGE_CLASSES: Record<JobState, string> = {
  BOOT_FAIL: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-700',
  COMPLETED: 'bg-green-100 text-green-700',
  DEADLINE: 'bg-red-100 text-red-700',
  FAILED: 'bg-red-100 text-red-700',
  NODE_FAIL: 'bg-red-100 text-red-700',
  OUT_OF_MEMORY: 'bg-red-100 text-red-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  PREEMPTED: 'bg-orange-100 text-orange-700',
  RUNNING: 'bg-blue-100 text-blue-700',
  SUSPENDED: 'bg-purple-100 text-purple-700',
  TIMEOUT: 'bg-red-100 text-red-700',
  UNKNOWN: 'bg-slate-100 text-slate-700',
};

function StateBadge({ state }: { state: JobState }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATE_BADGE_CLASSES[state]}`}>
      {state}
    </span>
  );
}

export { StateBadge };
